"""Unified inbox routes: health, conversations, messages, read state."""
import re
from urllib.parse import parse_qs

CONV_FIELDS = """
    SELECT c.id, c.customer_id, c.source, c.status, c.unread,
           c.last_message_at, c.created_at,
           cu.name AS customer_name,
           cu.phone AS customer_phone, cu.platform AS customer_platform,
           l.id AS lead_id, l.status AS lead_status,
           l.intent_score AS lead_intent_score, l.flagged AS lead_flagged,
           lm.body AS last_message_body,
           lm.direction AS last_message_direction
"""

CONV_FROM = """
    FROM conversations c
    JOIN customers cu ON cu.id = c.customer_id
    LEFT JOIN leads l ON l.conversation_id = c.id
    LEFT JOIN messages lm ON lm.id = (
        SELECT m.id FROM messages m
        WHERE m.conversation_id = c.id ORDER BY m.id DESC LIMIT 1
    )
"""


def _rows(con, sql, args=()):
    return [dict(r) for r in con.execute(sql, args).fetchall()]


def _one(con, sql, args=()):
    row = con.execute(sql, args).fetchone()
    return dict(row) if row else None


def _qs(query):
    parsed = parse_qs(query or "")
    return {k: v[0] for k, v in parsed.items()}


def get_health(con, body, params, query):
    return 200, {"status": "ok", "service": "flowdesk"}


def list_conversations(con, body, params, query):
    q = _qs(query)
    where, args = ["1=1"], []
    if q.get("status"):
        where.append("c.status = ?")
        args.append(q["status"])
    if q.get("source"):
        where.append("c.source = ?")
        args.append(q["source"])
    if q.get("q"):
        where.append("(cu.name LIKE ? OR cu.phone LIKE ?)")
        like = f"%{q['q']}%"
        args.extend([like, like])
    sql = (
        CONV_FIELDS
        + CONV_FROM
        + f"""
        WHERE {' AND '.join(where)}
        ORDER BY c.last_message_at DESC, c.id DESC
    """
    )
    rows = _rows(con, sql, args)
    return 200, {"conversations": rows, "count": len(rows)}


def get_conversation(con, body, params, query):
    conv = _one(con, CONV_FIELDS + CONV_FROM + "WHERE c.id = ?", (params["id"],))
    if not conv:
        return 404, {"error": "conversation not found"}
    messages = _rows(
        con,
        "SELECT * FROM messages WHERE conversation_id = ? ORDER BY id ASC",
        (conv["id"],),
    )
    conv["messages"] = messages
    return 200, {"conversation": conv}


def _upsert_customer(con, data):
    """Create or fetch a customer from a nested customer object."""
    name = (data.get("name") or "").strip()
    if not name:
        raise ValueError("customer.name is required")
    phone = (data.get("phone") or "").strip() or None
    platform = data.get("platform")
    if phone:
        existing = _one(con, "SELECT * FROM customers WHERE phone = ?", (phone,))
        if existing:
            return existing["id"], False
    con.execute(
        "INSERT INTO customers (name, phone, email, platform, external_id, location, notes) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        (
            name,
            phone,
            (data.get("email") or "").strip() or None,
            platform,
            (data.get("external_id") or "").strip() or None,
            (data.get("location") or "").strip() or None,
            (data.get("notes") or "").strip() or None,
        ),
    )
    return con.execute("SELECT last_insert_rowid() AS id").fetchone()["id"], True


def create_conversation(con, body, params, query):
    source = body.get("source")
    if source not in ("whatsapp", "instagram", "tiktok", "manual", "other"):
        raise ValueError("source must be one of: whatsapp, instagram, tiktok, manual, other")
    if "customer_id" in body:
        cust = _one(con, "SELECT * FROM customers WHERE id = ?", (body["customer_id"],))
        if not cust:
            return 404, {"error": "customer not found"}
        customer_id = cust["id"]
    else:
        cust_data = body.get("customer")
        if not cust_data or not (cust_data.get("name") or "").strip():
            raise ValueError("customer.name or customer_id is required")
        customer_id, _ = _upsert_customer(con, cust_data)
    existing = _one(
        con,
        "SELECT * FROM conversations WHERE customer_id = ? AND source = ?",
        (customer_id, source),
    )
    conv_id = existing["id"] if existing else None
    is_new = conv_id is None
    if is_new:
        con.execute(
            "INSERT INTO conversations (customer_id, source) VALUES (?, ?)",
            (customer_id, source),
        )
        conv_id = con.execute("SELECT last_insert_rowid() AS id").fetchone()["id"]
    first_message = body.get("first_message")
    if isinstance(first_message, str):
        first_message = {"body": first_message}
    if first_message and (first_message.get("body") or "").strip():
        con.execute(
            "INSERT INTO messages (conversation_id, direction, sender, body, message_type) "
            "VALUES (?, 'inbound', ?, ?, 'text')",
            (conv_id, first_message.get("sender"), first_message["body"].strip()),
        )
    con.execute(
        "UPDATE conversations SET last_message_at = datetime('now'), updated_at = datetime('now') WHERE id = ?",
        (conv_id,),
    )
    code, payload = get_conversation(con, body, {"id": str(conv_id)}, "")
    return (201 if is_new else 200), payload


def add_message(con, body, params, query):
    conv = _one(con, "SELECT * FROM conversations WHERE id = ?", (params["id"],))
    if not conv:
        return 404, {"error": "conversation not found"}
    text = (body.get("body") or "").strip()
    if not text:
        raise ValueError("body is required")
    direction = body.get("direction", "outbound")
    if direction not in ("inbound", "outbound"):
        raise ValueError("direction must be inbound or outbound")
    con.execute(
        "INSERT INTO messages (conversation_id, direction, sender, body, message_type) "
        "VALUES (?, ?, ?, ?, 'text')",
        (conv["id"], direction, body.get("sender"), text),
    )
    if direction == "inbound":
        con.execute(
            "UPDATE conversations SET last_message_at = datetime('now'), unread = 1, updated_at = datetime('now') WHERE id = ?",
            (conv["id"],),
        )
        from server import automation

        automation.process_inbound(con, conv)
    else:
        con.execute(
            "UPDATE conversations SET last_message_at = datetime('now'), updated_at = datetime('now') WHERE id = ?",
            (conv["id"],),
        )
    msg = _one(con, "SELECT * FROM messages WHERE id = (SELECT MAX(id) FROM messages WHERE conversation_id = ?)", (conv["id"],))
    return 201, {"message": msg}


def mark_read(con, body, params, query):
    conv = _one(con, "SELECT * FROM conversations WHERE id = ?", (params["id"],))
    if not conv:
        return 404, {"error": "conversation not found"}
    con.execute(
        "UPDATE conversations SET unread = 0, updated_at = datetime('now') WHERE id = ?",
        (conv["id"],),
    )
    return 200, {"conversation_id": conv["id"], "unread": 0}


ROUTES = [
    ("GET", re.compile(r"^/api/health$"), get_health),
    ("GET", re.compile(r"^/api/conversations$"), list_conversations),
    ("POST", re.compile(r"^/api/conversations$"), create_conversation),
    ("GET", re.compile(r"^/api/conversations/(?P<id>\d+)$"), get_conversation),
    ("POST", re.compile(r"^/api/conversations/(?P<id>\d+)/messages$"), add_message),
    ("POST", re.compile(r"^/api/conversations/(?P<id>\d+)/read$"), mark_read),
]