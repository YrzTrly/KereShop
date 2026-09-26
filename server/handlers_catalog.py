"""Product catalog and order routes."""
import re

from server.automation import log_event


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


# ---------------------------------------------------------------- products

def _product_dict(row):
    d = dict(row)
    d["available"] = bool(d["available"])
    return d


def list_products(con, body, params, query):
    q = _qs(query).get("q", "").strip()
    sql = """
        SELECT p.*, i.stock_quantity, i.low_stock_threshold
        FROM products p
        LEFT JOIN inventory i ON i.product_id = p.id
    """
    args = []
    if q:
        sql += " WHERE (p.name LIKE ? OR p.sku LIKE ?)"
        like = f"%{q}%"
        args = [like, like]
    sql += " ORDER BY p.id DESC"
    rows = _rows(con, sql, args)
    for r in rows:
        r["available"] = bool(r["available"])
        stock = r["stock_quantity"]
        threshold = r["low_stock_threshold"]
        r["low_stock"] = (
            stock is not None and stock <= (threshold if threshold is not None else 5)
        )
    return 200, {"products": rows, "total": len(rows)}


def get_product(con, body, params, query):
    row = _one(
        con,
        """SELECT p.*, i.stock_quantity, i.low_stock_threshold
           FROM products p LEFT JOIN inventory i ON i.product_id = p.id
           WHERE p.id = ?""",
        (int(params["id"]),),
    )
    if row is None:
        return 404, {"error": "product not found"}
    row["available"] = bool(row["available"])
    return 200, {"product": row}


def create_product(con, body, params, query):
    if not body.get("name"):
        raise ValueError("name is required")
    stock = int(body.get("stock_quantity", 0))
    cur = con.execute(
        """INSERT INTO products (name, description, price, currency, sku, image_url, available)
           VALUES (?, ?, ?, ?, ?, ?, ?)""",
        (
            body["name"],
            body.get("description"),
            float(body.get("price", 0)),
            body.get("currency", "NGN"),
            body.get("sku"),
            body.get("image_url"),
            1 if body.get("available", True) else 0,
        ),
    )
    product_id = cur.lastrowid
    con.execute(
        """INSERT INTO inventory (product_id, stock_quantity, low_stock_threshold)
           VALUES (?, ?, ?)""",
        (product_id, stock, int(body.get("low_stock_threshold", 5))),
    )
    con.commit()
    row = _one(
        con,
        """SELECT p.*, i.stock_quantity, i.low_stock_threshold
           FROM products p LEFT JOIN inventory i ON i.product_id = p.id WHERE p.id = ?""",
        (product_id,),
    )
    row["available"] = bool(row["available"])
    return 201, {"product": row}


def update_product(con, body, params, query):
    product_id = int(params["id"])
    row = _one(con, "SELECT * FROM products WHERE id = ?", (product_id,))
    if row is None:
        return 404, {"error": "product not found"}
    fields, args = [], []
    for col in ("name", "description", "price", "currency", "sku", "image_url"):
        if col in body:
            fields.append(f"{col} = ?")
            args.append(float(body[col]) if col == "price" else body[col])
    if "available" in body:
        fields.append("available = ?")
        args.append(1 if body["available"] else 0)
    if fields:
        fields.append("updated_at = datetime('now')")
        args.append(product_id)
        con.execute(f"UPDATE products SET {', '.join(fields)} WHERE id = ?", args)
    if "stock_quantity" in body:
        con.execute(
            "UPDATE inventory SET stock_quantity = ?, updated_at = datetime('now') WHERE product_id = ?",
            (int(body["stock_quantity"]), product_id),
        )
    elif "low_stock_threshold" in body:
        con.execute(
            "UPDATE inventory SET low_stock_threshold = ?, updated_at = datetime('now') WHERE product_id = ?",
            (int(body["low_stock_threshold"]), product_id),
        )
    con.commit()
    updated = _one(
        con,
        """SELECT p.*, i.stock_quantity, i.low_stock_threshold
           FROM products p LEFT JOIN inventory i ON i.product_id = p.id WHERE p.id = ?""",
        (product_id,),
    )
    updated["available"] = bool(updated["available"])
    return 200, {"product": updated}


