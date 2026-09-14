-- Separate operational inventory from merchant-controlled storefront counters.
ALTER TABLE products ADD COLUMN display_stock INTEGER NOT NULL DEFAULT 0;
ALTER TABLE products ADD COLUMN display_sold INTEGER NOT NULL DEFAULT 0;

-- Start the public counters from today's real values. Future edits are manual.
UPDATE products SET display_stock = stock;
UPDATE products
SET display_sold = COALESCE((
  SELECT SUM(oi.quantity)
  FROM order_items oi
  JOIN orders o ON o.id = oi.order_id
  WHERE oi.product_id = products.id AND o.status = 'paid'
), 0);
