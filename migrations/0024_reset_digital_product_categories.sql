-- Replace the legacy catalog taxonomy with categories focused on legitimate
-- digital products, SaaS, software and professional online services.
-- Existing products are intentionally kept; only their old category links are reset.

DELETE FROM product_categories;
DELETE FROM categories;

INSERT INTO categories (name, slug, parent_id) VALUES
  ('软件与数字产品', 'software-digital', NULL),
  ('SaaS 在线服务', 'saas-services', NULL),
  ('专业数字服务', 'digital-services', NULL),
  ('开发者资源', 'developer-resources', NULL),
  ('数字生产力', 'digital-productivity', NULL);

INSERT INTO categories (name, slug, parent_id)
SELECT '软件许可证', 'software-licenses', id FROM categories WHERE slug = 'software-digital';
INSERT INTO categories (name, slug, parent_id)
SELECT '开发者工具', 'developer-tools', id FROM categories WHERE slug = 'software-digital';
INSERT INTO categories (name, slug, parent_id)
SELECT '源代码与模板', 'source-code-templates', id FROM categories WHERE slug = 'software-digital';
INSERT INTO categories (name, slug, parent_id)
SELECT '数字下载', 'digital-downloads', id FROM categories WHERE slug = 'software-digital';

INSERT INTO categories (name, slug, parent_id)
SELECT '网站工具', 'website-tools', id FROM categories WHERE slug = 'saas-services';
INSERT INTO categories (name, slug, parent_id)
SELECT '业务效率工具', 'business-productivity', id FROM categories WHERE slug = 'saas-services';
INSERT INTO categories (name, slug, parent_id)
SELECT '在线管理工具', 'online-management', id FROM categories WHERE slug = 'saas-services';
INSERT INTO categories (name, slug, parent_id)
SELECT 'API 服务', 'api-services', id FROM categories WHERE slug = 'saas-services';

INSERT INTO categories (name, slug, parent_id)
SELECT '网站建设服务', 'website-development-services', id FROM categories WHERE slug = 'digital-services';
INSERT INTO categories (name, slug, parent_id)
SELECT '技术支持服务', 'technical-support-services', id FROM categories WHERE slug = 'digital-services';
INSERT INTO categories (name, slug, parent_id)
SELECT '软件配置服务', 'software-setup-services', id FROM categories WHERE slug = 'digital-services';
INSERT INTO categories (name, slug, parent_id)
SELECT '自动化服务', 'automation-services', id FROM categories WHERE slug = 'digital-services';

INSERT INTO categories (name, slug, parent_id)
SELECT 'SaaS Starter Kit', 'saas-starter-kits', id FROM categories WHERE slug = 'developer-resources';
INSERT INTO categories (name, slug, parent_id)
SELECT 'Cloudflare 与 Workers', 'cloudflare-workers', id FROM categories WHERE slug = 'developer-resources';
INSERT INTO categories (name, slug, parent_id)
SELECT 'Astro 与 Web 模板', 'astro-web-templates', id FROM categories WHERE slug = 'developer-resources';
INSERT INTO categories (name, slug, parent_id)
SELECT 'API 工具包', 'api-toolkits', id FROM categories WHERE slug = 'developer-resources';

INSERT INTO categories (name, slug, parent_id)
SELECT '工作与项目模板', 'work-project-templates', id FROM categories WHERE slug = 'digital-productivity';
INSERT INTO categories (name, slug, parent_id)
SELECT '数据与表格模板', 'data-spreadsheet-templates', id FROM categories WHERE slug = 'digital-productivity';
INSERT INTO categories (name, slug, parent_id)
SELECT '文档与设计资源', 'document-design-resources', id FROM categories WHERE slug = 'digital-productivity';
INSERT INTO categories (name, slug, parent_id)
SELECT '商业工具包', 'business-toolkits', id FROM categories WHERE slug = 'digital-productivity';
