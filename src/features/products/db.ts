import type { D1Database } from '@cloudflare/workers-types';
import { withPublicId } from '../ids/publicId.ts';

export interface Product {
  id: number; public_id: string | null; name: string; slug: string; description: string | null;
  price_cents: number; currency: string; image_key: string | null; stock: number; active: number;
  variant_label: string | null; weight_grams: number | null; requires_shipping: number;
  file_key: string | null; file_name: string | null; file_mime: string | null; file_size_bytes: number | null;
  related_ids: string | null; billing_interval: 'month' | 'year' | null; created_at: string;
}
export interface ProductFields { name: string; description: string | null; price_cents: number; currency: string; stock: number; active: number; weight_grams: number | null; requires_shipping: number; }
export interface ProductInput extends ProductFields { image_key: string | null; slug: string; }

export async function listProducts(db: D1Database, limit: number, offset = 0, orderBy = 'created_at DESC'): Promise<Product[]> {
  const { results } = await db.prepare(`SELECT * FROM products WHERE active = 1 ORDER BY ${orderBy} LIMIT ? OFFSET ?`).bind(limit, offset).all<Product>(); return results ?? [];
}
export async function countProducts(db: D1Database): Promise<number> { const row = await db.prepare('SELECT COUNT(*) AS n FROM products WHERE active = 1').first<{ n: number }>(); return row?.n ?? 0; }
export interface AdminProduct extends Product { sold: number; }
export interface ProductFilter { where: string; params: string[]; }
const EMPTY_PRODUCT_FILTER: ProductFilter = { where: '', params: [] };
export async function listAllProducts(db: D1Database, limit: number, offset = 0, orderBy = 'created_at DESC', filter: ProductFilter = EMPTY_PRODUCT_FILTER): Promise<AdminProduct[]> {
  const { results } = await db.prepare(`SELECT p.*, COALESCE((SELECT SUM(oi.quantity) FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE oi.product_id = p.id AND o.status = 'paid'), 0) AS sold FROM products p ${filter.where} ORDER BY ${orderBy} LIMIT ? OFFSET ?`).bind(...filter.params, limit, offset).all<AdminProduct>(); return results ?? [];
}
export async function countAllProducts(db: D1Database, filter: ProductFilter = EMPTY_PRODUCT_FILTER): Promise<number> { const row = await db.prepare(`SELECT COUNT(*) AS n FROM products p ${filter.where}`).bind(...filter.params).first<{ n: number }>(); return row?.n ?? 0; }
export async function listProductsAfterId(db: D1Database, afterId: number, limit: number): Promise<Product[]> { const { results } = await db.prepare('SELECT * FROM products WHERE id > ? ORDER BY id ASC LIMIT ?').bind(afterId, limit).all<Product>(); return results ?? []; }
export function parseRelatedIds(raw: string | null): number[] | null { if (raw == null) return null; try { const parsed = JSON.parse(raw); if (!Array.isArray(parsed)) return null; return parsed.filter((n): n is number => Number.isInteger(n) && n > 0); } catch { return null; } }
export async function setRelatedIds(db: D1Database, productId: number, ids: number[]): Promise<void> { await db.prepare('UPDATE products SET related_ids = ? WHERE id = ?').bind(JSON.stringify(ids), productId).run(); }
export async function getProductsByIds(db: D1Database, ids: number[]): Promise<Product[]> { if (!ids.length) return []; const p = ids.map(() => '?').join(','); const { results } = await db.prepare(`SELECT * FROM products WHERE id IN (${p}) AND active = 1`).bind(...ids).all<Product>(); const byId = new Map((results ?? []).map((x) => [x.id, x])); return ids.map((id) => byId.get(id)).filter((x): x is Product => x !== undefined); }
export async function getProductsByPublicIds(db: D1Database, publicIds: string[]): Promise<Product[]> { if (!publicIds.length) return []; const p = publicIds.map(() => '?').join(','); const { results } = await db.prepare(`SELECT * FROM products WHERE public_id IN (${p}) AND active = 1`).bind(...publicIds).all<Product>(); return results ?? []; }
export async function getProduct(db: D1Database, id: number): Promise<Product | null> { return db.prepare('SELECT * FROM products WHERE id = ?').bind(id).first<Product>(); }
export async function lowStockProducts(db: D1Database, threshold: number, limit = 8): Promise<Product[]> { const { results } = await db.prepare('SELECT * FROM products WHERE active = 1 AND stock <= ? ORDER BY stock ASC, name LIMIT ?').bind(threshold, limit).all<Product>(); return results ?? []; }

