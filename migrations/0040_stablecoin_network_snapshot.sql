-- 0040: freeze the buyer-selected stablecoin network on each pending payment.
-- Merchant network settings may change while a payment is pending; these columns
-- keep the receiving address, token contract and chain adapter immutable for that order.
--
-- This unique migration number also reinforces idempotent public-ID indexes and
-- guest-access registry tables for clean installs affected by the historical
-- duplicate 0033 migration-number collision. CREATE IF NOT EXISTS is safe on
-- existing production databases.

ALTER TABLE pending_payments ADD COLUMN stablecoin_network_id TEXT;
ALTER TABLE pending_payments ADD COLUMN stablecoin_network_snapshot TEXT;
ALTER TABLE pending_payments ADD COLUMN stablecoin_network_selected_at TEXT;

CREATE INDEX IF NOT EXISTS idx_pending_stablecoin_network
  ON pending_payments(backend, status, stablecoin_network_id, created_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_products_public_id
  ON products(public_id) WHERE public_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_product_variants_public_id
  ON product_variants(public_id) WHERE public_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_product_extras_public_id
  ON product_extras(public_id) WHERE public_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_categories_public_id
  ON categories(public_id) WHERE public_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_pages_public_id
  ON pages(public_id) WHERE public_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_media_public_id
  ON media(public_id) WHERE public_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_product_images_public_id
  ON product_images(public_id) WHERE public_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_menu_items_public_id
  ON menu_items(public_id) WHERE public_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS order_guest_access (
  order_public_id TEXT NOT NULL PRIMARY KEY,
  access_token    TEXT NOT NULL UNIQUE,
  generation      INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  rotated_at      TEXT
);

CREATE TABLE IF NOT EXISTS order_reference_aliases (
  reference       TEXT NOT NULL PRIMARY KEY,
  order_public_id TEXT NOT NULL UNIQUE
);
