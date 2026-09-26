"""Purchase intent detection, AI chatbot provider interface, and automation.

Implements the three automation pillars of Flowdesk:

* **Intent detection** — rule-based scoring of inbound messages; messages that
  look like buying intent create/update a flagged lead in the pipeline.
* **AI chatbot provider interface** — a pluggable ``AIProvider`` abstraction
  with a default rule-based FAQ provider, so a real LLM provider can be
  registered later without touching call sites.
* **Automation engine** — auto-replies, smart follow-ups, order confirmations
  and reminders, all recorded in ``analytics_events`` and (where possible)
  delivered through the webhook reply stubs.
"""
import json
import re
import threading

# --------------------------------------------------------------------------- settings

DEFAULT_SETTINGS = {
    "auto_reply": True,
    "follow_ups_enabled": True,
    "order_confirmations_enabled": True,
    "reminders_enabled": True,
    "intent_threshold": 0.6,
    "follow_up_hours": 24,
    "reminder_hours": 48,
    "provider": "rule_based",
}

_settings = dict(DEFAULT_SETTINGS)
_lock = threading.Lock()


def get_settings():
    with _lock:
        return dict(_settings)


def update_settings(data):
    """Merge known keys from ``data`` into the live settings; unknown keys are ignored."""
    with _lock:
        changed = []
        for key, value in (data or {}).items():
            if key not in DEFAULT_SETTINGS:
                continue
            _settings[key] = value
            changed.append(key)
        return dict(_settings)


# --------------------------------------------------------------------------- intent

_INTENT_PATTERNS = [
    (re.compile(r"\b(want|need|buy|purchase|order|reserve|book)\b", re.I), 0.35, "buy_verb"),
    (re.compile(r"\b(how much|price|cost|pricing|charges?)\b", re.I), 0.30, "price_question"),
    (re.compile(r"\b(delivery|deliver(ies|ing)?|shipping|ship|dispatch)\b", re.I), 0.25, "delivery"),
    (re.compile(r"\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s*(pieces|pcs|pc|units?|boxes|box|dozen|sets|set)s?\b", re.I), 0.30, "quantity"),
    (re.compile(r"\b(one|two|three|four|five|six|seven|eight|nine|ten)\s+of\b", re.I), 0.15, "quantity_phrase"),
]

_QUESTION_WORDS = re.compile(r"\b(what|which|where|when|how|can|do|is|are|price|stock)\b", re.I)


def detect_intent(text):
    """Score a message for purchase intent.

    Returns ``(score, signals)`` where ``score`` is 0..1 and ``signals`` is the
    list of matched signal names.
    """
    text = text or ""
    score = 0.0
    signals = []
    for pattern, weight, name in _INTENT_PATTERNS:
        if pattern.search(text):
            score += weight
            signals.append(name)
    score = round(min(score, 1.0), 2)
    return score, signals


# --------------------------------------------------------------------------- providers


class AIProvider:
    """Interface for chatbot reply providers.

    Subclasses set ``name`` and implement :meth:`generate_reply`, which receives
    the customer's inbound message plus optional context (the conversation row)
    and returns a reply string, or ``None`` to hand the conversation to a human.
    """

    name = "base"
    description = "Base chatbot provider interface."

    def generate_reply(self, message, context=None):
        raise NotImplementedError


class RuleBasedProvider(AIProvider):
    """Default provider: answers common questions from a FAQ catalog."""

    name = "rule_based"
    description = "Rule-based FAQ responder covering price, delivery and stock questions."

    FAQ = [
        (re.compile(r"\b(how much|price|cost|pricing|charge)\b", re.I),
         "Thanks for your interest! Prices depend on the product and quantity. "
         "Tell me what you would like to order and I will confirm the total for you."),
        (re.compile(r"\b(delivery|deliver|shipping|ship|dispatch)\b", re.I),
         "We deliver nationwide — Lagos, Ibadan, Abuja and most other cities. "
         "Delivery usually takes 1-3 working days. Where are you located?"),
        (re.compile(r"\b(stock|available|in store|left)\b", re.I),
         "Yes, it is in stock and ready to ship. Would you like to place an order?"),
        (re.compile(r"^(hi|hello|hey|good (morning|afternoon|evening))\b", re.I),
         "Hello! Thanks for reaching out. What would you like to order today?"),
    ]

    def generate_reply(self, message, context=None):
        text = (message or "").strip()
        if not text:
            return None
        for pattern, reply in self.FAQ:
            if pattern.search(text):
                return reply
        return None


