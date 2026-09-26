-- Flowdesk initial schema
-- Sales process: new_inquiry -> interested -> order -> completed

CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT NOT NULL,
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'staff' CHECK (role IN ('owner', 'staff')),
    is_active     INTEGER NOT NULL DEFAULT 1,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS customers (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    name         TEXT NOT NULL,
    phone        TEXT,
    email        TEXT,
    platform     TEXT CHECK (platform IN ('whatsapp', 'instagram', 'tiktok', 'manual', 'other')),
    external_id  TEXT,
    location     TEXT,
    notes        TEXT,
    is_returning INTEGER NOT NULL DEFAULT 0,
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_customers_external ON customers (platform, external_id);

CREATE TABLE IF NOT EXISTS conversations (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id     INTEGER NOT NULL REFERENCES customers (id) ON DELETE CASCADE,
    source          TEXT NOT NULL CHECK (source IN ('whatsapp', 'instagram', 'tiktok', 'manual', 'other')),
    status          TEXT NOT NULL DEFAULT 'new_inquiry'
                    CHECK (status IN ('new_inquiry', 'interested', 'order', 'completed', 'archived')),
    unread          INTEGER NOT NULL DEFAULT 1,
    last_message_at TEXT NOT NULL DEFAULT (datetime('now')),
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_conversations_customer ON conversations (customer_id);
CREATE INDEX IF NOT EXISTS idx_conversations_status ON conversations (status);
CREATE UNIQUE INDEX IF NOT EXISTS uq_conversations_customer_source
    ON conversations (customer_id, source);

CREATE TABLE IF NOT EXISTS messages (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id  INTEGER NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
    direction        TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
    sender           TEXT,
    body             TEXT NOT NULL,
    message_type     TEXT NOT NULL DEFAULT 'text'
                     CHECK (message_type IN ('text', 'image', 'voice', 'video', 'comment', 'sticker', 'file')),
    intent_flag      INTEGER NOT NULL DEFAULT 0,
    intent_score     REAL,
    created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages (conversation_id, created_at);

CREATE TABLE IF NOT EXISTS leads (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
    customer_id     INTEGER NOT NULL REFERENCES customers (id) ON DELETE CASCADE,
    status          TEXT NOT NULL DEFAULT 'new_inquiry'
                    CHECK (status IN ('new_inquiry', 'interested', 'order', 'completed', 'lost')),
    intent_score    REAL,
    flagged         INTEGER NOT NULL DEFAULT 0,
    notes           TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_leads_customer ON leads (customer_id);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads (status);

CREATE TABLE IF NOT EXISTS products (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    description TEXT,
    price       REAL NOT NULL DEFAULT 0,
    currency    TEXT NOT NULL DEFAULT 'NGN',
    sku         TEXT,
    image_url   TEXT,
    available   INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_products_sku ON products (sku);

CREATE TABLE IF NOT EXISTS inventory (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id          INTEGER NOT NULL UNIQUE REFERENCES products (id) ON DELETE CASCADE,
    stock_quantity      INTEGER NOT NULL DEFAULT 0,
    low_stock_threshold INTEGER NOT NULL DEFAULT 5,
    updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS orders (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    order_number      TEXT NOT NULL UNIQUE,
    customer_id       INTEGER NOT NULL REFERENCES customers (id) ON DELETE CASCADE,
    conversation_id   INTEGER REFERENCES conversations (id) ON DELETE SET NULL,
    lead_id           INTEGER REFERENCES leads (id) ON DELETE SET NULL,
    status            TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'shipped', 'delivered', 'completed', 'cancelled')),
    subtotal          REAL NOT NULL DEFAULT 0,
    delivery_fee      REAL NOT NULL DEFAULT 0,
    discount          REAL NOT NULL DEFAULT 0,
    total             REAL NOT NULL DEFAULT 0,
    currency          TEXT NOT NULL DEFAULT 'NGN',
    delivery_address  TEXT,
    notes             TEXT,
    is_manual         INTEGER NOT NULL DEFAULT 0,
    created_by        INTEGER REFERENCES users (id) ON DELETE SET NULL,
    created_at        TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders (customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders (status);
CREATE INDEX IF NOT EXISTS idx_orders_created ON orders (created_at);

CREATE TABLE IF NOT EXISTS order_items (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id    INTEGER NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
    product_id  INTEGER REFERENCES products (id) ON DELETE SET NULL,
    description TEXT NOT NULL,
    quantity    INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
    unit_price  REAL NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items (order_id);

CREATE TABLE IF NOT EXISTS deliveries (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id         INTEGER NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
    provider         TEXT,
    tracking_number  TEXT,
    status           TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'picked_up', 'in_transit', 'delivered', 'failed')),
    delivery_address TEXT,
    estimated_date   TEXT,
    delivered_at     TEXT,
    created_at       TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_deliveries_order ON deliveries (order_id);

CREATE TABLE IF NOT EXISTS analytics_events (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type  TEXT NOT NULL,
    entity_type TEXT,
    entity_id   INTEGER,
    payload     TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_analytics_events_type ON analytics_events (event_type);
CREATE INDEX IF NOT EXISTS idx_analytics_events_created ON analytics_events (created_at);