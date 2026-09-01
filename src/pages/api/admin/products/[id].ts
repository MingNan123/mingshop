import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import {
  getProduct,
  getProductByPublicId,
  listProductImages,
  syncPrimaryImage,
  updateProduct,
  deleteProduct,
  setProductFile,
} from '../../../../features/products/db';
import { parseProductForm } from '../../../../features/products/form';
import { zonesRequireWeight } from '../../../../features/shipping/calculator';
import { shippingFor } from '../../../../features/shipping/effective';
import { uniqueSlug } from '../../../../features/products/slug';
import { setProductCategories, getCategoriesByPublicIds } from '../../../../features/categories/db';
import { applyVariantForm, validateVariantWeights, listVariants, listExtras } from '../../../../features/products/variants';
import { validateImage } from '../../../../features/products/image';
import { optimizeUpload } from '../../../../features/products/imageOptimize';
import { uploadMedia } from '../../../../features/media/upload';
import { attachMediaToProduct, replaceProductImageFromMedia } from '../../../../features/media/db';
import { getStorage, getFileStorage } from '../../../../features/storage';
import { uploadDigitalFile, validateDigitalFile } from '../../../../features/products/digitalFile.ts';
import { attachmentActive } from '../../../../features/digitalDelivery/rollout.ts';
import { indexProduct, unindexProduct } from '../../../../features/search';
import { parsePublicId } from '../../../../features/ids/publicId';
import { CACHE_TAG } from '../../../../features/cache/tags';
import { purgeCacheTags } from '../../../../features/cache/purge';

export const prerender = false;

function safeReturnTo(value: FormDataEntryValue | null, request: Request): string {
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

function addQuery(path: string, key: string, value: string | number): string {
  return `${path}${path.includes('?') ? '&' : '?'}${key}=${encodeURIComponent(String(value))}`;
}

async function resolveVariantFormIds(form: FormData, db: typeof env.DB, productId: number): Promise<string | null> {
  const variants = new Map((await listVariants(db, productId, true)).map((v) => [v.public_id ?? '', v.id]));
  const extras = new Map((await listExtras(db, productId, true)).map((e) => [e.public_id ?? '', e.id]));
  const images = new Map((await listProductImages(db, productId)).map((i) => [i.public_id ?? '', i.id]));

  const translate = (field: string, map: Map<string, number>, kind: 'variant' | 'extra' | 'productImage'): boolean => {
    const values = form.getAll(field).map((v) => String(v));
    if (values.length === 0) return true;
    const out: string[] = [];
    for (const raw of values) {
      const value = raw.trim();
      if (!value) { out.push(''); continue; }
      const parsed = parsePublicId(value, kind);
      const id = parsed ? map.get(parsed) : undefined;
      if (id === undefined) return false;
      out.push(String(id));
    }
    form.delete(field);
    for (const v of out) form.append(field, v);
    return true;
  };

  if (!translate('v_id', variants, 'variant') || !translate('v_remove', variants, 'variant')) return 'One of the variants no longer exists — reload and try again.';
  if (!translate('e_id', extras, 'extra') || !translate('e_remove', extras, 'extra')) return 'One of the add-ons no longer exists — reload and try again.';
  if (!translate('v_image', images, 'productImage')) return 'One of the variant photos no longer exists — reload and try again.';
  return null;
}

export const POST: APIRoute = async ({ request, params, redirect, locals }) => {
  const publicId = parsePublicId(params.id, 'product');
  const existing = publicId ? await getProductByPublicId(env.DB, publicId) : null;
  if (!publicId || !existing) return new Response('Not found', { status: 404 });
  const id = existing.id;
  const form = await request.formData();
  const returnTo = safeReturnTo(form.get('return_to'), request);
  const storage = getStorage();

  if (String(form.get('_action')) === 'delete') {
    await deleteProduct(env.DB, id);
    try { await unindexProduct(id); } catch (err) { console.error('Search unindex (delete) failed:', err); }
    await purgeCacheTags([CACHE_TAG.catalog, CACHE_TAG.product(publicId)]);
    return redirect(addQuery(returnTo, 'deleted', 1), 303);
  }

  const fail = (msg: string) => redirect(`/admin/products/${publicId}/edit?error=${encodeURIComponent(msg)}`, 303);
  const weightUnit = locals.settings?.weightUnit ?? 'g';
  const parsed = parseProductForm(form, { unit: weightUnit, requireWeight: zonesRequireWeight(shippingFor(locals.settings).config) });
  if ('error' in parsed) return fail(parsed.error);
  const badWeight = validateVariantWeights(form, weightUnit);
  if (badWeight) return fail(badWeight);
  const badReference = await resolveVariantFormIds(form, env.DB, id);
  if (badReference) return fail(badReference);

  const image_key = existing.image_key ?? null;
  let uploadedMediaId: number | null = null;
  const file = form.get('image');
  if (file instanceof File && file.size > 0) {
    const imgErr = validateImage(file);
    if (imgErr) return fail(imgErr);
    const media = await uploadMedia(env.DB, storage, await optimizeUpload(file), file.name);
    uploadedMediaId = media.id;
  }
  const deliverable = form.get('deliverable');
  if (attachmentActive() && deliverable instanceof File && deliverable.size > 0) {
    const fileError = validateDigitalFile(deliverable);
    if (fileError) return fail(fileError);
  }

  const slugBase = String(form.get('slug') ?? '').trim() || existing.slug || parsed.data.name;
  const slug = await uniqueSlug(env.DB, slugBase, id);
  if (uploadedMediaId !== null) {
    const claimed = image_key ? await replaceProductImageFromMedia(env.DB, id, image_key, uploadedMediaId) : false;
    if (!claimed) {
      const attached = await attachMediaToProduct(env.DB, id, uploadedMediaId);
      if (!attached.ok) return fail(attached.error);
    }
  }

  await updateProduct(env.DB, id, { ...parsed.data, image_key, slug });
  if (attachmentActive() && deliverable instanceof File && deliverable.size > 0) {
    await setProductFile(env.DB, id, await uploadDigitalFile(getFileStorage(), deliverable));
  } else if (attachmentActive() && form.get('remove_deliverable') != null) {
    await setProductFile(env.DB, id, null);
  }
  if (uploadedMediaId !== null) await syncPrimaryImage(env.DB, id);

  const categoryPublicIds = form.getAll('category').map((v) => parsePublicId(v, 'category')).filter((v): v is string => v !== null);
  const categoryIds = (await getCategoriesByPublicIds(env.DB, categoryPublicIds)).map((c) => c.id);
  await setProductCategories(env.DB, id, categoryIds);

  const variantResult = await applyVariantForm(env.DB, id, form, parsed.data.currency, weightUnit);
  if (variantResult.error) return fail(variantResult.error);

  try {
    const updated = await getProduct(env.DB, id);
    if (updated) await indexProduct(updated);
  } catch (err) { console.error('Search index (update) failed:', err); }

  await purgeCacheTags([CACHE_TAG.catalog, CACHE_TAG.product(publicId)]);
  return redirect(addQuery(returnTo, 'message', '商品已更新，页面已刷新。'), 303);
};