_PROVIDERS = {"rule_based": RuleBasedProvider()}


def register_provider(provider):
    """Register a chatbot provider by its ``name`` (replaces any existing one)."""
    if not hasattr(provider, "name") or not provider.name:
        raise ValueError("provider must have a non-empty name")
    _PROVIDERS[provider.name] = provider


def get_provider(name=None):
    """Look up a provider by name, falling back to the configured default."""
    name = name or get_settings().get("provider") or "rule_based"
    return _PROVIDERS.get(name) or _PROVIDERS["rule_based"]


def list_providers():
    return [
        {"name": name, "description": _PROVIDERS[name].description}
        for name in sorted(_PROVIDERS)
    ]


# --------------------------------------------------------------------------- events


def log_event(con, event_type, entity_type=None, entity_id=None, payload=None):
    con.execute(
        "INSERT INTO analytics_events (event_type, entity_type, entity_id, payload) "
        "VALUES (?, ?, ?, ?)",
        (event_type, entity_type, entity_id,
         json.dumps(payload) if payload is not None else None),
    )


def _send_auto_message(con, conv, text, event_type, entity_type=None, entity_id=None):
    """Insert an outbound automation message and record it as an automation event."""
    from server import webhooks

    now = con.execute("SELECT datetime('now') AS ts").fetchone()["ts"]
    provider_response = webhooks._provider_stub(conv["source"], conv, text)
    con.execute(
        "INSERT INTO messages (conversation_id, direction, sender, body, message_type) "
        "VALUES (?, 'outbound', 'flowdesk-automation', ?, 'text')",
        (conv["id"], text),
    )
    con.execute(
        "UPDATE conversations SET last_message_at = ?, updated_at = ? WHERE id = ?",
        (now, now, conv["id"]),
    )
    log_event(con, event_type, entity_type or "conversation",
              entity_id if entity_id is not None else conv["id"],
              {"body": text, "channel": conv["source"], "provider_response": provider_response})
    return provider_response


# --------------------------------------------------------------------------- pipeline


def _upsert_lead(con, conv, score, signals):
    lead = con.execute(
        "SELECT * FROM leads WHERE conversation_id = ?", (conv["id"],)
    ).fetchone()
    if lead is None:
        cur = con.execute(
            "INSERT INTO leads (conversation_id, customer_id, status, intent_score, flagged, notes) "
            "VALUES (?, ?, 'interested', ?, 1, ?)",
            (conv["id"], conv["customer_id"], score, "intent:" + ",".join(signals)),
        )
        return cur.lastrowid, True
    con.execute(
        "UPDATE leads SET intent_score = ?, flagged = 1, "
        "status = CASE WHEN status IN ('new_inquiry') THEN 'interested' ELSE status END, "
        "notes = ?, updated_at = datetime('now') WHERE id = ?",
        (score, "intent:" + ",".join(signals), lead["id"]),
    )
    return lead["id"], False


def process_inbound(con, conv):
    """Automation entry point for a freshly ingested inbound conversation.

    Scores the latest inbound message, flags a lead on high intent, and sends
    an auto-reply when the configured chatbot provider can answer.
    """
    last = con.execute(
        "SELECT * FROM messages WHERE conversation_id = ? AND direction = 'inbound' "
        "ORDER BY id DESC LIMIT 1",
        (conv["id"],),
    ).fetchone()
    if last is None:
        return None
    body = last["body"] or ""
    score, signals = detect_intent(body)
    log_event(con, "intent_detected", "conversation", conv["id"],
              {"score": score, "signals": signals, "body": body})
    flagged = False
    if score >= float(get_settings().get("intent_threshold", 0.6)):
        lead_id, created = _upsert_lead(con, conv, score, signals)
        flagged = True
        log_event(con, "lead_flagged", "lead", lead_id,
                  {"score": score, "signals": signals, "created": created})
        con.execute(
            "UPDATE conversations SET status = CASE WHEN status = 'new_inquiry' "
            "THEN 'interested' ELSE status END, updated_at = datetime('now') WHERE id = ?",
            (conv["id"],),
        )
    reply = None
    if get_settings().get("auto_reply"):
        provider = get_provider()
        reply = provider.generate_reply(body, context=conv)
        if reply:
            _send_auto_message(con, conv, reply, "auto_reply_sent")
    return {
        "score": score,
        "signals": signals,
        "flagged": flagged,
        "auto_reply": reply,
    }


