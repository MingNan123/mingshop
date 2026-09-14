-- Per-product checkout fields. New and existing products collect nothing unless
-- the merchant explicitly enables a field in the product editor.
ALTER TABLE products ADD COLUMN collect_email INTEGER NOT NULL DEFAULT 0;
ALTER TABLE products ADD COLUMN collect_name INTEGER NOT NULL DEFAULT 0;
ALTER TABLE products ADD COLUMN collect_virtual_region INTEGER NOT NULL DEFAULT 0;

-- Preserve the intent already stated in these product descriptions.
UPDATE products
SET collect_email = 1,
    collect_name = 1,
    collect_virtual_region = 1
WHERE slug IN (
  'brand-brief',
  'code-writing-help',
  'plasma-visa-card',
  'plasma-address-translation',
  'mexc-card-service',
  'e-card',
  'coca-card',
  'bybit-address-translation',
  'ifast-global-bank-service'
);

UPDATE products SET collect_email = 1 WHERE slug = 'api-documentation';