# ------------------------------------------------------------------ orders

ORDER_TRANSITIONS = {
    "pending": ("shipped", "cancelled"),
    "shipped": ("delivered", "cancelled"),
    "delivered": ("completed", "cancelled"),
    "completed": (),
    "cancelled": (),
}


def _order_number(con):
    row = con.execute("SELECT COALESCE(MAX(id), 0) AS n FROM orders").fetchone()
    return f"FD-{row['n'] + 1:04d}"


def _items_from_body(con, items):
    """Validate order line items; return (subtotal, item_rows)."""
    subtotal = 0.0
    item_rows = []
    for item in items:
        quantity = int(item.get("quantity", 1))
        if quantity <= 0:
            raise ValueError("quantity must be positive")
        if item.get("product_id"):
            product = _one(con, "SELECT * FROM products WHERE id = ?", (int(item["product_id"]),))
            if product is None:
                raise ValueError(f"product {item['product_id']} not found")
            description = item.get("description") or product["name"]
            unit_price = float(item.get("unit_price", product["price"]))
        else:
            description = item.get("description")
            if not description:
                raise ValueError("each item needs a product_id or description")
            unit_price = float(item.get("unit_price", 0))
        subtotal += quantity * unit_price
        item_rows.append((item.get("product_id"), description, quantity, unit_price))
    return subtotal, item_rows


def _decrement_stock(con, item_rows):
    """Decrement inventory for product line items; fail the order if stock is short."""
    for product_id, _description, quantity, _unit_price in item_rows:
        if not product_id:
            continue
        row = _one(con, "SELECT * FROM inventory WHERE product_id = ?", (product_id,))
        if row is None:
            continue
        if row["stock_quantity"] < quantity:
            product = _one(con, "SELECT name FROM products WHERE id = ?", (product_id,))
            name = product["name"] if product else f"#{product_id}"
            raise ValueError(f"insufficient stock for {name}: have {row['stock_quantity']}, need {quantity}")
        con.execute(
            "UPDATE inventory SET stock_quantity = stock_quantity - ?, updated_at = datetime('now') WHERE product_id = ?",
            (quantity, product_id),
        )


def _restore_stock(con, order_id):
    """Put stock back when an order that consumed inventory is cancelled."""
    for row in con.execute(
        "SELECT product_id, quantity FROM order_items WHERE order_id = ? AND product_id IS NOT NULL",
        (order_id,),
    ).fetchall():
        con.execute(
            "UPDATE inventory SET stock_quantity = stock_quantity + ?, updated_at = datetime('now') WHERE product_id = ?",
            (row["quantity"], row["product_id"]),
        )


def list_orders(con, body, params, query):
    q = _qs(query)
    where, args = [], []
    if q.get("status"):
        where.append("o.status = ?")
        args.append(q["status"])
    if q.get("customer_id"):
        where.append("o.customer_id = ?")
        args.append(int(q["customer_id"]))
    if q.get("q"):
        where.append("(o.order_number LIKE ? OR cu.name LIKE ?)")
        like = f"%{q['q']}%"
        args.extend([like, like])
    sql = """
        SELECT o.*, cu.name AS customer_name
        FROM orders o
        JOIN customers cu ON cu.id = o.customer_id
    """
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " ORDER BY o.id DESC"
    return 200, {"orders": _rows(con, sql, args), "total": len(_rows(con, sql, args))}


def get_order(con, body, params, query):
    order_id = int(params["id"])
    order = _one(
        con,
        """SELECT o.*, cu.name AS customer_name, cu.phone AS customer_phone
           FROM orders o JOIN customers cu ON cu.id = o.customer_id
           WHERE o.id = ?""",
        (order_id,),
    )
    if order is None:
        return 404, {"error": "order not found"}
    items = _rows(con, "SELECT * FROM order_items WHERE order_id = ? ORDER BY id", (order_id,))
    order["items"] = items
    return 200, {"order": order}


