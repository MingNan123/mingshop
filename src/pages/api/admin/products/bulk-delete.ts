import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { deleteProducts, getProductByPublicId } from '../../../../features/products/db';
import { parsePublicId } from '../../../../features/ids/publicId';
import { unindexProduct } from '../../../../features/search';
import { CACHE_TAG } from '../../../../features/cache/tags';
import { purgeCacheTags } from '../../../../features/cache/purge';

export const prerender = false;

const MAX_BULK_DELETE = 30;

function safeReturnTo(value: FormDataEntryValue | null, referer: string | null): string {
  const candidate = String(value ?? '').trim();
  if (candidate.startsWith('/admin/products')) return candidate;
  if (referer) {
    try {
      const url = new URL(referer);
      if (url.origin === new URL('https://placeholder.invalid').origin) return '/admin/products';
    } catch {}
  }
  return '/admin/products';
}

function safeReturnToFromRequest(value: FormDataEntryValue | null, request: Request): string {
  const candidate = String(value ?? '').trim();
  if (candidate.startsWith('/admin/products')) return candidate;
  const referer = request.headers.get('referer');
  if (referer) {
    try {
      const url = new URL(referer);
      if (url.pathname.startsWith('/admin/products')) return `${url.pathname}${url.search}`;
    } catch {}
  }
  return '/admin/products';
}

function withMessage(path: string, key: string, value: string | number): string {
  return `${path}${path.includes('?') ? '&' : '?'}${key}=${encodeURIComponent(String(value))}`;
}

export const POST: APIRoute = async ({ request, redirect }) => {
  const form = await request.formData();
  const fallback = safeReturnToFromRequest(form.get('return_to'), request);
  const rawIds = form.getAll('ids').map((value) => String(value).trim()).filter(Boolean);
  const publicIds = [...new Set(rawIds)];

  if (publicIds.length === 0) return redirect(withMessage(fallback, 'error', '请至少选择一个商品。'), 303);
  if (publicIds.length > MAX_BULK_DELETE) return redirect(withMessage(fallback, 'error', `一次最多删除 ${MAX_BULK_DELETE} 个商品，请分批操作。`), 303);

  const products = [];
  for (const publicId of publicIds) {
    if (!parsePublicId(publicId, 'product')) return redirect(withMessage(fallback, 'error', '商品标识无效，请刷新页面后重试。'), 303);
    const product = await getProductByPublicId(env.DB, publicId);
    if (!product) return redirect(withMessage(fallback, 'error', '部分商品不存在或已被删除，请刷新页面后重试。'), 303);
    products.push(product);
  }

  await deleteProducts(env.DB, products.map((product) => product.id));

  const failedIndexes: number[] = [];
  await Promise.all(products.map(async (product) => {
    try {
      await unindexProduct(product.id);
    } catch (error) {
      failedIndexes.push(product.id);
      console.error('Search unindex (bulk delete) failed:', error);
    }
  }));

  const tags = [CACHE_TAG.catalog, ...products.map((product) => CACHE_TAG.product(product.public_id ?? ''))];
  await purgeCacheTags(tags.filter(Boolean));

  const warning = failedIndexes.length > 0 ? '&warning=' + encodeURIComponent('商品已删除，但部分搜索索引清理失败；搜索功能会在后续索引更新时自动修复。') : '';
  return redirect(withMessage(fallback, 'deleted', products.length) + warning, 303);
};
