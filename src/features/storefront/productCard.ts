import type { Product } from '../products/db';
import { productImageSources, type ImageDelivery } from '../products/image';
import { requirePublicId } from '../catalog/serialize';
import { stockState } from '../products/stock';
import { formatMoney } from '../../money';
import type { ProductCardModel, StorefrontImage } from './models';

export interface StorefrontImageOptions {
  baseUrl?: string;
  delivery?: ImageDelivery;
  sizes?: string;
  priority?: boolean;
}

export function buildStorefrontImage(imageKey: string | null, alt: string, options: StorefrontImageOptions = {}): StorefrontImage {
  const priority = options.priority ?? false;
  const sources = productImageSources(imageKey, { baseUrl: options.baseUrl, delivery: options.delivery, usage: priority ? 'detail' : 'card', sizes: options.sizes });
  return { src: sources.src, ...(sources.srcset ? { srcset: sources.srcset } : {}), ...(sources.sizes ? { sizes: sources.sizes } : {}), alt, priority };
}

export interface ProductCardOptions extends StorefrontImageOptions { currency: string; }

export function buildProductCard(product: Product, options: ProductCardOptions): ProductCardModel {
  return {
    id: requirePublicId(product.public_id, product.id, 'product'),
    name: product.name,
    description: product.description,
    href: `/products/${product.slug}`,
    image: buildStorefrontImage(product.image_key, product.name, options),
    formattedPrice: formatMoney(product.price_cents, options.currency),
    inStock: stockState(product.stock) !== 'out',
    billingInterval: product.billing_interval ?? null,
  };
}
