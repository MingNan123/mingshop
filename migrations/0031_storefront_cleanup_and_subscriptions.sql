-- 0031: storefront cleanup + subscription catalog metadata.
--
-- Safety rule: products with historical order items are retained but hidden,
-- so order history never points at a deleted product. Products with no image
-- and no order history are actually removed.

DELETE FROM products
WHERE (image_key IS NULL OR trim(image_key) = '')
  AND NOT EXISTS (SELECT 1 FROM product_images pi WHERE pi.product_id = products.id)
  AND NOT EXISTS (SELECT 1 FROM order_items oi WHERE oi.product_id = products.id);

UPDATE products
SET active = 0
WHERE (image_key IS NULL OR trim(image_key) = '')
  AND NOT EXISTS (SELECT 1 FROM product_images pi WHERE pi.product_id = products.id);

ALTER TABLE products ADD COLUMN billing_interval TEXT NOT NULL DEFAULT 'one_time';

-- The plans are digital products. Their image is borrowed from an existing
-- uploaded product image, which guarantees the R2 object already exists.
-- If the store only has one image, all three plans intentionally reuse it.
INSERT INTO products (name, slug, description, price_cents, currency, image_key, stock, active, weight_grams, requires_shipping, public_id, billing_interval)
SELECT 'AI 工作台 · 月度版', 'ai-workspace-monthly', '面向个人与小团队的 AI 效率工作台：提示词整理、内容处理与日常自动化。', 990, 'usd', (SELECT image_key FROM product_images ORDER BY position, id LIMIT 1), 999999, 1, NULL, 0, 'prod_ai_workspace_monthly', 'month'
WHERE NOT EXISTS (SELECT 1 FROM products WHERE slug = 'ai-workspace-monthly') AND EXISTS (SELECT 1 FROM product_images);

INSERT INTO products (name, slug, description, price_cents, currency, image_key, stock, active, weight_grams, requires_shipping, public_id, billing_interval)
SELECT '自动化工具箱 · 月度版', 'automation-toolkit-monthly', '把重复操作变成可复用工作流，适合内容运营、开发与数字业务场景。', 1490, 'usd', (SELECT image_key FROM product_images ORDER BY position, id LIMIT 1), 999999, 1, NULL, 0, 'prod_automation_toolkit_monthly', 'month'
WHERE NOT EXISTS (SELECT 1 FROM products WHERE slug = 'automation-toolkit-monthly') AND EXISTS (SELECT 1 FROM product_images);

INSERT INTO products (name, slug, description, price_cents, currency, image_key, stock, active, weight_grams, requires_shipping, public_id, billing_interval)
SELECT '开发者工具箱 · 月度版', 'developer-toolkit-monthly', '面向开发者的轻量工具集合：文本、数据、API 与项目日常处理工具。', 1990, 'usd', (SELECT image_key FROM product_images ORDER BY position, id LIMIT 1), 999999, 1, NULL, 0, 'prod_developer_toolkit_monthly', 'month'
WHERE NOT EXISTS (SELECT 1 FROM products WHERE slug = 'developer-toolkit-monthly') AND EXISTS (SELECT 1 FROM product_images);
