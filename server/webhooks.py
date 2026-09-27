"""Social-platform webhook ingestion adapters and outbound reply stubs.

Each platform adapter normalizes its native payload into a common shape and
reuses the inbox helpers to upsert the customer and append an inbound message.
Outbound replies are recorded as `direction='outbound'` rows in `messages` and
routed through a per-provider stub sender so tests can assert on the call.
"""
import json
import os
import re
import urllib.error
import urllib.request
from urllib.parse import parse_qs

from server.handlers_inbox import _one, _rows, _qs, _upsert_customer

# In-memory log of outbound provider calls (visible via GET /api/replies/outbox).
OUTBOX = []

# Process-level dedup of already-ingested platform message ids, so a
# webhook redelivery (Meta retries until it gets 200) does not duplicate rows.
_SEEN = set()


def _qs_query(query):
    parsed = parse_qs(query or "")
    return {k: v[0] for k, v in parsed.items()}


def _provider_stub(source, customer, body):
    """Stub sender for outbound messages. Returns a provider-shaped response."""
    if not isinstance(customer, dict):
        customer = dict(customer)
    entry = {
        "provider": source,
        "status": "stub",
        "to": (customer.get("phone") or customer.get("customer_phone")
               or customer.get("external_id") or customer.get("name")
               or customer.get("customer_name")),
        "body": body,
    }
    OUTBOX.append(entry)
    return entry


WHATSAPP_GRAPH_VERSION = "v20.0"


def _whatsapp_credentials(con):
    """Resolve WhatsApp Cloud API credentials: integrations row, then env vars."""
    phone_number_id = token = None
    try:
        row = con.execute(
            "SELECT whatsapp_phone_number_id, whatsapp_business_token "
            "FROM integrations WHERE id = 1"
        ).fetchone()
        if row:
            phone_number_id = (row["whatsapp_phone_number_id"] or "").strip() or None
            token = (row["whatsapp_business_token"] or "").strip() or None
    except Exception:
        pass  # column not migrated yet or no integrations table
    phone_number_id = (
        phone_number_id
        or os.environ.get("WHATSAPP_PHONE_NUMBER_ID", "").strip()
        or None
    )
    token = token or os.environ.get("WHATSAPP_CLOUD_TOKEN", "").strip() or None
    return phone_number_id, token


def _http_post_json(url, headers, payload, timeout=15):
    """POST JSON; returns (status_code, parsed_body). Network errors -> (0, {...})."""
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        method="POST",
        headers={"Content-Type": "application/json", **headers},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8", "replace")
            try:
                return resp.status, json.loads(raw)
            except ValueError:
                return resp.status, raw
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", "replace")
        try:
            return exc.code, json.loads(raw)
        except ValueError:
            return exc.code, raw
    except (urllib.error.URLError, OSError) as exc:
        return 0, {"error": str(exc)}


def _send_whatsapp_cloud(con, to, body):
    """Send a text message through the Meta WhatsApp Cloud API.

    Returns a provider-shaped response on success, or None when credentials
    are missing, the recipient has no phone number, or the API call fails
    (the caller then falls back to the stub sender).
    """
    phone_number_id, token = _whatsapp_credentials(con)
    if not phone_number_id or not token:
        return None
    phone = re.sub(r"\D", "", to or "")
    if not phone:
        return None
    url = f"https://graph.facebook.com/{WHATSAPP_GRAPH_VERSION}/{phone_number_id}/messages"
    status, data = _http_post_json(
        url,
        {"Authorization": f"Bearer {token}"},
        {"messaging_product": "whatsapp", "to": phone, "type": "text", "text": {"body": body}},
    )
    if status != 200 or not isinstance(data, dict) or "messages" not in data:
        return None
    message_id = (data.get("messages") or [{}])[0].get("id")
    entry = {
        "provider": "whatsapp",
        "status": "sent",
        "to": phone,
        "body": body,
        "whatsapp_message_id": message_id,
    }
    OUTBOX.append(entry)
    return entry


