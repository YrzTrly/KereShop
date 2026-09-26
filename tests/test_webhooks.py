"""End-to-end tests for the WhatsApp/Instagram/TikTok webhook adapters and reply stubs."""
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


def raw_request(base, method, path, headers=None):
    req = urllib.request.Request(base + path, method=method, headers=headers or {})
    try:
        with urllib.request.urlopen(req) as resp:
            return resp.status, resp.read().decode("utf-8"), dict(resp.headers)
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8"), dict(e.headers)


def last_conv(base, source):
    status, body = request(base, "GET", f"/api/conversations?source={source}")
    assert status == 200 and body["count"] >= 1, body
    return body["conversations"][0]


def conv_by_phone(base, source, phone):
    status, body = request(base, "GET", f"/api/conversations?source={source}")
    assert status == 200 and body["count"] >= 1, body
    for conv in body["conversations"]:
        if conv.get("customer_phone") == phone:
            return conv
    raise AssertionError(f"no {source} conversation for {phone}")


class WebhookTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.db_path = os.path.join(cls.tmp.name, "test_webhooks.db")
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

    # ------------------------------------------------------------- WhatsApp
    def test_01_whatsapp_ingest(self):
        payload = {
            "object": "whatsapp_business_account",
            "entry": [
                {
                    "id": "wba-1",
                    "changes": [
                        {
                            "field": "messages",
                            "value": {
                                "messaging_product": "whatsapp",
                                "metadata": {"display_phone_number": "2348010000000", "phone_number_id": "123"},
                                "messages": [
                                    {
                                        "from": "2348012345678",
                                        "id": "wamid.HBgM",
                                        "timestamp": "1720000000",
                                        "type": "text",
                                        "text": {"body": "Hi, do you still have the black one?"},
                                    }
                                ],
                            },
                        }
                    ],
                }
            ],
        }
        status, body = request(self.base, "POST", "/webhooks/whatsapp", payload)
        self.assertEqual(status, 200)
        self.assertTrue(body["received"])
        self.assertEqual(body["messages"], 1)

        conv = last_conv(self.base, "whatsapp")
        self.assertEqual(conv["source"], "whatsapp")
        self.assertEqual(conv["customer_phone"], "2348012345678")
        # Auto-reply (enabled by default) is the latest message; the
        # customer's original message stays in the thread.
        self.assertEqual(
            conv["last_message_body"],
            "Hello! Thanks for reaching out. What would you like to order today?",
        )
        self.assertEqual(conv["last_message_direction"], "outbound")
        self.assertEqual(conv["unread"], 1)
        status, cbody = request(self.base, "GET", f"/api/conversations/{conv['id']}")
        self.assertEqual(status, 200)
        bodies = [m["body"] for m in cbody["conversation"]["messages"]]
        self.assertIn("Hi, do you still have the black one?", bodies)

    def test_02_whatsapp_dedup(self):
        """The same (phone, body) pair posted twice must not duplicate the message."""
        payload = {
            "entry": [
                {
                    "id": "wba-1",
                    "changes": [
                        {
                            "field": "messages",
                            "value": {
                                "messaging_product": "whatsapp",
                                "messages": [
                                    {
                                        "from": "2348019999999",
                                        "id": "dup.1",
                                        "timestamp": "1720000001",
                                        "type": "text",
                                        "text": {"body": "delivery time?"},
                                    }
                                ],
                            },
                        }
                    ],
                }
            ],
        }
        s1, b1 = request(self.base, "POST", "/webhooks/whatsapp", payload)
        s2, b2 = request(self.base, "POST", "/webhooks/whatsapp", payload)
        self.assertEqual((s1, s2), (200, 200))
        self.assertEqual(b1["messages"], 1)
        self.assertEqual(b2["messages"], 0)
        conv = last_conv(self.base, "whatsapp")
        status, body = request(self.base, "GET", f"/api/conversations/{conv['id']}")
        self.assertEqual(status, 200)
        bodies = [m["body"] for m in body["conversation"]["messages"]]
        self.assertEqual(bodies.count("delivery time?"), 1)

    # ----------------------------------------------------------- Instagram
    def test_03_instagram_ingest(self):
        payload = {
            "object": "instagram",
            "entry": [
                {
                    "id": "ig-user-1",
                    "time": 1720000100,
                    "changes": [
                        {
                            "field": "messages",
                            "value": {
                                "messaging_product": "instagram",
                                "messages": [
                                    {
                                        "id": "ig_msg_1",
                                        "timestamp": 1720000100,
                                        "from": {"id": "ig-external-42", "name": "Ada Okafor"},
                                        "text": "What's the price for the cream?",
                                    }
                                ],
                            },
                        }
                    ],
                }
            ],
        }
        status, body = request(self.base, "POST", "/webhooks/instagram", payload)
        self.assertEqual(status, 200)
        self.assertEqual(body["messages"], 1)

        conv = last_conv(self.base, "instagram")
        self.assertEqual(conv["source"], "instagram")
        self.assertEqual(conv["customer_name"], "Ada Okafor")
        # Price question triggers the default auto-reply; the customer's
        # message remains in the thread.
        self.assertEqual(
            conv["last_message_body"],
            "Thanks for your interest! Prices depend on the product and "
            "quantity. Tell me what you would like to order and I will "
            "confirm the total for you.",
        )
        self.assertEqual(conv["last_message_direction"], "outbound")
        status, cbody = request(self.base, "GET", f"/api/conversations/{conv['id']}")
        self.assertEqual(status, 200)
        bodies = [m["body"] for m in cbody["conversation"]["messages"]]
        self.assertIn("What's the price for the cream?", bodies)

    # -------------------------------------------------------------- TikTok
    def test_04_tiktok_comment_ingest(self):
        payload = {
            "challenge_id": "170",
            "event": {
                "id": "evt_1",
                "time": 1720000200,
                "type": "comment",
                "comment": {
                    "id": "c_1",
                    "text": "PRICE",
                    "author": {"nickname": "chiko_baby_", "user_id": "tt-user-77"},
                },
            },
            "video_id": "v_1",
        }
        status, body = request(self.base, "POST", "/webhooks/tiktok", payload)
        self.assertEqual(status, 200)
        self.assertEqual(body["messages"], 1)

        conv = last_conv(self.base, "tiktok")
        self.assertEqual(conv["source"], "tiktok")
        self.assertEqual(conv["customer_name"], "Chiko Baby")
        # "PRICE" matches the price FAQ, so the default auto-reply is the
        # latest message; the comment itself is still first in the thread.
        self.assertEqual(
            conv["last_message_body"],
            "Thanks for your interest! Prices depend on the product and "
            "quantity. Tell me what you would like to order and I will "
            "confirm the total for you.",
        )
        self.assertEqual(conv["last_message_direction"], "outbound")

        status, cbody = request(self.base, "GET", f"/api/conversations/{conv['id']}")
        self.assertEqual(status, 200)
        msgs = cbody["conversation"]["messages"]
        self.assertEqual(msgs[0]["message_type"], "comment")
        self.assertEqual(msgs[0]["sender"], "chiko_baby_")

    def test_05_tiktok_non_comment_ignored(self):
        payload = {"event": {"type": "like", "comment": {"text": "nice"}}}
        status, body = request(self.base, "POST", "/webhooks/tiktok", payload)
        self.assertEqual(status, 200)
        self.assertEqual(body["messages"], 0)

    # --------------------------------------------------------------- reply
    def test_06_reply_via_stub_and_outbox(self):
        conv = conv_by_phone(self.base, "whatsapp", "2348012345678")
        status, body = request(
            self.base, "POST", f"/api/conversations/{conv['id']}/reply",
            {"body": "Yes it's available, how many do you need?"},
        )
        self.assertEqual(status, 200)
        self.assertTrue(body["sent"])
        self.assertEqual(body["channel"], "whatsapp")
        self.assertEqual(body["provider_response"]["status"], "stub")
        self.assertEqual(body["provider_response"]["provider"], "whatsapp")
        self.assertEqual(body["provider_response"]["to"], "2348012345678")

        # Outbound messages persisted on the conversation: the default
        # auto-reply from ingestion (test_01) plus this manual reply.
        status, cbody = request(self.base, "GET", f"/api/conversations/{conv['id']}")
        outbound = [m for m in cbody["conversation"]["messages"] if m["direction"] == "outbound"]
        self.assertEqual(len(outbound), 2)
        self.assertEqual(outbound[0]["sender"], "flowdesk-automation")
        self.assertEqual(outbound[1]["body"], "Yes it's available, how many do you need?")
        self.assertEqual(outbound[1]["sender"], "flowdesk")

        # Provider stub call recorded in the outbox log.
        status, obox = request(self.base, "GET", "/api/replies/outbox")
        self.assertEqual(status, 200)
        self.assertGreaterEqual(obox["count"], 1)
        self.assertEqual(obox["outbox"][0]["provider"], "whatsapp")
        self.assertEqual(obox["outbox"][0]["status"], "stub")

    def test_07_reply_missing_body_rejected(self):
        conv = last_conv(self.base, "whatsapp")
        status, body = request(self.base, "POST", f"/api/conversations/{conv['id']}/reply", {})
        self.assertEqual(status, 400)
        self.assertIn("error", body)

    def test_08_reply_unknown_conversation_404(self):
        status, body = request(self.base, "POST", "/api/conversations/999999/reply", {"body": "hi"})
        self.assertEqual(status, 404)

    def test_09_whatsapp_get_verifies_challenge(self):
        status, body, headers = raw_request(
            self.base,
            "GET",
            "/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=abc&hub.challenge=112233",
        )
        self.assertEqual(status, 200)
        self.assertEqual(body, "112233")
        self.assertIn("text/plain", headers.get("Content-Type", ""))

    def test_10_instagram_get_verifies_challenge(self):
        status, body, _ = raw_request(
            self.base,
            "GET",
            "/webhooks/instagram?hub.mode=subscribe&hub.challenge=998877",
        )
        self.assertEqual(status, 200)
        self.assertEqual(body, "998877")

    def test_11_tiktok_get_echoes_ws_token(self):
        status, body, _ = raw_request(
            self.base,
            "GET",
            "/webhooks/tiktok",
            headers={"X-TT-Ws-Token": "tok_123"},
        )
        self.assertEqual(status, 200)
        self.assertEqual(body, "tok_123")

    def test_12_webhook_get_without_challenge_is_alive(self):
        status, body, _ = raw_request(self.base, "GET", "/webhooks/whatsapp")
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body), {"verified": True, "source": "whatsapp"})

    def test_13_meta_token_mismatch_is_rejected(self):
        os.environ["FLOWDESK_WEBHOOK_VERIFY_TOKEN"] = "secret"
        try:
            status, body, _ = raw_request(
                self.base,
                "GET",
                "/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=112233",
            )
            self.assertEqual(status, 403)
            self.assertIn("invalid hub.verify_token", json.loads(body)["error"])
            status, body, _ = raw_request(
                self.base,
                "GET",
                "/webhooks/instagram?hub.mode=subscribe&hub.verify_token=secret&hub.challenge=424242",
            )
            self.assertEqual(status, 200)
            self.assertEqual(body, "424242")
        finally:
            del os.environ["FLOWDESK_WEBHOOK_VERIFY_TOKEN"]

    def test_14_tiktok_token_mismatch_is_rejected(self):
        os.environ["FLOWDESK_TIKTOK_WS_TOKEN"] = "real"
        try:
            status, body, _ = raw_request(
                self.base, "GET", "/webhooks/tiktok",
                headers={"X-TT-Ws-Token": "forged"},
            )
            self.assertEqual(status, 403)
            self.assertIn("invalid X-TT-Ws-Token", json.loads(body)["error"])
            status, body, _ = raw_request(
                self.base, "GET", "/webhooks/tiktok",
                headers={"X-TT-Ws-Token": "real"},
            )
            self.assertEqual(status, 200)
            self.assertEqual(body, "real")
        finally:
            del os.environ["FLOWDESK_TIKTOK_WS_TOKEN"]


if __name__ == "__main__":
    unittest.main()