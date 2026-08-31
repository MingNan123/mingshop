-- 0033 compatibility companion: prefixed public IDs.
--
-- The repository also has 0033_label_url.sql. Clean D1 migration runs can treat
-- files with the same leading version as one migration version, so the actual
-- ALTER TABLE transition now lives in 0033_label_url.sql. Keep this companion
-- idempotent: if a Wrangler version applies both 0033 files, it must not attempt
-- to add the same columns twice.
--
-- Row IDs remain internal primary/foreign keys; `public_id` is the immutable
-- external identity. Creation code generates values and the backfill script fills
-- legacy NULL rows.

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
