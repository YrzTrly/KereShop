"""End-to-end tests for multi-user authentication and role enforcement."""
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


def request(base, method, path, payload=None, token=None):
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    headers = {}
    if data:
        headers["Content-Type"] = "application/json"
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(base + path, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req) as resp:
            return resp.status, json.loads(resp.read().decode("utf-8") or "{}")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode("utf-8") or "{}")


class AuthTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.db_path = os.path.join(cls.tmp.name, "test_auth.db")
        cls.server = app.start_server(
            host="127.0.0.1", port=0, db_path=cls.db_path, require_auth=True
        )
        cls.port = cls.server.server_address[1]
        cls.base = f"http://127.0.0.1:{cls.port}"
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        # Shared state lives on the class: unittest creates a fresh instance per test.
        cls.owner_token = None
        cls.owner_id = None
        cls.staff_id = None
        cls.staff_token = None

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.tmp.cleanup()

    # -- registration & login ------------------------------------------------

    def test_01_first_user_becomes_owner(self):
        status, body = request(self.base, "POST", "/api/auth/register", {
            "name": "Ada Owner",
            "email": "owner@flowdesk.test",
            "password": "correct-horse-1",
        })
        self.assertEqual(status, 201, body)
        self.assertEqual(body["user"]["role"], "owner")
        self.assertTrue(body["token"])
        AuthTests.owner_token = body["token"]
        AuthTests.owner_id = body["user"]["id"]

    def test_02_me_with_token(self):
        status, body = request(self.base, "GET", "/api/auth/me", token=self.owner_token)
        self.assertEqual(status, 200)
        self.assertEqual(body["user"]["email"], "owner@flowdesk.test")
        self.assertNotIn("password_hash", json.dumps(body))

    def test_03_register_requires_fields(self):
        status, body = request(self.base, "POST", "/api/auth/register", {
            "name": "Short", "email": "short@flowdesk.test", "password": "x",
        })
        self.assertEqual(status, 400, body)

    def test_04_duplicate_email_conflict(self):
        status, body = request(self.base, "POST", "/api/auth/register", {
            "name": "Dup",
            "email": "OWNER@flowdesk.test",  # case-insensitive duplicate
            "password": "another-pass-1",
        })
        self.assertEqual(status, 409, body)

    def test_05_login_wrong_password(self):
        status, body = request(self.base, "POST", "/api/auth/login", {
            "email": "owner@flowdesk.test", "password": "wrong-password",
        })
        self.assertEqual(status, 401, body)

    def test_06_login_ok(self):
        status, body = request(self.base, "POST", "/api/auth/login", {
            "email": "owner@flowdesk.test", "password": "correct-horse-1",
        })
        self.assertEqual(status, 200, body)
        self.assertTrue(body["token"])

    # -- role enforcement ----------------------------------------------------

    def test_07_owner_creates_staff(self):
        status, body = request(self.base, "POST", "/api/users", {
            "name": "Sam Staff",
            "email": "staff@flowdesk.test",
            "password": "staff-pass-123",
            "role": "staff",
        }, token=self.owner_token)
        self.assertEqual(status, 201, body)
        self.assertEqual(body["user"]["role"], "staff")
        AuthTests.staff_id = body["user"]["id"]

    def test_08_staff_login(self):
        status, body = request(self.base, "POST", "/api/auth/login", {
            "email": "staff@flowdesk.test", "password": "staff-pass-123",
        })
        self.assertEqual(status, 200, body)
        AuthTests.staff_token = body["token"]

    def test_09_staff_can_read_inbox(self):
        status, body = request(self.base, "GET", "/api/conversations",
                               token=self.staff_token)
        self.assertEqual(status, 200, body)

    def test_10_staff_cannot_list_users(self):
        status, body = request(self.base, "GET", "/api/users",
                               token=self.staff_token)
        self.assertEqual(status, 403, body)

    def test_11_owner_can_list_users(self):
        status, body = request(self.base, "GET", "/api/users",
                               token=self.owner_token)
        self.assertEqual(status, 200, body)
        emails = {u["email"] for u in body["users"]}
        self.assertEqual(emails, {"owner@flowdesk.test", "staff@flowdesk.test"})

    def test_12_staff_cannot_create_users(self):
        status, body = request(self.base, "POST", "/api/users", {
            "name": "Rogue", "email": "rogue@flowdesk.test",
            "password": "rogue-pass-123", "role": "staff",
        }, token=self.staff_token)
        self.assertEqual(status, 403, body)

    def test_13_invalid_role_rejected(self):
        status, body = request(self.base, "POST", "/api/users", {
            "name": "Admin?", "email": "admin@flowdesk.test",
            "password": "admin-pass-123", "role": "admin",
        }, token=self.owner_token)
        self.assertEqual(status, 400, body)

    # -- unauthenticated access ---------------------------------------------

    def test_14_unauthenticated_401(self):
        status, body = request(self.base, "GET", "/api/conversations")
        self.assertEqual(status, 401, body)

    def test_15_health_stays_public(self):
        status, body = request(self.base, "GET", "/api/health")
        self.assertEqual(status, 200, body)

    def test_16_webhooks_stay_public(self):
        payload = {
            "object": "whatsapp_business_account",
            "entry": [{
                "id": "wba-auth-test",
                "changes": [{
                    "field": "messages",
                    "value": {
                        "messaging_product": "whatsapp",
                        "metadata": {"display_phone_number": "234809999999",
                                     "phone_number_id": "123"},
                        "messages": [{
                            "id": "wamid.AUTH1",
                            "from": "234809999999",
                            "type": "text",
                            "text": {"body": "Is the red hijab still available?"},
                        }],
                    },
                }],
            }],
        }
        status, body = request(self.base, "POST", "/webhooks/whatsapp", payload)
        self.assertEqual(status, 200, body)

    # -- session lifecycle ---------------------------------------------------

    def test_17_logout_invalidates_token(self):
        status, body = request(self.base, "POST", "/api/auth/logout", {},
                               token=self.staff_token)
        self.assertEqual(status, 200, body)
        status, body = request(self.base, "GET", "/api/auth/me",
                               token=self.staff_token)
        self.assertEqual(status, 401, body)

    def test_18_inactive_user_cannot_login_and_sessions_revoked(self):
        # Re-login staff (token was revoked in test 17).
        status, body = request(self.base, "POST", "/api/auth/login", {
            "email": "staff@flowdesk.test", "password": "staff-pass-123",
        })
        self.assertEqual(status, 200, body)
        staff_token = body["token"]

        # Owner deactivates the staff account.
        status, body = request(self.base, "PATCH", f"/api/users/{self.staff_id}",
                               {"is_active": False}, token=self.owner_token)
        self.assertEqual(status, 200, body)
        self.assertFalse(body["user"]["is_active"])

        # The live session is revoked immediately.
        status, body = request(self.base, "GET", "/api/auth/me",
                               token=staff_token)
        self.assertEqual(status, 401, body)

        # And login is blocked while the account is inactive.
        status, body = request(self.base, "POST", "/api/auth/login", {
            "email": "staff@flowdesk.test", "password": "staff-pass-123",
        })
        self.assertEqual(status, 401, body)

        # Owner re-activates; login works again.
        status, body = request(self.base, "PATCH", f"/api/users/{self.staff_id}",
                               {"is_active": True}, token=self.owner_token)
        self.assertEqual(status, 200, body)
        status, body = request(self.base, "POST", "/api/auth/login", {
            "email": "staff@flowdesk.test", "password": "staff-pass-123",
        })
        self.assertEqual(status, 200, body)

    def test_19_staff_cannot_modify_themselves(self):
        status, body = request(self.base, "POST", "/api/auth/login", {
            "email": "staff@flowdesk.test", "password": "staff-pass-123",
        })
        self.assertEqual(status, 200)
        staff_token = body["token"]
        status, body = request(self.base, "PATCH", f"/api/users/{self.staff_id}",
                               {"role": "owner"}, token=staff_token)
        self.assertEqual(status, 403, body)


if __name__ == "__main__":
    unittest.main()