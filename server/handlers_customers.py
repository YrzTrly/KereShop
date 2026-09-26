"""Customer profiles and lead pipeline routes."""

import re

PIPELINE = ("new_inquiry", "interested", "order", "completed")
CONVERSATION_STATUSES = set(PIPELINE) | {"archived"}


def _parse_query(query):
    params = {}
    for part in query.split("&"):
        if not part:
            continue
        key, _, value = part.partition("=")
        params[key] = value
    return params


def _row(d):
    return {k: d[k] for k in d.keys()} if d is not None else None


def _get_customer(con, customer_id):
    return con.execute("SELECT * FROM customers WHERE id = ?", (customer_id,)).fetchone()


def _customer_dict(row):
    d = _row(row)
    d["is_returning"] = bool(d["is_returning"])
    return d


def list_customers(con, body, params, query):
    q = _parse_query(query).get("q", "").strip()
    sql = "SELECT * FROM customers"
    where, args = [], []
    if q:
        where.append("(name LIKE ? OR phone LIKE ? OR email LIKE ?)")
        like = f"%{q}%"
        args.extend([like, like, like])
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " ORDER BY id DESC"
    rows = con.execute(sql, args).fetchall()
    return 200, {"customers": [_customer_dict(r) for r in rows], "total": len(rows)}


def get_customer(con, body, params, query):
    row = _get_customer(con, int(params["id"]))
    if row is None:
        return 404, {"error": "customer not found"}
    conversations = con.execute(
        "SELECT id, source, status, unread, last_message_at, created_at FROM conversations "
        "WHERE customer_id = ? ORDER BY last_message_at DESC",
        (row["id"],),
    ).fetchall()
    orders = con.execute(
        """SELECT o.id, o.order_number, o.status, o.total, o.currency, o.created_at,
                  (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id) AS item_count
           FROM orders o WHERE o.customer_id = ? ORDER BY o.id DESC""",
        (row["id"],),
    ).fetchall()
    lead = con.execute(
        "SELECT id, status, intent_score, flagged, notes, updated_at FROM leads "
        "WHERE customer_id = ? ORDER BY id DESC LIMIT 1",
        (row["id"],),
    ).fetchone()
    data = _customer_dict(row)
    data["conversations"] = [_row(c) for c in conversations]
    data["orders"] = [_row(o) for o in orders]
    data["latest_lead"] = _row(lead)
    return 200, {"customer": data}


def create_customer(con, body, params, query):
    name = (body.get("name") or "").strip()
    if not name:
        raise ValueError("name is required")
    phone = (body.get("phone") or "").strip() or None
    email = (body.get("email") or "").strip() or None
    platform = body.get("platform") or "manual"
    if platform not in ("whatsapp", "instagram", "tiktok", "manual", "other"):
        raise ValueError("invalid platform")
    # Upsert by phone so webhook adapters and manual entry share one profile.
    if phone:
        existing = con.execute(
            "SELECT * FROM customers WHERE phone = ?", (phone,)
        ).fetchone()
        if existing:
            return 200, {"customer": _customer_dict(existing), "created": False}
    cur = con.execute(
        "INSERT INTO customers (name, phone, email, platform, external_id, location, notes) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        (
            name,
            phone,
            email,
            platform,
            (body.get("external_id") or "").strip() or None,
            body.get("location"),
            body.get("notes"),
        ),
    )
    con.commit()
    row = _get_customer(con, cur.lastrowid)
    return 201, {"customer": _customer_dict(row), "created": True}


def _lead_dict(row):
    d = _row(row)
    d["flagged"] = bool(d["flagged"])
    return d


def list_leads(con, body, params, query):
    q = _parse_query(query)
    status = q.get("status", "").strip()
    flagged = q.get("flagged", "").strip()
    sql = (
        "SELECT l.*, c.name AS customer_name, c.phone AS customer_phone, "
        "c.platform AS customer_platform, cv.source AS conversation_source "
        "FROM leads l JOIN customers c ON c.id = l.customer_id "
        "LEFT JOIN conversations cv ON cv.id = l.conversation_id"
    )
    where, args = [], []
    if status:
        where.append("l.status = ?")
        args.append(status)
    if flagged in ("1", "true"):
        where.append("l.flagged = 1")
    elif flagged in ("0", "false"):
        where.append("l.flagged = 0")
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " ORDER BY l.id DESC"
    rows = con.execute(sql, args).fetchall()
    out = []
    for r in rows:
        d = _lead_dict(r)
        d["conversation_source"] = r["conversation_source"]
        out.append(d)
    return 200, {"leads": out, "total": len(out)}


