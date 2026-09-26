"""Authentication and user-management routes (multi-user support)."""
import re

from server import auth

ROLES = ("owner", "staff")


def _require_user(body):
    """Return the authenticated user or raise/401 via the convention below."""
    user = body.get("_user")
    if not user:
        raise PermissionError("authentication required")
    return user


def _require_owner(body):
    user = _require_user(body)
    if user["role"] != "owner":
        raise PermissionError("owner role required")
    return user


def _public_user(user):
    return auth.public_user(user)


def register(con, body, params, query):
    name = (body.get("name") or "").strip()
    email = (body.get("email") or "").strip().lower()
    password = body.get("password") or ""
    if not name or not email or not password:
        raise ValueError("name, email and password are required")
    if len(password) < 8:
        raise ValueError("password must be at least 8 characters")
    existing = con.execute(
        "SELECT id FROM users WHERE email = ?", (email,)
    ).fetchone()
    if existing:
        return 409, {"error": "a user with this email already exists"}
    first = con.execute("SELECT COUNT(*) AS n FROM users").fetchone()["n"] == 0
    role = "owner" if first else (body.get("role") if body.get("role") in ROLES else "staff")
    if body.get("role") and not first and body.get("role") not in ROLES:
        raise ValueError(f"invalid role: {body.get('role')}")
    cur = con.execute(
        "INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)",
        (name, email, auth.hash_password(password), role),
    )
    user = dict(con.execute("SELECT * FROM users WHERE id = ?", (cur.lastrowid,)).fetchone())
    token = auth.create_session(con, user["id"])
    return 201, {"token": token, "user": _public_user(user)}


def login(con, body, params, query):
    email = (body.get("email") or "").strip().lower()
    password = body.get("password") or ""
    row = con.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
    if row is None or not auth.verify_password(password, row["password_hash"]):
        return 401, {"error": "invalid email or password"}
    user = dict(row)
    if not user["is_active"]:
        return 401, {"error": "account is deactivated"}
    token = auth.create_session(con, user["id"])
    return 200, {"token": token, "user": _public_user(user)}


def me(con, body, params, query):
    user = _require_user(body)
    return 200, {"user": _public_user(user)}


def logout(con, body, params, query):
    token = body.get("_token")
    auth.revoke_token(con, token)
    return 200, {"ok": True}


def list_users(con, body, params, query):
    _require_owner(body)
    users = [
        auth.public_user(dict(r))
        for r in con.execute("SELECT * FROM users ORDER BY id").fetchall()
    ]
    return 200, {"users": users}


def create_user(con, body, params, query):
    _require_owner(body)
    name = (body.get("name") or "").strip()
    email = (body.get("email") or "").strip().lower()
    password = body.get("password") or ""
    role = body.get("role") or "staff"
    if not name or not email or not password:
        raise ValueError("name, email and password are required")
    if len(password) < 8:
        raise ValueError("password must be at least 8 characters")
    if role not in ROLES:
        raise ValueError(f"invalid role: {role}")
    cur = con.execute(
        "INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)",
        (name, email, auth.hash_password(password), role),
    )
    user = dict(con.execute("SELECT * FROM users WHERE id = ?", (cur.lastrowid,)).fetchone())
    return 201, {"user": _public_user(user)}


def update_user(con, body, params, query):
    _require_owner(body)
    user_id = int(params["id"])
    target = con.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    if target is None:
        return 404, {"error": "user not found"}
    target = dict(target)

    if target["id"] == body["_user"]["id"]:
        raise ValueError("you cannot modify your own account here; edit name via /api/auth/me or a future profile endpoint")

    fields, args = [], []
    if "name" in body and body["name"] is not None:
        fields.append("name = ?")
        args.append(str(body["name"]).strip())
    if "role" in body:
        if body["role"] not in ROLES:
            raise ValueError(f"invalid role: {body['role']}")
        fields.append("role = ?")
        args.append(body["role"])
    if "is_active" in body:
        fields.append("is_active = ?")
        args.append(1 if body["is_active"] else 0)
    if "password" in body and body["password"]:
        if len(body["password"]) < 8:
            raise ValueError("password must be at least 8 characters")
        fields.append("password_hash = ?")
        args.append(auth.hash_password(body["password"]))
    if fields:
        args.append(user_id)
        con.execute(f"UPDATE users SET {', '.join(fields)} WHERE id = ?", args)
        if not body.get("is_active", 1) and "is_active" in body:
            auth.revoke_token_for_user(con, user_id)
    updated = dict(con.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone())
    return 200, {"user": _public_user(updated)}


ROUTES = [
    ("POST", re.compile(r"^/api/auth/register$"), register),
    ("POST", re.compile(r"^/api/auth/login$"), login),
    ("GET", re.compile(r"^/api/auth/me$"), me),
    ("POST", re.compile(r"^/api/auth/logout$"), logout),
    ("GET", re.compile(r"^/api/users$"), list_users),
    ("POST", re.compile(r"^/api/users$"), create_user),
    ("PATCH", re.compile(r"^/api/users/(?P<id>\d+)$"), update_user),
]