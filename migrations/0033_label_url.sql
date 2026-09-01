-- 0033 compatibility marker.
--
-- This repository historically contains more than one migration numbered 0033.
-- Clean installs therefore cannot rely on either 0033 file for required columns.
-- `label_url` and public-ID columns now live in the original CREATE TABLE
-- migrations, while the idempotent indexes/registry tables are also reinforced by
-- the unique 0040 migration. Keep this file free of ALTER TABLE so applying both
-- 0033 companions can never add a column twice.

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
