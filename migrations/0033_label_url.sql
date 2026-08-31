-- 0033: shipping-label URL + public external IDs.
--
-- This repository historically contains two files numbered 0033. Wrangler treats
-- the leading number as the migration version, so a clean database can execute
-- this file while the sibling 0033_public_ids.sql is not applied. Keep the full
-- public-ID schema transition here so clean installs match the runtime model.
-- Existing databases that already recorded migration 0033 are not re-run by this
-- historical repair; their existing public IDs and label_url are preserved.

-- The purchased shipping label's document URL.
ALTER TABLE orders ADD COLUMN label_url TEXT;

-- Prefixed immutable public identities. Row IDs remain internal PK/FK values.
ALTER TABLE products         ADD COLUMN public_id TEXT;  -- prod_
ALTER TABLE product_variants ADD COLUMN public_id TEXT;  -- var_
ALTER TABLE product_extras   ADD COLUMN public_id TEXT;  -- xtra_
ALTER TABLE categories       ADD COLUMN public_id TEXT;  -- cat_
ALTER TABLE pages            ADD COLUMN public_id TEXT;  -- page_
ALTER TABLE media            ADD COLUMN public_id TEXT;  -- med_
ALTER TABLE product_images   ADD COLUMN public_id TEXT;  -- pimg_
ALTER TABLE menu_items       ADD COLUMN public_id TEXT;  -- nav_

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

-- Authoritative guest token -> order mapping.
CREATE TABLE IF NOT EXISTS order_guest_access (
  order_public_id TEXT NOT NULL PRIMARY KEY,
  access_token    TEXT NOT NULL UNIQUE,
  generation      INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  rotated_at      TEXT
);

-- Stable references already communicated for legacy orders.
CREATE TABLE IF NOT EXISTS order_reference_aliases (
  reference       TEXT NOT NULL PRIMARY KEY,
  order_public_id TEXT NOT NULL UNIQUE
);
