"""Flowdesk core REST API server (Python stdlib + SQLite)."""
import json
import os
import re
import sys
import sqlite3
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import quote

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from server import auth as authmod
from server import db as dbmod
from server.handlers_auth import ROUTES as AUTH_ROUTES
from server.handlers_inbox import ROUTES as INBOX_ROUTES
from server.handlers_customers import ROUTES as CUSTOMER_ROUTES
from server.handlers_catalog import ROUTES as CATALOG_ROUTES
from server.handlers_operations import ROUTES as OPERATIONS_ROUTES
from server.webhooks import ROUTES as WEBHOOK_ROUTES
from server.handlers_automation import ROUTES as AUTOMATION_ROUTES

MAX_BODY = 1_000_000
DASHBOARD_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "web", "dashboard.html"
)
# API paths reachable without a bearer token; everything else under /api/ is protected.
PUBLIC_API_PREFIXES = ("/api/health", "/api/auth/login", "/api/auth/register")


def _auth_required(env_value=None):
    if env_value is None:
        env_value = os.environ.get("FLOWDESK_REQUIRE_AUTH", "")
    return str(env_value).lower() in ("1", "true", "yes", "on")


def ok(obj, code=200):
    return code, obj


class Handler(BaseHTTPRequestHandler):
    server_version = "Flowdesk/1.0"
    routes = []
    require_auth = False

    def log_message(self, fmt, *args):
        pass

    def _dispatch(self, method):
        parsed = self.path.split("?", 1)[0]
        query = self.path.split("?", 1)[1] if "?" in self.path else ""
        # TikTok verifies webhook callbacks via the X-TT-Ws-Token header, but
        # route handlers only receive the query string. Forward the header as a
        # reserved query param so the verify handler can echo it back verbatim.
        if method == "GET" and parsed.startswith("/webhooks/"):
            tt_token = self.headers.get("X-TT-Ws-Token")
            if tt_token:
                query = (query + "&" if query else "") + "x_tt_ws_token=" + quote(tt_token, safe="")
        for route_method, pattern, fn in self.routes:
            if route_method != method:
                continue
            m = pattern.match(parsed)
            if not m:
                continue
            body = {}
            length = int(self.headers.get("Content-Length") or 0)
            if length:
                if length > MAX_BODY:
                    return self._send(413, {"error": "body too large"})
                body = json.loads(self.rfile.read(length).decode("utf-8") or "{}")
            con = dbmod.get_db()
            token = authmod.token_from_header(self.headers)
            if token:
                body["_token"] = token
                user = authmod.user_from_token(con, token)
                if user:
                    body["_user"] = user
            if (
                self.require_auth
                and not body.get("_user")
                and parsed.startswith("/api/")
                and not parsed.startswith(PUBLIC_API_PREFIXES)
            ):
                con.close()
                self._send(401, {"error": "authentication required"})
                return
            try:
                status, payload = fn(con, body, m.groupdict(), query)
                con.commit()
            except ValueError as e:
                con.rollback()
                con.close()
                self._send(400, {"error": str(e)})
                return
            except KeyError as e:
                con.rollback()
                con.close()
                self._send(400, {"error": f"missing field {e}"})
                return
            except PermissionError as e:
                con.rollback()
                con.close()
                code = 401 if str(e) == "authentication required" else 403
                self._send(code, {"error": str(e)})
                return
            except sqlite3.IntegrityError as e:
                con.rollback()
                con.close()
                self._send(409, {"error": f"conflict: {e}"})
                return
            except Exception as e:  # last-resort guard: never drop the connection
                con.rollback()
                con.close()
                self._send(500, {"error": f"internal error: {e}"})
                return
            finally:
                con.close()
            self._send(status, payload)
            return
        if method == "GET" and parsed in ("/", "/dashboard.html", "/index.html"):
            if os.path.exists(DASHBOARD_PATH):
                with open(DASHBOARD_PATH, "rb") as f:
                    data = f.read()
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)
                return
        self._send(404, {"error": "not found"})

    def _send(self, code, payload):
        # Webhook verify handlers return a bare string (the challenge/token)
        # that the platform compares byte-for-byte, so send those as text.
        if isinstance(payload, str):
            data = payload.encode("utf-8")
            content_type = "text/plain; charset=utf-8"
        else:
            data = json.dumps(payload, default=str).encode("utf-8")
            content_type = "application/json"
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        self._dispatch("GET")

    def do_POST(self):
        self._dispatch("POST")

    def do_PUT(self):
        self._dispatch("PUT")

    def do_PATCH(self):
        self._dispatch("PATCH")

    def do_DELETE(self):
        self._dispatch("DELETE")


ROUTES = (
    INBOX_ROUTES + CUSTOMER_ROUTES + CATALOG_ROUTES + WEBHOOK_ROUTES
    + AUTOMATION_ROUTES + OPERATIONS_ROUTES + AUTH_ROUTES
)


def start_server(host="127.0.0.1", port=8080, db_path=None, require_auth=None):
    if db_path:
        dbmod.set_db_path(db_path)
    dbmod.init_db(db_path)
    Handler.routes = ROUTES
    Handler.require_auth = _auth_required(require_auth)
    httpd = ThreadingHTTPServer((host, port), Handler)
    return httpd


def main():
    port = int(os.environ.get("PORT", "8080"))
    dbmod.init_db(os.environ.get("FLOWDESK_DB"))
    Handler.routes = ROUTES
    Handler.require_auth = _auth_required()
    httpd = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    print(f"Flowdesk API listening on :{port}", flush=True)
    httpd.serve_forever()


if __name__ == "__main__":
    main()