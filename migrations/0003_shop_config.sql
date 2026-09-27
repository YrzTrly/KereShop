-- Owner-facing shop configuration: connected channels + business details.
-- Both tables are single-row upserts (id = 1).

CREATE TABLE IF NOT EXISTS integrations (
    id                      INTEGER PRIMARY KEY CHECK (id = 1),
    whatsapp_number         TEXT,
    whatsapp_business_token TEXT,
    facebook_url            TEXT,
    instagram_url           TEXT,
    tiktok_url              TEXT,
    x_url                   TEXT,
    updated_at              TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS shop_settings (
    id         INTEGER PRIMARY KEY CHECK (id = 1),
    shop_name  TEXT,
    currency   TEXT,
    address    TEXT,
    phone      TEXT,
    email      TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);