def send_order_confirmation(con, lead):
    """Fire an order confirmation when a lead enters the 'order' stage."""
    if not get_settings().get("order_confirmations_enabled"):
        return None
    conv = con.execute(
        "SELECT * FROM conversations WHERE id = ?", (lead["conversation_id"],)
    ).fetchone()
    if conv is None:
        return None
    text = ("Hi! Your order has been received and is now being prepared. "
            "You will get an update as soon as it ships. Thank you for your order!")
    _send_auto_message(con, conv, text, "order_confirmation_sent")
    return text


def run_follow_ups(con, max_age_hours=None):
    """Nudge conversations that showed interest but never became an order."""
    if not get_settings().get("follow_ups_enabled"):
        return {"follow_ups_sent": 0, "reason": "disabled"}
    hours = max_age_hours or get_settings().get("follow_up_hours", 24)
    rows = con.execute(
        """SELECT l.id AS lead_id, c.id AS conv_id, c.source, c.last_message_at,
                  cu.name AS customer_name
           FROM leads l
           JOIN conversations c ON c.id = l.conversation_id
           JOIN customers cu ON cu.id = c.customer_id
           WHERE l.status IN ('new_inquiry', 'interested')
             AND NOT EXISTS (
                 SELECT 1 FROM orders o WHERE o.lead_id = l.id
                   AND o.status != 'cancelled')
             AND c.last_message_at <= datetime('now', ?)""",
        (f"-{int(hours)} hours",),
    ).fetchall()
    sent = 0
    for row in rows:
        already = con.execute(
            "SELECT 1 FROM analytics_events WHERE event_type = 'follow_up_sent' "
            "AND entity_type = 'lead' AND entity_id = ? LIMIT 1",
            (row["lead_id"],),
        ).fetchone()
        if already:
            continue
        conv = con.execute(
            "SELECT * FROM conversations WHERE id = ?", (row["conv_id"],)
        ).fetchone()
        _send_auto_message(
            con, conv,
            f"Hi {row['customer_name'].split()[0]}! Just following up on your last "
            "message — is there anything you would like to order today?",
            "follow_up_sent",
        )
        sent += 1
    return {"follow_ups_sent": sent, "scanned": len(rows)}


def run_reminders(con, max_age_hours=None):
    """Remind about orders placed but not yet shipped."""
    if not get_settings().get("reminders_enabled"):
        return {"reminders_sent": 0, "reason": "disabled"}
    hours = max_age_hours or get_settings().get("reminder_hours", 48)
    rows = con.execute(
        """SELECT o.id AS order_id, o.order_number, o.status, o.created_at,
                  c.id AS conv_id, c.source, cu.name AS customer_name
           FROM orders o
           JOIN conversations c ON c.id = o.conversation_id
           JOIN customers cu ON cu.id = o.customer_id
           WHERE o.status = 'pending'
             AND o.created_at <= datetime('now', ?)
             AND NOT EXISTS (
                 SELECT 1 FROM analytics_events e
                 WHERE e.event_type = 'reminder_sent'
                   AND e.entity_type = 'order' AND e.entity_id = o.id)""",
        (f"-{int(hours)} hours",),
    ).fetchall()
    sent = 0
    for row in rows:
        conv = con.execute(
            "SELECT * FROM conversations WHERE id = ?", (row["conv_id"],)
        ).fetchone()
        if conv is None:
            continue
        _send_auto_message(
            con, conv,
            f"Hi {row['customer_name'].split()[0]}! A friendly reminder about your "
            f"order {row['order_number']} — let us know if you need anything else.",
            "reminder_sent", entity_type="order", entity_id=row["order_id"],
        )
        sent += 1
    return {"reminders_sent": sent, "scanned": len(rows)}