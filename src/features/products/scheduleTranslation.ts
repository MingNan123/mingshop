import { env } from 'cloudflare:workers';
import { getProduct } from './db';
import { enqueueProductTranslation, processProductTranslation } from './autoTranslate';
import { CACHE_TAG } from '../cache/tags';
import { purgeCacheTags } from '../cache/purge';

export async function scheduleProductTranslation(productId: number, ctx?: { waitUntil(promise: Promise<unknown>): void }): Promise<void> {
  try {
    const product = await getProduct(env.DB, productId);
    if (!product) return;
    await enqueueProductTranslation(env.DB, product);
    const ai = env.AI;
    if (ai && ctx) ctx.waitUntil((async () => {
      if (await processProductTranslation(env.DB, ai, productId)) {
        await purgeCacheTags([CACHE_TAG.catalog, ...(product.public_id ? [CACHE_TAG.product(product.public_id)] : [])]);
      }
    })().catch(error => console.error('Product translation background task failed', error)));
  } catch (error) {
    console.error('Product translation scheduling failed', error);
  }
}
