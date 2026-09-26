"""End-to-end tests for purchase-intent detection, chatbot providers, and automation."""
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

from server import app, automation  # noqa: E402


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


def whatsapp_payload(phone, body, msg_id):
    return {
        "object": "whatsapp_business_account",
        "entry": [
            {
                "id": "wba-test",
                "changes": [
                    {
                        "field": "messages",
                        "value": {
                            "messaging_product": "whatsapp",
                            "metadata": {"display_phone_number": "2348010000000",
                                         "phone_number_id": "123"},
                            "messages": [
                                {
                                    "from": phone,
                                    "id": msg_id,
                                    "timestamp": "1720000000",
                                    "type": "text",
                                    "text": {"body": body},
                                }
                            ],
                        },
                    }
                ],
            }
        ],
    }


def conv_by_phone(base, source, phone):
    status, body = request(base, "GET", f"/api/conversations?source={source}")
    assert status == 200 and body["count"] >= 1, body
    for conv in body["conversations"]:
        if conv.get("customer_phone") == phone:
            return conv
    raise AssertionError(f"no {source} conversation for {phone}")


class AutomationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.db_path = os.path.join(cls.tmp.name, "test_automation.db")
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

    def setUp(self):
        # Settings are shared in-memory across servers in one process;
        # reset to defaults so tests are order-independent.
        automation.update_settings(automation.DEFAULT_SETTINGS)

    def _leads_for(self, conv_id):
        status, body = request(self.base, "GET", "/api/leads")
        self.assertEqual(status, 200, body)
        return [l for l in body.get("leads", []) if l.get("conversation_id") == conv_id]

    def _events(self, type=None):
        path = "/api/automation/events" + (f"?type={type}" if type else "")
        status, body = request(self.base, "GET", path)
        self.assertEqual(status, 200, body)
        return body.get("events", [])

    def _conversation_detail(self, conv_id):
        status, body = request(self.base, "GET", f"/api/conversations/{conv_id}")
        self.assertEqual(status, 200, body)
        return body["conversation"]

    # ------------------------------------------------- intent + auto-reply
    def test_01_intent_webhook_creates_flagged_lead(self):
        phone = "2347000000001"
        status, body = request(
            self.base, "POST", "/webhooks/whatsapp",
            whatsapp_payload(phone, "I want two of these. How much is delivery to Ikeja?", "wamid.intent.1"),
        )
        self.assertEqual(status, 200, body)
        self.assertTrue(body["received"])
        self.assertEqual(body["messages"], 1)

        conv = conv_by_phone(self.base, "whatsapp", phone)
        self.assertEqual(conv["status"], "interested")
        self.assertTrue(conv.get("lead_flagged"))
        self.assertGreaterEqual(conv.get("lead_intent_score"), 0.6)

        leads = self._leads_for(conv["id"])
        self.assertEqual(len(leads), 1)
        lead = leads[0]
        self.assertTrue(lead["flagged"])
        self.assertGreaterEqual(lead["intent_score"], 0.6)
        self.assertEqual(lead["status"], "interested")

        types = {e["event_type"] for e in self._events()}
        self.assertIn("intent_detected", types)
        self.assertIn("lead_flagged", types)
        self.assertIn("auto_reply_sent", types)

        detail = self._conversation_detail(conv["id"])
        outbound = [m for m in detail["messages"] if m["direction"] == "outbound"]
        self.assertGreaterEqual(len(outbound), 1)
        self.assertTrue(any("flowdesk" in m["sender"].lower() for m in outbound))

    # ---------------------------------------------------------------- settings
    def test_02_settings_get_put(self):
        status, body = request(self.base, "GET", "/api/automation/settings")
        self.assertEqual(status, 200)
        settings = body["settings"]
        self.assertEqual(settings["intent_threshold"], 0.6)
        self.assertTrue(settings["auto_reply"])
        self.assertEqual(settings["provider"], "rule_based")

        status, body = request(self.base, "PUT", "/api/automation/settings",
                               {"intent_threshold": 0.5, "follow_up_hours": 12,
                                "bogus_key": "ignored"})
        self.assertEqual(status, 200, body)
        settings = body["settings"]
        self.assertEqual(settings["intent_threshold"], 0.5)
        self.assertEqual(settings["follow_up_hours"], 12)
        self.assertNotIn("bogus_key", settings)

    # -------------------------------------------------------------- providers
    def test_03_providers_list(self):
        status, body = request(self.base, "GET", "/api/automation/providers")
        self.assertEqual(status, 200, body)
        providers = {p["name"]: p for p in body["providers"]}
        self.assertIn("rule_based", providers)
        self.assertTrue(providers["rule_based"]["description"])
        self.assertEqual(body["active"], "rule_based")

    # ------------------------------------------------------------- chatbot test
    def test_04_chatbot_test(self):
        status, body = request(self.base, "POST", "/api/automation/chatbot/test",
                               {"message": "What is the price?"})
        self.assertEqual(status, 200, body)
        self.assertEqual(body["provider"], "rule_based")
        self.assertTrue(body["reply"])
        self.assertIn("score", body["intent"])
        self.assertGreater(body["intent"]["score"], 0)

        status, body = request(self.base, "POST", "/api/automation/chatbot/test", {"message": ""})
        self.assertEqual(status, 400, body)
        self.assertIn("message", body["error"])

    # -------------------------------------------------------------- follow-ups
    def test_05_follow_ups(self):
        phone = "2347000000002"
        status, body = request(
            self.base, "POST", "/webhooks/whatsapp",
            whatsapp_payload(phone, "I want two of these. How much is delivery to Lekki?", "wamid.fu.1"),
        )
        self.assertEqual(status, 200, body)
        conv = conv_by_phone(self.base, "whatsapp", phone)

        con = sqlite3.connect(self.db_path)
        con.execute("UPDATE conversations SET last_message_at = datetime('now', '-25 hours') "
                    "WHERE id = ?", (conv["id"],))
        con.commit()
        con.close()

        status, body = request(self.base, "POST", "/api/automation/follow-ups", {})
        self.assertEqual(status, 200, body)
        self.assertGreaterEqual(body["follow_ups_sent"], 1)
        self.assertGreaterEqual(body["scanned"], 1)

        detail = self._conversation_detail(conv["id"])
        follow_ups = [m for m in detail["messages"]
                      if m["direction"] == "outbound" and "follow" in m["body"].lower()]
        self.assertGreaterEqual(len(follow_ups), 1)
        self.assertTrue(any(e["event_type"] == "follow_up_sent"
                            for e in self._events("follow_up_sent")))

        # Re-run: the follow-up is deduped, so nothing is sent again.
        status, body = request(self.base, "POST", "/api/automation/follow-ups", {})
        self.assertEqual(status, 200, body)
        self.assertEqual(body["follow_ups_sent"], 0)

    # -------------------------------------------------------------- reminders
    def test_06_reminders(self):
        phone = "2347000000003"
        status, body = request(
            self.base, "POST", "/webhooks/whatsapp",
            whatsapp_payload(phone, "Hello, is the store open?", "wamid.rem.1"),
        )
        self.assertEqual(status, 200, body)
        conv = conv_by_phone(self.base, "whatsapp", phone)

        status, body = request(self.base, "POST", "/api/orders", {
            "customer_id": conv["customer_id"],
            "conversation_id": conv["id"],
            "items": [{"description": "Gift wrapping", "quantity": 1, "unit_price": 500}],
        })
        self.assertEqual(status, 201, body)
        order_id = body["order"]["id"]

        con = sqlite3.connect(self.db_path)
        con.execute("UPDATE orders SET created_at = datetime('now', '-49 hours') "
                    "WHERE id = ?", (order_id,))
        con.commit()
        con.close()

        status, body = request(self.base, "POST", "/api/automation/reminders", {})
        self.assertEqual(status, 200, body)
        self.assertGreaterEqual(body["reminders_sent"], 1)
        self.assertTrue(any(e["event_type"] == "reminder_sent"
                            for e in self._events("reminder_sent")))

        # Re-run: deduped.
        status, body = request(self.base, "POST", "/api/automation/reminders", {})
        self.assertEqual(status, 200, body)
        self.assertEqual(body["reminders_sent"], 0)

    # ------------------------------------------------- order confirmations
    def test_07_order_confirmation_on_lead_transition(self):
        phone = "2347000000004"
        status, body = request(
            self.base, "POST", "/webhooks/whatsapp",
            whatsapp_payload(phone, "I want one. How much is delivery to Ikeja?", "wamid.oc.1"),
        )
        self.assertEqual(status, 200, body)
        conv = conv_by_phone(self.base, "whatsapp", phone)
        leads = self._leads_for(conv["id"])
        self.assertEqual(len(leads), 1)

        status, body = request(self.base, "PATCH", f"/api/leads/{leads[0]['id']}",
                               {"status": "order"})
        self.assertEqual(status, 200, body)
        self.assertEqual(body["lead"]["status"], "order")

        events = self._events("order_confirmation_sent")
        self.assertGreaterEqual(len(events), 1)

        detail = self._conversation_detail(conv["id"])
        confirmations = [m for m in detail["messages"]
                         if m["direction"] == "outbound" and "order" in m["body"].lower()]
        self.assertGreaterEqual(len(confirmations), 1)

    # ---------------------------------------------------------------- events
    def test_08_events_filter(self):
        events = self._events("intent_detected")
        self.assertGreaterEqual(len(events), 1)
        self.assertTrue(all(e["event_type"] == "intent_detected" for e in events))
        # payload is parsed back to a dict where present
        parsed = [e for e in events if isinstance(e.get("payload"), dict)]
        self.assertGreaterEqual(len(parsed), 1)


if __name__ == "__main__":
    unittest.main()