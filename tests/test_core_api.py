"""End-to-end tests for the Flowdesk core REST API (inbox, customers, leads, catalog, orders)."""
import json
import os
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


class CoreApiTests(unittest.TestCase):
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

    # ------------------------------------------------------------- health
    def test_00_health(self):
        status, body = request(self.base, "GET", "/api/health")
        self.assertEqual(status, 200)
        self.assertEqual(body["status"], "ok")

    # --------------------------------------------------------- inbox
    def test_01_create_conversation_with_customer(self):
        status, body = request(self.base, "POST", "/api/conversations", {
            "source": "whatsapp",
            "customer": {"name": "Ada Obi", "phone": "+2348011112222", "platform": "whatsapp"},
            "first_message": {"body": "Hi, do you deliver to Lekki?"},
        })
        self.assertEqual(status, 201, body)
        conv = body["conversation"]
        self.assertEqual(conv["source"], "whatsapp")
        self.assertEqual(conv["status"], "new_inquiry")
        self.assertEqual(conv["customer_name"], "Ada Obi")
        self.assertEqual(conv["messages"][0]["body"], "Hi, do you deliver to Lekki?")
        self.assertEqual(conv["messages"][0]["direction"], "inbound")
        CoreApiTests.conversation_id = conv["id"]
        CoreApiTests.customer_id = conv["customer_id"]

    def test_02_conversation_appears_in_inbox(self):
        status, body = request(self.base, "GET", "/api/conversations?status=new_inquiry")
        self.assertEqual(status, 200)
        ids = [c["id"] for c in body["conversations"]]
        self.assertIn(self.conversation_id, ids)
        row = next(c for c in body["conversations"] if c["id"] == self.conversation_id)
        self.assertEqual(row["last_message_body"], "Hi, do you deliver to Lekki?")
        self.assertEqual(row["customer_name"], "Ada Obi")
        # filter by source
        status, body = request(self.base, "GET", "/api/conversations?source=instagram")
        self.assertEqual(status, 200)
        self.assertNotIn(self.conversation_id, [c["id"] for c in body["conversations"]])

    def test_03_outbound_reply_and_read_state(self):
        status, body = request(self.base, "POST", f"/api/conversations/{self.conversation_id}/messages", {
            "body": "Yes we do! Delivery to Lekki is NGN 2,000.",
        })
        self.assertEqual(status, 201, body)
        self.assertEqual(body["message"]["direction"], "outbound")

        status, body = request(self.base, "GET", f"/api/conversations/{self.conversation_id}")
        self.assertEqual(len(body["conversation"]["messages"]), 2)
        self.assertTrue(body["conversation"]["unread"])

        status, body = request(self.base, "POST", f"/api/conversations/{self.conversation_id}/read")
        self.assertEqual(status, 200)
        status, body = request(self.base, "GET", f"/api/conversations/{self.conversation_id}")
        self.assertFalse(body["conversation"]["unread"])

    def test_04_inbound_replies_are_unread(self):
        status, _ = request(self.base, "POST", f"/api/conversations/{self.conversation_id}/messages", {
            "body": "Great, I'll take two of the black ones.", "direction": "inbound",
        })
        self.assertEqual(status, 201)
        status, body = request(self.base, "GET", f"/api/conversations/{self.conversation_id}")
        self.assertTrue(body["conversation"]["unread"])

    def test_05_missing_conversation_404(self):
        status, body = request(self.base, "GET", "/api/conversations/999999")
        self.assertEqual(status, 404)
        self.assertIn("error", body)

    # ------------------------------------------------------ customers
    def test_06_customer_profile(self):
        status, body = request(self.base, "GET", f"/api/customers/{self.customer_id}")
        self.assertEqual(status, 200)
        cust = body["customer"]
        self.assertEqual(cust["name"], "Ada Obi")
        self.assertEqual(cust["phone"], "+2348011112222")
        self.assertTrue(cust["conversations"])
        self.assertEqual(cust["conversations"][0]["id"], self.conversation_id)

    def test_07_create_and_search_customers(self):
        status, body = request(self.base, "POST", "/api/customers", {
            "name": "Chike Eze", "phone": "+2348099998888", "platform": "instagram",
            "location": "Ikeja",
        })
        self.assertEqual(status, 201, body)
        chike_id = body["customer"]["id"]
        CoreApiTests.chike_id = chike_id

        status, body = request(self.base, "GET", "/api/customers?q=chike")
        self.assertEqual(status, 200)
        self.assertEqual([c["id"] for c in body["customers"]], [chike_id])

        # duplicate phone upserts instead of failing
        status, body = request(self.base, "POST", "/api/customers", {
            "name": "Chike Eze", "phone": "+2348099998888",
        })
        self.assertEqual(status in (200, 201), True, body)
        status, body = request(self.base, "GET", "/api/customers?q=+2348099998888")
        self.assertEqual(body["total"], 1)

    # ---------------------------------------------------------- leads
    def test_08_lead_created_from_conversation(self):
        status, body = request(self.base, "POST", "/api/leads", {
            "conversation_id": self.conversation_id,
        })
        self.assertEqual(status, 201, body)
        self.assertEqual(body["lead"]["status"], "new_inquiry")
        CoreApiTests.lead_id = body["lead"]["id"]

        # conversation list now exposes the lead
        status, body = request(self.base, "GET", "/api/conversations")
        row = next(c for c in body["conversations"] if c["id"] == self.conversation_id)
        self.assertEqual(row["lead_status"], "new_inquiry")

    def test_09_lead_forward_transitions(self):
        for next_status in ("interested", "order", "completed"):
            status, body = request(self.base, "PATCH", f"/api/leads/{self.lead_id}", {
                "status": next_status,
            })
            self.assertEqual(status, 200, body)
            self.assertEqual(body["lead"]["status"], next_status)

        # conversation status tracks the pipeline
        status, body = request(self.base, "GET", "/api/conversations")
        row = next(c for c in body["conversations"] if c["id"] == self.conversation_id)
        self.assertEqual(row["status"], "completed")
        self.assertEqual(row["lead_status"], "completed")

    def test_10_lead_invalid_transitions_rejected(self):
        # new_inquiry -> order skips steps
        status, body = request(self.base, "PATCH", f"/api/leads/{self.lead_id}", {
            "status": "order",
        })
        self.assertEqual(status, 400)
        self.assertIn("transition", body["error"])
        # backwards transition
        status, body = request(self.base, "PATCH", f"/api/leads/{self.lead_id}", {
            "status": "interested",
        })
        self.assertEqual(status, 400)
        # unknown status
        status, body = request(self.base, "PATCH", f"/api/leads/{self.lead_id}", {
            "status": "famous",
        })
        self.assertEqual(status, 400)

    def test_11_lead_lost_and_list_filter(self):
        status, body = request(self.base, "PATCH", f"/api/leads/{self.lead_id}", {"status": "lost"})
        self.assertEqual(status, 200, body)
        self.assertEqual(body["lead"]["status"], "lost")

        status, body = request(self.base, "GET", "/api/leads?status=lost")
        self.assertEqual(status, 200)
        self.assertEqual([l["id"] for l in body["leads"]], [self.lead_id])

        status, body = request(self.base, "GET", "/api/leads")
        self.assertEqual(body["total"], 1)

    # -------------------------------------------------------- products
    def test_12_create_products(self):
        status, body = request(self.base, "POST", "/api/products", {
            "name": "Black Tote Bag", "description": "Handmade tote",
            "price": 18500, "currency": "NGN", "sku": "BAG-BLK-01",
            "stock_quantity": 12, "low_stock_threshold": 3,
        })
        self.assertEqual(status, 201, body)
        self.assertEqual(body["product"]["stock_quantity"], 12)
        CoreApiTests.product_bag = body["product"]["id"]

        status, body = request(self.base, "POST", "/api/products", {
            "name": "Canvas Sneakers", "price": 24000, "sku": "SNK-CNV-02", "stock_quantity": 0,
        })
        self.assertEqual(status, 201, body)
        CoreApiTests.product_sneakers = body["product"]["id"]

    def test_13_list_and_get_products(self):
        status, body = request(self.base, "GET", "/api/products")
        self.assertEqual(status, 200)
        self.assertEqual(body["total"], 2)

        status, body = request(self.base, "GET", f"/api/products/{self.product_bag}")
        self.assertEqual(body["product"]["name"], "Black Tote Bag")
        self.assertEqual(body["product"]["stock_quantity"], 12)

        status, body = request(self.base, "GET", "/api/products?q=tote")
        self.assertEqual([p["id"] for p in body["products"]], [self.product_bag])

    def test_14_update_product_price_and_stock(self):
        status, body = request(self.base, "PATCH", f"/api/products/{self.product_bag}", {
            "price": 20000, "stock_quantity": 10,
        })
        self.assertEqual(status, 200, body)
        self.assertEqual(body["product"]["price"], 20000.0)
        self.assertEqual(body["product"]["stock_quantity"], 10)

        status, body = request(self.base, "GET", "/api/products/999999")
        self.assertEqual(status, 404)

    # ----------------------------------------------------------- orders
    def test_15_create_order_from_conversation(self):
        status, body = request(self.base, "POST", "/api/orders", {
            "customer_id": self.customer_id,
            "conversation_id": self.conversation_id,
            "lead_id": self.lead_id,
            "items": [
                {"product_id": self.product_bag, "quantity": 2},
                {"description": "Gift wrapping", "quantity": 1, "unit_price": 500},
            ],
            "delivery_fee": 2000,
            "discount": 1000,
            "currency": "NGN",
            "delivery_address": "12 Admiralty Way, Lekki Phase 1, Lagos",
            "notes": "Customer prefers afternoon delivery",
        })
        self.assertEqual(status, 201, body)
        order = body["order"]
        self.assertEqual(order["order_number"], "FD-0001")
        # subtotal = 2 * 20000 + 500 = 40500; total = 40500 + 2000 - 1000 = 41500
        self.assertEqual(order["subtotal"], 40500.0)
        self.assertEqual(order["total"], 41500.0)
        self.assertEqual(order["status"], "pending")
        self.assertEqual(len(order["items"]), 2)
        self.assertTrue(any(i["product_id"] == self.product_bag for i in order["items"]))
        CoreApiTests.order_id = order["id"]

    def test_16_manual_order(self):
        status, body = request(self.base, "POST", "/api/orders", {
            "customer_id": self.chike_id,
            "items": [{"description": "Studio session (offline)", "quantity": 1, "unit_price": 50000}],
            "delivery_address": "Ikeja",
        })
        self.assertEqual(status, 201, body)
        self.assertTrue(body["order"]["is_manual"])
        self.assertEqual(body["order"]["order_number"], "FD-0002")
        CoreApiTests.manual_order_id = body["order"]["id"]

    def test_17_order_status_flow(self):
        for next_status in ("shipped", "delivered", "completed"):
            status, body = request(self.base, "PATCH", f"/api/orders/{self.order_id}", {
                "status": next_status,
            })
            self.assertEqual(status, 200, body)
            self.assertEqual(body["order"]["status"], next_status)

        # invalid skip: pending -> delivered (skips shipped)
        status, body = request(self.base, "PATCH", f"/api/orders/{self.manual_order_id}", {
            "status": "delivered",
        })
        self.assertEqual(status, 400)
        self.assertIn("transition", body["error"])

        # cancellation is allowed from pending
        status, body = request(self.base, "PATCH", f"/api/orders/{self.manual_order_id}", {
            "status": "cancelled",
        })
        self.assertEqual(status, 200, body)
        self.assertEqual(body["order"]["status"], "cancelled")

        # completed -> pending is not allowed
        status, body = request(self.base, "PATCH", f"/api/orders/{self.order_id}", {
            "status": "pending",
        })
        self.assertEqual(status, 400)

    def test_18_list_orders_filters(self):
        status, body = request(self.base, "GET", "/api/orders?status=completed")
        self.assertEqual(status, 200)
        self.assertEqual([o["id"] for o in body["orders"]], [self.order_id])

        status, body = request(self.base, "GET", "/api/orders?customer_id=%d" % self.chike_id)
        self.assertEqual([o["id"] for o in body["orders"]], [self.manual_order_id])

    def test_19_order_requires_items_and_customer(self):
        status, body = request(self.base, "POST", "/api/orders", {"customer_id": self.customer_id})
        self.assertEqual(status, 400)
        status, body = request(self.base, "POST", "/api/orders", {
            "customer_id": self.customer_id,
            "items": [{"quantity": 1, "unit_price": 100}],
        })
        # missing description for a non-product item
        self.assertEqual(status, 400)
        status, body = request(self.base, "POST", "/api/orders", {
            "items": [{"product_id": self.product_bag, "quantity": 1}],
        })
        self.assertEqual(status, 400)

    def test_20_missing_route_404(self):
        status, body = request(self.base, "GET", "/api/nope")
        self.assertEqual(status, 404)


if __name__ == "__main__":
    unittest.main()