def _ingest(con, source, customer_data, body, message_type="text", sender=None, external_id=None):
    """Upsert customer + conversation + inbound message for one platform event."""
    if external_id and not customer_data.get("external_id"):
        customer_data["external_id"] = external_id
    customer_id, created = _upsert_customer(con, customer_data)
    conv = _one(
        con,
        "SELECT * FROM conversations WHERE customer_id = ? AND source = ? ORDER BY id DESC LIMIT 1",
        (customer_id, source),
    )
    if not conv:
        con.execute(
            "INSERT INTO conversations (customer_id, source) VALUES (?, ?)",
            (customer_id, source),
        )
        conv = _one(con, "SELECT * FROM conversations WHERE id = ?", (con.execute("SELECT last_insert_rowid() AS id").fetchone()["id"],))
    now = con.execute("SELECT datetime('now') AS ts").fetchone()["ts"]
    con.execute(
        "INSERT INTO messages (conversation_id, direction, sender, body, message_type) VALUES (?, 'inbound', ?, ?, ?)",
        (conv["id"], sender, body, message_type),
    )
    con.execute(
        "UPDATE conversations SET last_message_at = ?, unread = 1 WHERE id = ?",
        (now, conv["id"]),
    )
    from server import automation

    automation.process_inbound(con, conv)
    return conv, customer_id


def _name_from(handle):
    handle = (handle or "").strip()
    return handle.replace("_", " ").title() if handle else "Unknown Customer"


# ---------------------------------------------------------------- WhatsApp
def ingest_whatsapp(con, payload):
    """Meta WhatsApp Cloud API webhook format: entry[].changes[].value.messages[]."""
    seen = set()
    count = 0
    for entry in payload.get("entry", []):
        for change in entry.get("changes", []):
            value = change.get("value", {})
            for msg in value.get("messages", []):
                if msg.get("type") != "text":
                    continue
                phone = (msg.get("from") or "").strip()
                body = (msg.get("text", {}) or {}).get("body", "").strip()
                ext_id = str(msg.get("id") or "")
                dedup_key = ("whatsapp", ext_id) if ext_id else ("whatsapp", phone, body)
                if not phone or not body or dedup_key in _SEEN:
                    continue
                seen.add(dedup_key)
                _SEEN.add(dedup_key)
                _ingest(
                    con,
                    "whatsapp",
                    {"name": _name_from(phone), "phone": phone, "platform": "whatsapp"},
                    body,
                    sender=phone,
                )
                count += 1
    return count


# ---------------------------------------------------------------- Instagram
def ingest_instagram(con, payload):
    """Meta Instagram messaging webhook format: entry[].changes[].value.messages[]."""
    seen = set()
    count = 0
    for entry in payload.get("entry", []):
        for change in entry.get("changes", []):
            value = change.get("value", {})
            for msg in value.get("messages", []):
                from_obj = msg.get("from", {}) or {}
                ext_id = str(from_obj.get("id", ""))
                body = (msg.get("text") or "").strip()
                msg_id = str(msg.get("id") or "")
                dedup_key = ("instagram", msg_id) if msg_id else ("instagram", ext_id, body)
                if not ext_id or not body or dedup_key in _SEEN:
                    continue
                seen.add(dedup_key)
                _SEEN.add(dedup_key)
                _ingest(
                    con,
                    "instagram",
                    {
                        "name": _name_from(from_obj.get("name") or ext_id),
                        "platform": "instagram",
                        "external_id": ext_id,
                    },
                    body,
                    sender=ext_id,
                    external_id=ext_id,
                )
                count += 1
    return count


# ------------------------------------------------------------------- TikTok
def ingest_tiktok(con, payload):
    """TikTok comment webhook format: event.type == 'comment'."""
    event = payload.get("event") or {}
    if event.get("type") != "comment":
        return 0
    comment = event.get("comment", {}) or {}
    body = (comment.get("text") or "").strip()
    comment_id = str(comment.get("id") or "")
    if not body:
        return 0
    author = comment.get("author", {}) or {}
    ext_id = str(author.get("user_id") or "")
    nickname = author.get("nickname") or ext_id
    dedup_key = ("tiktok", comment_id) if comment_id else ("tiktok", ext_id, body)
    if dedup_key in _SEEN:
        return 0
    _SEEN.add(dedup_key)
    _ingest(
        con,
        "tiktok",
        {"name": _name_from(nickname), "platform": "tiktok", "external_id": ext_id},
        body,
        message_type="comment",
        sender=nickname,
        external_id=ext_id,
    )
    return 1


# ------------------------------------------------------------------- Routes
def webhook_whatsapp(con, body, params, query):
    count = ingest_whatsapp(con, body)
    return 200, {"received": True, "messages": count}


def webhook_instagram(con, body, params, query):
    count = ingest_instagram(con, body)
    return 200, {"received": True, "messages": count}


