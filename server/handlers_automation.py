"""Automation routes: settings, chatbot providers, follow-ups, reminders, events."""
import json
import re

from server import automation


def _qs(query):
    parsed = {}
    for part in (query or "").split("&"):
        if not part:
            continue
        key, _, value = part.partition("=")
        parsed[key] = value
    return parsed


def get_settings(con, body, params, query):
    return 200, {"settings": automation.get_settings()}


def update_settings(con, body, params, query):
    updated = automation.update_settings(body or {})
    con.commit()
    return 200, {"settings": updated}


def list_providers(con, body, params, query):
    settings = automation.get_settings()
    return 200, {
        "providers": automation.list_providers(),
        "active": settings.get("provider") or "rule_based",
    }


def chatbot_test(con, body, params, query):
    message = (body.get("message") or "").strip()
    if not message:
        raise ValueError("message is required")
    provider_name = body.get("provider") or None
    provider = automation.get_provider(provider_name)
    reply = provider.generate_reply(message, context=None)
    score, signals = automation.detect_intent(message)
    return 200, {
        "provider": provider.name,
        "reply": reply,
        "intent": {"score": score, "signals": signals},
    }


def run_follow_ups(con, body, params, query):
    max_age = body.get("max_age_hours")
    result = automation.run_follow_ups(con, max_age_hours=max_age)
    con.commit()
    return 200, result


def run_reminders(con, body, params, query):
    max_age = body.get("max_age_hours")
    result = automation.run_reminders(con, max_age_hours=max_age)
    con.commit()
    return 200, result


def list_events(con, body, params, query):
    q = _qs(query)
    event_type = q.get("type")
    limit = min(int(q.get("limit", 100)), 500)
    if event_type:
        rows = con.execute(
            "SELECT * FROM analytics_events WHERE event_type = ? "
            "ORDER BY id DESC LIMIT ?",
            (event_type, limit),
        ).fetchall()
    else:
        rows = con.execute(
            "SELECT * FROM analytics_events ORDER BY id DESC LIMIT ?", (limit,)
        ).fetchall()
    events = []
    for row in rows:
        d = dict(row)
        if d.get("payload"):
            try:
                d["payload"] = json.loads(d["payload"])
            except (TypeError, ValueError):
                pass
        events.append(d)
    return 200, {"events": events}


ROUTES = [
    ("GET", re.compile(r"^/api/automation/settings$"), get_settings),
    ("PUT", re.compile(r"^/api/automation/settings$"), update_settings),
    ("GET", re.compile(r"^/api/automation/providers$"), list_providers),
    ("POST", re.compile(r"^/api/automation/chatbot/test$"), chatbot_test),
    ("POST", re.compile(r"^/api/automation/follow-ups$"), run_follow_ups),
    ("POST", re.compile(r"^/api/automation/reminders$"), run_reminders),
    ("GET", re.compile(r"^/api/automation/events$"), list_events),
]