def create_order(con, body, params, query):
    if not body.get("customer_id"):
        raise ValueError("customer_id is required")
    customer = _one(con, "SELECT * FROM customers WHERE id = ?", (int(body["customer_id"]),))
    if customer is None:
        raise ValueError("customer not found")
    items = body.get("items") or []
    if not items:
        raise ValueError("items are required")
    subtotal, item_rows = _items_from_body(con, items)
    delivery_fee = float(body.get("delivery_fee", 0))
    discount = float(body.get("discount", 0))
    total = subtotal + delivery_fee - discount
    # An order with no conversation context was added manually by the seller.
    is_manual = 1 if (body.get("is_manual", False) or not body.get("conversation_id")) else 0
    order_number = _order_number(con)
    created_by = body.get("created_by") or (body.get("_user") or {}).get("id")
    cur = con.execute(
        """INSERT INTO orders
           (order_number, customer_id, conversation_id, lead_id, status, subtotal,
            delivery_fee, discount, total, currency, delivery_address, notes, is_manual, created_by)
           VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            order_number,
            int(body["customer_id"]),
            body.get("conversation_id"),
            body.get("lead_id"),
            subtotal,
            delivery_fee,
            discount,
            total,
            body.get("currency", customer.get("currency") or "NGN"),
            body.get("delivery_address"),
            body.get("notes"),
            is_manual,
            created_by,
        ),
    )
    order_id = cur.lastrowid
    for product_id, description, quantity, unit_price in item_rows:
        con.execute(
            "INSERT INTO order_items (order_id, product_id, description, quantity, unit_price) VALUES (?, ?, ?, ?, ?)",
            (order_id, product_id, description, quantity, unit_price),
        )
    _decrement_stock(con, item_rows)
    log_event(
        con, "order_created", entity_type="order", entity_id=order_id,
        payload={"order_number": order_number, "total": total, "is_manual": bool(is_manual)},
    )
    con.commit()
    return 201, {"order": get_order(con, {}, {"id": str(order_id)}, "")[1]["order"]}


def update_order(con, body, params, query):
    order_id = int(params["id"])
    order = _one(con, "SELECT * FROM orders WHERE id = ?", (order_id,))
    if order is None:
        return 404, {"error": "order not found"}

    if "status" in body:
        new_status = body["status"]
        allowed = ORDER_TRANSITIONS.get(order["status"], ())
        if new_status != order["status"] and new_status not in allowed:
            raise ValueError(
                f"invalid order status transition: {order['status']} -> {new_status}"
            )
        if new_status != order["status"]:
            con.execute(
                "UPDATE orders SET status = ?, updated_at = datetime('now') WHERE id = ?",
                (new_status, order_id),
            )
            log_event(con, f"order_{new_status}", entity_type="order", entity_id=order_id,
                      payload={"order_number": order["order_number"]})
            if new_status == "cancelled":
                _restore_stock(con, order_id)

    fields, args = [], []
    for col in ("delivery_address", "notes"):
        if col in body:
            fields.append(f"{col} = ?")
            args.append(body[col])
    if "delivery_fee" in body:
        fields.append("delivery_fee = ?")
        args.append(float(body["delivery_fee"]))
    if "discount" in body:
        fields.append("discount = ?")
        args.append(float(body["discount"]))
    if fields:
        recalc = "total = subtotal + delivery_fee - discount, "
        fields.append("updated_at = datetime('now')")
        args.append(order_id)
        con.execute(f"UPDATE orders SET {recalc}{', '.join(fields)} WHERE id = ?", args)
    con.commit()
    return 200, {"order": get_order(con, {}, {"id": str(order_id)}, "")[1]["order"]}


ROUTES = [
    ("GET", re.compile(r"^/api/products$"), list_products),
    ("POST", re.compile(r"^/api/products$"), create_product),
    ("GET", re.compile(r"^/api/products/(?P<id>\d+)$"), get_product),
    ("PATCH", re.compile(r"^/api/products/(?P<id>\d+)$"), update_product),
    ("GET", re.compile(r"^/api/orders$"), list_orders),
    ("POST", re.compile(r"^/api/orders$"), create_order),
    ("GET", re.compile(r"^/api/orders/(?P<id>\d+)$"), get_order),
    ("PATCH", re.compile(r"^/api/orders/(?P<id>\d+)$"), update_order),
]