def webhook_tiktok(con, body, params, query):
    count = ingest_tiktok(con, body)
    return 200, {"received": True, "messages": count}


# ------------------------------------------------------------- verification
def _verify_meta(con, body, params, query, source):
    """Meta (WhatsApp / Instagram) GET handshake: echo hub.challenge verbatim."""
    q = _qs_query(query)
    expected_token = os.environ.get("FLOWDESK_WEBHOOK_VERIFY_TOKEN", "").strip()
    provided_token = (q.get("hub.verify_token") or "").strip()
    if expected_token and provided_token != expected_token:
        return 403, {"error": "invalid hub.verify_token"}
    challenge = (q.get("hub.challenge") or "").strip()
    if not challenge:
        return 200, {"verified": True, "source": source}
    return 200, challenge  # plain text: Meta compares the raw body


def verify_whatsapp(con, body, params, query):
    return _verify_meta(con, body, params, query, "whatsapp")


def verify_instagram(con, body, params, query):
    return _verify_meta(con, body, params, query, "instagram")


def verify_tiktok(con, body, params, query):
    """TikTok Business handshake: echo the X-TT-Ws-Token header value."""
    q = _qs_query(query)
    token = (q.get("x_tt_ws_token") or "").strip()  # forwarded from the header
    if not token:
        return 200, {"verified": True, "source": "tiktok"}
    expected = os.environ.get("FLOWDESK_TIKTOK_WS_TOKEN", "").strip()
    if expected and token != expected:
        return 403, {"error": "invalid X-TT-Ws-Token"}
    return 200, token  # plain text: TikTok compares the raw body


def conversation_reply(con, body, params, query):
    """Send an outbound reply for a conversation.

    WhatsApp conversations use the Meta Cloud API when credentials are
    configured (integrations row or env vars); everything else — and any
    failed cloud send — falls back to the stub sender.
    """
    conv = _one(
        con,
        """SELECT c.id, c.source, cu.name, cu.phone, cu.external_id
           FROM conversations c JOIN customers cu ON cu.id = c.customer_id
           WHERE c.id = ?""",
        (params["id"],),
    )
    if not conv:
        return 404, {"error": "conversation not found"}
    text = (body.get("body") or body.get("text") or "").strip()
    if not text:
        return 400, {"error": "body is required"}
    provider_response = None
    if conv["source"] == "whatsapp" and (conv.get("phone") or "").strip():
        provider_response = _send_whatsapp_cloud(con, conv["phone"], text)
        if provider_response is None:
            provider_response = _provider_stub(conv["source"], conv, text)
            provider_response["note"] = (
                "whatsapp cloud api unavailable (missing credentials or send failed); "
                "recorded as stub"
            )
    else:
        provider_response = _provider_stub(conv["source"], conv, text)
    now = con.execute("SELECT datetime('now') AS ts").fetchone()["ts"]
    con.execute(
        "INSERT INTO messages (conversation_id, direction, sender, body, message_type) "
        "VALUES (?, 'outbound', 'flowdesk', ?, 'text')",
        (conv["id"], text),
    )
    con.execute(
        "UPDATE conversations SET last_message_at = ? WHERE id = ?",
        (now, conv["id"]),
    )
    return 200, {
        "sent": True,
        "channel": conv["source"],
        "provider_response": provider_response,
        "conversation_id": conv["id"],
    }


def replies_outbox(con, body, params, query):
    """List recorded outbound provider stub calls (newest first)."""
    q = _qs(query)
    limit = min(int(q.get("limit", "50")), 500)
    rows = list(reversed(OUTBOX))[:limit]
    return 200, {"outbox": rows, "count": len(rows)}


ROUTES = [
    ("GET", re.compile(r"^/webhooks/whatsapp$"), verify_whatsapp),
    ("GET", re.compile(r"^/webhooks/instagram$"), verify_instagram),
    ("GET", re.compile(r"^/webhooks/tiktok$"), verify_tiktok),
    ("POST", re.compile(r"^/webhooks/whatsapp$"), webhook_whatsapp),
    ("POST", re.compile(r"^/webhooks/instagram$"), webhook_instagram),
    ("POST", re.compile(r"^/webhooks/tiktok$"), webhook_tiktok),
    ("POST", re.compile(r"^/api/conversations/(?P<id>\d+)/reply$"), conversation_reply),
    ("GET", re.compile(r"^/api/replies/outbox$"), replies_outbox),
]