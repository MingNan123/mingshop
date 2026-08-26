import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { updateCategory, deleteCategory, descendantIds, getCategoryByPublicId } from '../../../../features/categories/db';
import { parseCategoryForm } from '../../../../features/categories/form';
import { uniqueCategorySlug } from '../../../../features/categories/slug';
import { parsePublicId } from '../../../../features/ids/publicId';
import { CACHE_TAG } from '../../../../features/cache/tags';
import { purgeCacheTags } from '../../../../features/cache/purge';

export const prerender = false;

function safeReturnTo(request: Request): string {
  const referer = request.headers.get('referer');
  if (referer) {
    try {
      const url = new URL(referer);
      if (url.pathname.startsWith('/admin/categories')) return `${url.pathname}${url.search}`;
    } catch {}
  }
  return '/admin/categories';
}

function addQuery(path: string, key: string, value: string | number): string {
  return `${path}${path.includes('?') ? '&' : '?'}${key}=${encodeURIComponent(String(value))}`;
}

export const POST: APIRoute = async ({ request, params, redirect }) => {
  const publicId = parsePublicId(params.id, 'category');
  const category = publicId ? await getCategoryByPublicId(env.DB, publicId) : null;
  if (!category) return new Response('Not found', { status: 404 });
  const id = category.id;
  const form = await request.formData();
  const returnTo = safeReturnTo(request);

  if (String(form.get('_action')) === 'delete') {
    await deleteCategory(env.DB, id);
    await purgeCacheTags([CACHE_TAG.catalog]);
    return redirect(addQuery(returnTo, 'message', '分类已删除，页面已刷新。'), 303);
  }

  const fail = (msg: string) => redirect(`/admin/categories/${publicId}/edit?error=${encodeURIComponent(msg)}`, 303);
  const parsed = parseCategoryForm(form);
  if ('error' in parsed) return fail(parsed.error);

  let parentId: number | null = null;
  if (parsed.data.parentPublicId) {
    const parent = await getCategoryByPublicId(env.DB, parsed.data.parentPublicId);
    if (!parent) return fail('That parent category no longer exists.');
    parentId = parent.id;
  }

  if (parentId != null) {
    const blocked = new Set(await descendantIds(env.DB, id));
    if (blocked.has(parentId)) return fail('A category cannot be moved under itself or one of its sub-categories.');
  }

  const slug = await uniqueCategorySlug(env.DB, parsed.data.slugInput || parsed.data.name, id);
  await updateCategory(env.DB, id, { name: parsed.data.name, slug, parent_id: parentId });
  await purgeCacheTags([CACHE_TAG.catalog]);
  return redirect(addQuery(returnTo, 'message', '分类已更新，页面已刷新。'), 303);
};
