import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getProductByPublicId } from '../../../../features/products/db';
import { parsePublicId } from '../../../../features/ids/publicId';
import { indexProduct } from '../../../../features/search';
import { CACHE_TAG } from '../../../../features/cache/tags';
import { purgeCacheTags } from '../../../../features/cache/purge';

export const prerender = false;
const MAX_BULK_UPDATE = 100;

export const POST: APIRoute = async ({ request, redirect }) => {
  const form = await request.formData();
  const action = String(form.get('_action') ?? '');
  const active = action === 'activate' ? 1 : action === 'deactivate' ? 0 : null;
  const returnTo = String(form.get('return_to') ?? '/admin/products');
  const fallback = returnTo.startsWith('/admin/products') ? returnTo : '/admin/products';

  if (active === null) return redirect(fallback + (fallback.includes('?') ? '&' : '?') + 'error=' + encodeURIComponent('无效的批量操作。'), 303);

  const publicIds = [...new Set(form.getAll('ids').map((v) => String(v).trim()).filter(Boolean))];
  if (!publicIds.length) return redirect(fallback + (fallback.includes('?') ? '&' : '?') + 'error=' + encodeURIComponent('请至少选择一个商品。'), 303);
  if (publicIds.length > MAX_BULK_UPDATE) return redirect(fallback + (fallback.includes('?') ? '&' : '?') + 'error=' + encodeURIComponent(`一次最多操作 ${MAX_BULK_UPDATE} 个商品。`), 303);

  const products = [];
  for (const publicId of publicIds) {
    if (!parsePublicId(publicId, 'product')) return redirect(fallback + (fallback.includes('?') ? '&' : '?') + 'error=' + encodeURIComponent('商品标识无效，请刷新页面后重试。'), 303);
    const product = await getProductByPublicId(env.DB, publicId);
    if (!product) return redirect(fallback + (fallback.includes('?') ? '&' : '?') + 'error=' + encodeURIComponent('部分商品不存在，请刷新页面后重试。'), 303);
    products.push(product);
  }

  await env.DB.batch(products.map((product) => env.DB.prepare('UPDATE products SET active = ? WHERE id = ?').bind(active, product.id)));
  await Promise.all(products.map((product) => indexProduct({ ...product, active }).catch((error) => console.error('Search index (bulk status) failed:', error))));
  await purgeCacheTags([CACHE_TAG.catalog, ...products.map((product) => CACHE_TAG.product(product.public_id ?? '')).filter(Boolean)]);

  const message = active ? `已上架 ${products.length} 个商品。` : `已下架 ${products.length} 个商品。`;
  return redirect(fallback + (fallback.includes('?') ? '&' : '?') + 'message=' + encodeURIComponent(message), 303);
};
