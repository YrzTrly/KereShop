"""End-to-end tests for manual orders, inventory, deliveries, analytics."""
import json
import os
import sqlite3
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from server import app  # noqa: E402


def request(base, method, path, payload=None):
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    req = urllib.request.Request(
        base + path, data=data, method=method,
        headers={"Content-Type": "application/json"} if data else {},
    )
    try:
        with urllib.request.urlopen(req) as resp:
            return resp.status, json.loads(resp.read().decode("utf-8") or "{}")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode("utf-8") or "{}")


class OperationsTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.db_path = os.path.join(cls.tmp.name, "test.db")
        cls.server = app.start_server(host="127.0.0.1", port=0, db_path=cls.db_path)
        cls.port = cls.server.server_address[1]
        cls.base = f"http://127.0.0.1:{cls.port}"
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.tmp.cleanup()

    def test_full_order_lifecycle(self):
        # 1. Product with known stock.
        status, body = request(self.base, "POST", "/api/products", {
            "name": "Ankara dress", "price": 15000, "stock_quantity": 10,
        })
        self.assertEqual(status, 201, body)
        product_id = body["product"]["id"]
        self.assertEqual(body["product"]["stock_quantity"], 10)

        # 2. Customer, then a manual order (no conversation context).
        status, body = request(self.base, "POST", "/api/customers", {
            "name": "Manual Buyer", "phone": "2348031112223",
        })
        self.assertEqual(status, 201, body)
        customer_id = body["customer"]["id"]

        status, body = request(self.base, "POST", "/api/orders", {
            "customer_id": customer_id,
            "items": [{"product_id": product_id, "quantity": 2}],
            "delivery_fee": 3000,
            "delivery_address": "12 Market St, Ikeja",
        })
        self.assertEqual(status, 201, body)
        order = body["order"]
        self.assertTrue(order["is_manual"])
        self.assertEqual(order["status"], "pending")
        self.assertEqual(order["subtotal"], 30000)
        self.assertEqual(order["total"], 33000)
        order_id = order["id"]

        # 3. Stock decremented at order time.
        status, body = request(self.base, "GET", f"/api/products/{product_id}")
        self.assertEqual(status, 200)
        self.assertEqual(body["product"]["stock_quantity"], 8)

        # 4. Delivery: creating one for a pending order auto-ships it.
        status, body = request(
            self.base, "POST", f"/api/orders/{order_id}/deliveries",
            {"provider": "GIG", "tracking_number": "GIG-999"},
        )
        self.assertEqual(status, 201, body)
        delivery = body["delivery"]
        self.assertEqual(delivery["status"], "pending")
        self.assertEqual(body["order"]["status"], "shipped")

        # 5. Progress delivery through its allowed transitions.
        status, _ = request(
            self.base, "PATCH", f"/api/deliveries/{delivery['id']}",
            {"status": "in_transit"},
        )
        self.assertEqual(status, 200)
        status, body = request(
            self.base, "PATCH", f"/api/deliveries/{delivery['id']}",
            {"status": "delivered"},
        )
        self.assertEqual(status, 200)
        self.assertEqual(body["delivery"]["status"], "delivered")
        self.assertIsNotNone(body["delivery"]["delivered_at"])

        # 6. Analytics: revenue counts the settled order; one order total.
        status, body = request(self.base, "GET", "/api/analytics/summary")
        self.assertEqual(status, 200)
        self.assertEqual(body["revenue"], 33000)
        self.assertEqual(body["orders"]["total"], 1)
        self.assertEqual(body["orders"]["by_status"].get("delivered"), 1)
        self.assertTrue(any(p["product_id"] == product_id for p in body["top_products"]))
        event_types = {e["event_type"] for e in body["event_counts"]}
        self.assertIn("order_created", event_types)

        # 7. Rollback path: cancelling a completed order restores stock.
        status, body = request(
            self.base, "PATCH", f"/api/orders/{order_id}", {"status": "cancelled"},
        )
        self.assertEqual(status, 200, body)
        status, body = request(self.base, "GET", f"/api/products/{product_id}")
        self.assertEqual(body["product"]["stock_quantity"], 10)

    def test_order_validation(self):
        # Missing customer.
        status, body = request(self.base, "POST", "/api/orders", {"items": []})
        self.assertEqual(status, 400)
        # Unknown customer.
        status, body = request(self.base, "POST", "/api/orders", {
            "customer_id": 99999, "items": [{"description": "x", "quantity": 1, "unit_price": 1}],
        })
        self.assertEqual(status, 400)
        # Empty items.
        status, body = request(self.base, "POST", "/api/orders", {
            "customer_id": 1, "items": [],
        })
        self.assertEqual(status, 400)

    def test_inventory_low_stock_flag(self):
        con = sqlite3.connect(self.db_path)
        con.row_factory = sqlite3.Row
        row = con.execute("SELECT * FROM products ORDER BY id LIMIT 1").fetchone()
        con.execute(
            "UPDATE inventory SET stock_quantity = 1 WHERE product_id = ?",
            (row["id"],),
        )
        con.commit()
        con.close()
        status, body = request(self.base, "GET", "/api/products")
        self.assertEqual(status, 200)
        self.assertTrue(body["products"][0]["low_stock"])


if __name__ == "__main__":
    unittest.main()