"""Owner-facing integrations: WhatsApp + social media accounts.

A single upsert row (id = 1) in the `integrations` table stores the
connected channel details for the shop.
"""
import re

FIELDS = (
    "whatsapp_number",
    "whatsapp_business_token",
    "facebook_url",
    "instagram_url",
    "tiktok_url",
    "x_url",
)


def _row(con):
    row = con.execute("SELECT * FROM integrations WHERE id = 1").fetchone()
    if row is None:
        return {k: None for k in FIELDS}
    d = dict(row)
    d.pop("id", None)
    return d


def get_integrations(con, body, params, query):
    return 200, _row(con)


def save_integrations(con, body, params, query):
    if not isinstance(body, dict):
        return 400, {"error": "request body must be a JSON object"}
    updates = {
        k: (str(v).strip() if v is not None else "")
        for k, v in body.items()
        if k in FIELDS
    }
    if not updates:
        return 400, {"error": "no integrations fields provided"}
    existing = con.execute("SELECT id FROM integrations WHERE id = 1").fetchone()
    if existing is None:
        cols = ", ".join(["id"] + list(updates))
        placeholders = ", ".join(["?"] * (len(updates) + 1))
        con.execute(
            f"INSERT INTO integrations ({cols}) VALUES ({placeholders})",
            (1, *updates.values()),
        )
    else:
        sets = ", ".join(f"{k} = ?" for k in updates)
        con.execute(
            f"UPDATE integrations SET {sets}, updated_at = datetime('now') WHERE id = 1",
            list(updates.values()),
        )
    con.commit()
    return 200, _row(con)


ROUTES = [
    ("GET", re.compile(r"^/api/integrations$"), get_integrations),
    ("POST", re.compile(r"^/api/integrations$"), save_integrations),
]