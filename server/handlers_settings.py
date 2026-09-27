"""Shop settings: business details (single upsert row, id = 1)."""
import re

FIELDS = ("shop_name", "currency", "address", "phone", "email")


def _row(con):
    row = con.execute("SELECT * FROM shop_settings WHERE id = 1").fetchone()
    if row is None:
        return {k: None for k in FIELDS}
    d = dict(row)
    d.pop("id", None)
    return d


def get_settings(con, body, params, query):
    return 200, _row(con)


def put_settings(con, body, params, query):
    if not isinstance(body, dict):
        return 400, {"error": "request body must be a JSON object"}
    updates = {
        k: (str(v).strip() if v is not None else "")
        for k, v in body.items()
        if k in FIELDS
    }
    if not updates:
        return 400, {"error": "no settings fields provided"}
    existing = con.execute("SELECT id FROM shop_settings WHERE id = 1").fetchone()
    if existing is None:
        cols = ", ".join(["id"] + list(updates))
        placeholders = ", ".join(["?"] * (len(updates) + 1))
        con.execute(
            f"INSERT INTO shop_settings ({cols}) VALUES ({placeholders})",
            (1, *updates.values()),
        )
    else:
        sets = ", ".join(f"{k} = ?" for k in updates)
        con.execute(
            f"UPDATE shop_settings SET {sets}, updated_at = datetime('now') WHERE id = 1",
            list(updates.values()),
        )
    con.commit()
    return 200, _row(con)


ROUTES = [
    ("GET", re.compile(r"^/api/settings$"), get_settings),
    ("PUT", re.compile(r"^/api/settings$"), put_settings),
]