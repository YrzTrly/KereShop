"""Session auth: password hashing, bearer tokens, role helpers (stdlib only)."""
import hashlib
import hmac
import secrets

PBKDF2_ITERATIONS = 120_000
SESSION_TTL_DAYS = 30


def hash_password(password: str, salt: str | None = None) -> str:
    salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), bytes.fromhex(salt), PBKDF2_ITERATIONS
    ).hex()
    return f"pbkdf2${PBKDF2_ITERATIONS}${salt}${digest}"


def verify_password(password: str, stored: str) -> bool:
    try:
        algo, iters, salt, digest = stored.split("$")
        if algo != "pbkdf2":
            return False
        candidate = hashlib.pbkdf2_hmac(
            "sha256", password.encode("utf-8"), bytes.fromhex(salt), int(iters)
        ).hex()
        return hmac.compare_digest(candidate, digest)
    except (ValueError, TypeError):
        return False


def new_token() -> str:
    return secrets.token_urlsafe(32)


def create_session(con, user_id: int) -> str:
    token = new_token()
    con.execute(
        "INSERT INTO auth_sessions (token, user_id, expires_at) "
        "VALUES (?, ?, datetime('now', ?))",
        (token, user_id, f"+{SESSION_TTL_DAYS} days"),
    )
    return token


def user_from_token(con, token: str):
    """Return the active user for a live session token, or None."""
    if not token:
        return None
    row = con.execute(
        """SELECT u.* FROM auth_sessions s
           JOIN users u ON u.id = s.user_id
           WHERE s.token = ? AND s.expires_at > datetime('now') AND u.is_active = 1""",
        (token,),
    ).fetchone()
    return dict(row) if row else None


def token_from_header(headers) -> str:
    auth = headers.get("Authorization") or headers.get("authorization") or ""
    if auth.lower().startswith("bearer "):
        return auth[7:].strip()
    return ""


def revoke_token(con, token: str) -> None:
    if token:
        con.execute("DELETE FROM auth_sessions WHERE token = ?", (token,))
        con.commit()


def revoke_token_for_user(con, user_id: int) -> None:
    con.execute("DELETE FROM auth_sessions WHERE user_id = ?", (user_id,))
    con.commit()


def public_user(user: dict) -> dict:
    user = dict(user)
    user.pop("password_hash", None)
    return user