export interface ProductImageRow { id: number; product_id: number; image_key: string; position: number; alt: string | null; public_id: string | null; }
export async function listProductImages(db: D1Database, productId: number): Promise<ProductImageRow[]> { const { results } = await db.prepare('SELECT * FROM product_images WHERE product_id = ? ORDER BY position, id').bind(productId).all<ProductImageRow>(); return results ?? []; }
export async function addProductImage(db: D1Database, productId: number, imageKey: string): Promise<void> { const row = await db.prepare('SELECT COALESCE(MAX(position), -1) AS m FROM product_images WHERE product_id = ?').bind(productId).first<{ m: number }>(); await withPublicId('productImage', (publicId) => db.prepare('INSERT INTO product_images (product_id, image_key, position, public_id) VALUES (?, ?, ?, ?)').bind(productId, imageKey, (row?.m ?? -1) + 1, publicId).run()); }
export async function getProductImage(db: D1Database, imageId: number): Promise<ProductImageRow | null> { return db.prepare('SELECT * FROM product_images WHERE id = ?').bind(imageId).first<ProductImageRow>(); }
export async function deleteProductImageRow(db: D1Database, imageId: number): Promise<void> { await db.prepare('DELETE FROM product_images WHERE id = ?').bind(imageId).run(); }
export async function replaceProductImageKey(db: D1Database, productId: number, oldKey: string, newKey: string): Promise<void> { await db.prepare('UPDATE product_images SET image_key = ? WHERE product_id = ? AND image_key = ?').bind(newKey, productId, oldKey).run(); }
export async function setProductImageAlt(db: D1Database, imageId: number, alt: string): Promise<void> { await db.prepare('UPDATE product_images SET alt = ? WHERE id = ?').bind(alt.trim() || null, imageId).run(); }
export async function moveProductImage(db: D1Database, imageId: number, direction: 'up' | 'down'): Promise<void> { const img = await getProductImage(db, imageId); if (!img) return; const neighbor = direction === 'up' ? await db.prepare('SELECT * FROM product_images WHERE product_id = ? AND position < ? ORDER BY position DESC LIMIT 1').bind(img.product_id, img.position).first<ProductImageRow>() : await db.prepare('SELECT * FROM product_images WHERE product_id = ? AND position > ? ORDER BY position ASC LIMIT 1').bind(img.product_id, img.position).first<ProductImageRow>(); if (!neighbor) return; await db.batch([db.prepare('UPDATE product_images SET position = ? WHERE id = ?').bind(neighbor.position, img.id), db.prepare('UPDATE product_images SET position = ? WHERE id = ?').bind(img.position, neighbor.id)]); }
export async function reorderProductImages(db: D1Database, productId: number, orderedIds: number[]): Promise<void> { const existing = await listProductImages(db, productId); const valid = new Set(existing.map((i) => i.id)); const ids = orderedIds.filter((id) => valid.has(id)); if (!ids.length) return; await db.batch(ids.map((id, idx) => db.prepare('UPDATE product_images SET position = ? WHERE id = ? AND product_id = ?').bind(idx, id, productId))); }
export async function setPrimaryImage(db: D1Database, productId: number, imageKey: string | null): Promise<void> { await db.prepare('UPDATE products SET image_key = ? WHERE id = ?').bind(imageKey, productId).run(); }
export async function syncPrimaryImage(db: D1Database, productId: number): Promise<void> { const imgs = await listProductImages(db, productId); await setPrimaryImage(db, productId, imgs[0]?.image_key ?? null); }
export async function makeImagePrimary(db: D1Database, productId: number, imageId: number): Promise<void> { const imgs = await listProductImages(db, productId); const order = [imageId, ...imgs.map((i) => i.id).filter((x) => x !== imageId)]; await reorderProductImages(db, productId, order); await syncPrimaryImage(db, productId); }
export async function getProductByPublicId(db: D1Database, publicId: string): Promise<Product | null> { return db.prepare('SELECT * FROM products WHERE public_id = ?').bind(publicId).first<Product>(); }
export async function getProductBySlug(db: D1Database, slug: string): Promise<Product | null> { return db.prepare('SELECT * FROM products WHERE slug = ?').bind(slug).first<Product>(); }
export async function createProduct(db: D1Database, p: ProductInput): Promise<number> { return withPublicId('product', async (publicId) => { const row = await db.prepare(`INSERT INTO products (name, slug, description, price_cents, currency, image_key, stock, active, weight_grams, requires_shipping, public_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`).bind(p.name, p.slug, p.description, p.price_cents, p.currency, p.image_key, p.stock, p.active, p.weight_grams, p.requires_shipping, publicId).first<{ id: number }>(); return row!.id; }); }
export async function updateProduct(db: D1Database, id: number, p: ProductInput): Promise<void> { await db.prepare(`UPDATE products SET name = ?, slug = ?, description = ?, price_cents = ?, currency = ?, image_key = ?, stock = ?, active = ?, weight_grams = ?, requires_shipping = ? WHERE id = ?`).bind(p.name, p.slug, p.description, p.price_cents, p.currency, p.image_key, p.stock, p.active, p.weight_grams, p.requires_shipping, id).run(); }
export async function setProductFile(db: D1Database, id: number, file: { key: string; name: string; mime: string; size: number } | null): Promise<void> { await db.prepare(`UPDATE products SET file_key = ?, file_name = ?, file_mime = ?, file_size_bytes = ? WHERE id = ?`).bind(file?.key ?? null, file?.name ?? null, file?.mime ?? null, file?.size ?? null, id).run(); }
export async function deleteProduct(db: D1Database, id: number): Promise<void> { await db.batch([db.prepare('DELETE FROM product_categories WHERE product_id = ?').bind(id), db.prepare('DELETE FROM product_images WHERE product_id = ?').bind(id), db.prepare('DELETE FROM products WHERE id = ?').bind(id)]); }

export async function deleteProducts(db: D1Database, ids: number[]): Promise<void> {
  const uniqueIds = [...new Set(ids)].filter((id) => Number.isInteger(id) && id > 0);
  if (!uniqueIds.length) return;
  const statements: D1PreparedStatement[] = [];
  for (const id of uniqueIds) {
    statements.push(db.prepare('DELETE FROM product_categories WHERE product_id = ?').bind(id));
    statements.push(db.prepare('DELETE FROM product_images WHERE product_id = ?').bind(id));
    statements.push(db.prepare('DELETE FROM products WHERE id = ?').bind(id));
  }
  await db.batch(statements);
}