def create_lead(con, body, params, query):
    conversation_id = body.get("conversation_id")
    if conversation_id is None:
        raise ValueError("conversation_id is required")
    cv = con.execute(
        "SELECT * FROM conversations WHERE id = ?", (conversation_id,)
    ).fetchone()
    if cv is None:
        return 404, {"error": "conversation not found"}
    if cv["customer_id"] is None:
        return 400, {"error": "conversation has no customer"}
    existing = con.execute(
        "SELECT * FROM leads WHERE conversation_id = ?", (conversation_id,)
    ).fetchone()
    if existing is not None:
        return 200, {"lead": _lead_dict(existing), "created": False}
    cur = con.execute(
        "INSERT INTO leads (conversation_id, customer_id, status, intent_score, flagged, notes) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        (
            conversation_id,
            cv["customer_id"],
            body.get("status") or "new_inquiry",
            body.get("intent_score"),
            1 if body.get("flagged") else 0,
            body.get("notes"),
        ),
    )
    con.commit()
    row = con.execute("SELECT * FROM leads WHERE id = ?", (cur.lastrowid,)).fetchone()
    return 201, {"lead": _lead_dict(row), "created": True}


def _can_transition(current, target):
    if current == target:
        return True
    if target == "lost":
        return current in PIPELINE
    if target not in PIPELINE:
        return False
    return PIPELINE.index(target) > PIPELINE.index(current)


def update_lead(con, body, params, query):
    lead = con.execute("SELECT * FROM leads WHERE id = ?", (params["id"],)).fetchone()
    if lead is None:
        return 404, {"error": "lead not found"}
    updates, args = [], []
    if "status" in body:
        target = body["status"]
        if target not in PIPELINE and target != "lost":
            raise ValueError("invalid status")
        if not _can_transition(lead["status"], target):
            return 400, {
                "error": f"invalid transition from {lead['status']} to {target}"
            }
        updates.append("status = ?")
        args.append(target)
    for field in ("notes", "intent_score"):
        if field in body:
            updates.append(f"{field} = ?")
            args.append(body[field])
    if "flagged" in body:
        updates.append("flagged = ?")
        args.append(1 if body["flagged"] else 0)
    if not updates:
        return 400, {"error": "no fields to update"}
    updates.append("updated_at = datetime('now')")
    args.append(int(lead["id"]))
    con.execute(f"UPDATE leads SET {', '.join(updates)} WHERE id = ?", args)
    # Keep the linked conversation in step with the pipeline stage.
    if "status" in body and body["status"] in CONVERSATION_STATUSES:
        con.execute(
            "UPDATE conversations SET status = ?, updated_at = datetime('now') "
            "WHERE id = ?",
            (body["status"], lead["conversation_id"]),
        )
    # Fire the order confirmation when a lead first enters the order stage.
    if (
        "status" in body
        and body["status"] == "order"
        and lead["status"] != "order"
    ):
        from server import automation

        automation.send_order_confirmation(con, lead)
    con.commit()
    row = con.execute("SELECT * FROM leads WHERE id = ?", (lead["id"],)).fetchone()
    return 200, {"lead": _lead_dict(row)}


def get_lead(con, body, params, query):
    lead = con.execute("SELECT * FROM leads WHERE id = ?", (params["id"],)).fetchone()
    if lead is None:
        return 404, {"error": "lead not found"}
    conversation = con.execute(
        "SELECT * FROM conversations WHERE id = ?", (lead["conversation_id"],)
    ).fetchone()
    customer = _get_customer(con, lead["customer_id"])
    orders = con.execute(
        """SELECT o.id, o.order_number, o.status, o.total, o.currency, o.created_at
           FROM orders o WHERE o.lead_id = ? ORDER BY o.id DESC""",
        (lead["id"],),
    ).fetchall()
    data = _lead_dict(lead)
    data["conversation"] = _row(conversation)
    data["customer"] = _customer_dict(customer) if customer else None
    data["orders"] = [_row(o) for o in orders]
    return 200, {"lead": data}


ROUTES = [
    ("GET", re.compile(r"^/api/customers$"), list_customers),
    ("GET", re.compile(r"^/api/customers/(?P<id>\d+)$"), get_customer),
    ("POST", re.compile(r"^/api/customers$"), create_customer),
    ("GET", re.compile(r"^/api/leads$"), list_leads),
    ("POST", re.compile(r"^/api/leads$"), create_lead),
    ("GET", re.compile(r"^/api/leads/(?P<id>\d+)$"), get_lead),
    ("PATCH", re.compile(r"^/api/leads/(?P<id>\d+)$"), update_lead),
]