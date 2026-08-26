-- Replace the legacy catalog taxonomy with categories focused on legitimate
-- digital products, SaaS, software and professional online services.
-- Existing products are intentionally kept; only their old category links are reset.
-- public_id is populated explicitly because categories are externally addressable
-- by the admin/frontend and SQL migrations do not run the application ID generator.

DELETE FROM product_categories;
DELETE FROM categories;

INSERT INTO categories (name, slug, parent_id, public_id) VALUES
  ('软件与数字产品', 'software-digital', NULL, 'cat_0000000001'),
  ('SaaS 在线服务', 'saas-services', NULL, 'cat_0000000002'),
  ('专业数字服务', 'digital-services', NULL, 'cat_0000000003'),
  ('开发者资源', 'developer-resources', NULL, 'cat_0000000004'),
  ('数字生产力', 'digital-productivity', NULL, 'cat_0000000005');

INSERT INTO categories (name, slug, parent_id, public_id)
SELECT '软件许可证', 'software-licenses', id, 'cat_0000000011' FROM categories WHERE slug = 'software-digital';
INSERT INTO categories (name, slug, parent_id, public_id)
SELECT '开发者工具', 'developer-tools', id, 'cat_0000000012' FROM categories WHERE slug = 'software-digital';
INSERT INTO categories (name, slug, parent_id, public_id)
SELECT '源代码与模板', 'source-code-templates', id, 'cat_0000000013' FROM categories WHERE slug = 'software-digital';
INSERT INTO categories (name, slug, parent_id, public_id)
SELECT '数字下载', 'digital-downloads', id, 'cat_0000000014' FROM categories WHERE slug = 'software-digital';

INSERT INTO categories (name, slug, parent_id, public_id)
SELECT '网站工具', 'website-tools', id, 'cat_0000000021' FROM categories WHERE slug = 'saas-services';
INSERT INTO categories (name, slug, parent_id, public_id)
SELECT '业务效率工具', 'business-productivity', id, 'cat_0000000022' FROM categories WHERE slug = 'saas-services';
INSERT INTO categories (name, slug, parent_id, public_id)
SELECT '在线管理工具', 'online-management', id, 'cat_0000000023' FROM categories WHERE slug = 'saas-services';
INSERT INTO categories (name, slug, parent_id, public_id)
SELECT 'API 服务', 'api-services', id, 'cat_0000000024' FROM categories WHERE slug = 'saas-services';

INSERT INTO categories (name, slug, parent_id, public_id)
SELECT '网站建设服务', 'website-development-services', id, 'cat_0000000031' FROM categories WHERE slug = 'digital-services';
INSERT INTO categories (name, slug, parent_id, public_id)
SELECT '技术支持服务', 'technical-support-services', id, 'cat_0000000032' FROM categories WHERE slug = 'digital-services';
INSERT INTO categories (name, slug, parent_id, public_id)
SELECT '软件配置服务', 'software-setup-services', id, 'cat_0000000033' FROM categories WHERE slug = 'digital-services';
INSERT INTO categories (name, slug, parent_id, public_id)
SELECT '自动化服务', 'automation-services', id, 'cat_0000000034' FROM categories WHERE slug = 'digital-services';

INSERT INTO categories (name, slug, parent_id, public_id)
SELECT 'SaaS Starter Kit', 'saas-starter-kits', id, 'cat_0000000041' FROM categories WHERE slug = 'developer-resources';
INSERT INTO categories (name, slug, parent_id, public_id)
SELECT 'Cloudflare 与 Workers', 'cloudflare-workers', id, 'cat_0000000042' FROM categories WHERE slug = 'developer-resources';
INSERT INTO categories (name, slug, parent_id, public_id)
SELECT 'Astro 与 Web 模板', 'astro-web-templates', id, 'cat_0000000043' FROM categories WHERE slug = 'developer-resources';
INSERT INTO categories (name, slug, parent_id, public_id)
SELECT 'API 工具包', 'api-toolkits', id, 'cat_0000000044' FROM categories WHERE slug = 'developer-resources';

INSERT INTO categories (name, slug, parent_id, public_id)
SELECT '工作与项目模板', 'work-project-templates', id, 'cat_0000000051' FROM categories WHERE slug = 'digital-productivity';
INSERT INTO categories (name, slug, parent_id, public_id)
SELECT '数据与表格模板', 'data-spreadsheet-templates', id, 'cat_0000000052' FROM categories WHERE slug = 'digital-productivity';
INSERT INTO categories (name, slug, parent_id, public_id)
SELECT '文档与设计资源', 'document-design-resources', id, 'cat_0000000053' FROM categories WHERE slug = 'digital-productivity';
INSERT INTO categories (name, slug, parent_id, public_id)
SELECT '商业工具包', 'business-toolkits', id, 'cat_0000000054' FROM categories WHERE slug = 'digital-productivity';
