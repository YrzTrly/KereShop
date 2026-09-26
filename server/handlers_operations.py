"""Delivery tracking and sales analytics routes."""
import re

from server.automation import log_event

DELIVERY_STATUSES = ("pending", "picked_up", "in_transit", "delivered", "failed")
DELIVERY_TRANSITIONS = {
    "pending": ("picked_up", "in_transit", "failed"),
    "picked_up": ("in_transit", "failed"),
    "in_transit": ("delivered", "failed"),
    "delivered": (),
    "failed": (),
}
# Orders that count as real revenue (everything except still-pending and cancelled).
REVENUE_STATUSES = ("shipped", "delivered", "completed")


def _rows(con, sql, args=()):
    return [dict(r) for r in con.execute(sql, args).fetchall()]


def _one(con, sql, args=()):
    row = con.execute(sql, args).fetchone()
    return dict(row) if row else None


def _qs(query):
    parsed = {}
    for part in (query or "").split("&"):
        if not part:
            continue
        key, _, value = part.partition("=")
        parsed[key] = value
    return parsed


def _get_order(con, order_id):
    order = _one(con, "SELECT * FROM orders WHERE id = ?", (order_id,))
    if order is None:
        return None
    return order


# ---------------------------------------------------------------- deliveries

def create_delivery(con, body, params, query):
    order_id = int(params["id"])
    order = _get_order(con, order_id)
    if order is None:
        return 404, {"error": "order not found"}
    status = body.get("status", "pending")
    if status not in DELIVERY_STATUSES:
        raise ValueError(f"invalid delivery status: {status}")
    delivered_at = "datetime('now')" if status == "delivered" else "NULL"
    cur = con.execute(
        f"""INSERT INTO deliveries
            (order_id, provider, tracking_number, status, delivery_address, estimated_date, delivered_at)
            VALUES (?, ?, ?, ?, ?, ?, {delivered_at})""",
        (
            order_id,
            body.get("provider"),
            body.get("tracking_number"),
            status,
            body.get("delivery_address", order["delivery_address"]),
            body.get("estimated_date"),
        ),
    )
    log_event(
        con, "delivery_created", entity_type="order", entity_id=order_id,
        payload={"delivery_id": cur.lastrowid, "status": status},
    )
    # Handing a pending order to a courier starts the shipment.
    if order["status"] == "pending":
        con.execute(
            "UPDATE orders SET status = 'shipped', updated_at = datetime('now') WHERE id = ?",
            (order_id,),
        )
        log_event(con, "order_shipped", entity_type="order", entity_id=order_id)
    con.commit()
    delivery = _one(con, "SELECT * FROM deliveries WHERE id = ?", (cur.lastrowid,))
    return 201, {"delivery": delivery, "order": _get_order(con, order_id)}


def list_order_deliveries(con, body, params, query):
    order_id = int(params["id"])
    order = _get_order(con, order_id)
    if order is None:
        return 404, {"error": "order not found"}
    rows = _rows(con, "SELECT * FROM deliveries WHERE order_id = ? ORDER BY id", (order_id,))
    return 200, {"deliveries": rows, "total": len(rows)}


def patch_delivery(con, body, params, query):
    delivery_id = int(params["id"])
    delivery = _one(con, "SELECT * FROM deliveries WHERE id = ?", (delivery_id,))
    if delivery is None:
        return 404, {"error": "delivery not found"}
    order = _get_order(con, delivery["order_id"])

    fields, args = [], []
    for col in ("provider", "tracking_number", "delivery_address", "estimated_date"):
        if col in body:
            fields.append(f"{col} = ?")
            args.append(body[col])
    if "status" in body and body["status"] != delivery["status"]:
        new_status = body["status"]
        allowed = DELIVERY_TRANSITIONS.get(delivery["status"], ())
        if new_status not in DELIVERY_STATUSES or new_status not in allowed:
            raise ValueError(
                f"invalid delivery status transition: {delivery['status']} -> {new_status}"
            )
        fields.append("status = ?")
        args.append(new_status)
        if new_status == "delivered":
            fields.append("delivered_at = datetime('now')")
            log_event(con, "delivery_delivered", entity_type="order",
                      entity_id=delivery["order_id"], payload={"delivery_id": delivery_id})
            if order and order["status"] == "shipped":
                con.execute(
                    "UPDATE orders SET status = 'delivered', updated_at = datetime('now') WHERE id = ?",
                    (order["id"],),
                )
                log_event(con, "order_delivered", entity_type="order", entity_id=order["id"])
    if fields:
        fields.append("updated_at = datetime('now')")
        args.append(delivery_id)
        con.execute(f"UPDATE deliveries SET {', '.join(fields)} WHERE id = ?", args)
    con.commit()
    updated = _one(con, "SELECT * FROM deliveries WHERE id = ?", (delivery_id,))
    return 200, {"delivery": updated, "order": _get_order(con, delivery["order_id"])}


# ----------------------------------------------------------------- analytics

def analytics_summary(con, body, params, query):
    rows = _rows(con, "SELECT * FROM orders")
    by_status = {}
    revenue = 0.0
    for order in rows:
        by_status[order["status"]] = by_status.get(order["status"], 0) + 1
        if order["status"] in REVENUE_STATUSES:
            revenue += order["total"]
    total_orders = len(rows)

    conversations = _one(con, "SELECT COUNT(*) AS n FROM conversations")["n"]
    orders_from_conv = _one(
        con, "SELECT COUNT(*) AS n FROM orders WHERE conversation_id IS NOT NULL"
    )["n"]
    leads = _one(con, "SELECT COUNT(*) AS n FROM leads")["n"]
    conversion_rate = (
        orders_from_conv / conversations if conversations else None
    )

    top_products = _rows(
        con,
        """SELECT oi.product_id, p.name, SUM(oi.quantity) AS quantity,
                  SUM(oi.quantity * oi.unit_price) AS revenue
           FROM order_items oi
           JOIN orders o ON o.id = oi.order_id
           LEFT JOIN products p ON p.id = oi.product_id
           WHERE o.status IN ({})
           GROUP BY oi.product_id
           ORDER BY quantity DESC, revenue DESC
           LIMIT 5""".format(",".join("?" for _ in REVENUE_STATUSES)),
        REVENUE_STATUSES,
    )

    event_counts = _rows(
        con,
        """SELECT event_type, COUNT(*) AS count FROM analytics_events
           GROUP BY event_type ORDER BY count DESC LIMIT 10"""
    )

    return 200, {
        "revenue": revenue,
        "orders": {
            "total": total_orders,
            "by_status": by_status,
            "revenue_status_count": sum(
                by_status.get(s, 0) for s in REVENUE_STATUSES
            ),
        },
        "conversion": {
            "conversations": conversations,
            "orders_from_conversations": orders_from_conv,
            "leads": leads,
            "rate": conversion_rate,
        },
        "top_products": top_products,
        "event_counts": event_counts,
    }


ROUTES = [
    ("POST", re.compile(r"^/api/orders/(?P<id>\d+)/deliveries$"), create_delivery),
    ("GET", re.compile(r"^/api/orders/(?P<id>\d+)/deliveries$"), list_order_deliveries),
    ("PATCH", re.compile(r"^/api/deliveries/(?P<id>\d+)$"), patch_delivery),
    ("GET", re.compile(r"^/api/analytics/summary$"), analytics_summary),
]