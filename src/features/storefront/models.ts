/**
 * Presentation models for store-owned templates.
 *
 * These are the ONLY shapes an editable storefront file receives. Database rows
 * are deliberately absent: a row would publish internal numeric IDs, storage
 * keys, mutable columns, and query-specific accidents as a de facto contract.
 */

export interface StorefrontImage {
  src: string;
  srcset?: string;
  sizes?: string;
  alt: string;
  priority: boolean;
}

/** A product as a catalog/search/recommendation card. */
export interface ProductCardModel {
  id: string;
  name: string;
  description: string | null;
  href: string;
  image: StorefrontImage;
  formattedPrice: string;
  inStock: boolean;
  /** Subscription interval metadata; absent/null means one-time. */
  billingInterval: 'month' | 'year' | null;
}

export interface StorefrontLink { text: string; href: string; }

export interface StorefrontShellModel {
  storeName: string;
  logo: StorefrontImage | null;
  announcement: { text: string; href: string | null } | null;
  headerLinks: StorefrontLink[];
  footerLinks: StorefrontLink[];
  search: { action: string; query: string };
  cart: { enabled: boolean; href: string };
  account: { enabled: boolean; href: string };
}

export interface StorefrontSortOption {
  label: string;
  href: string;
  current: boolean;
  direction: 'asc' | 'desc' | null;
}
export interface StorefrontSortModel { options: StorefrontSortOption[]; }
export interface StorefrontPaginationItem { page: number | null; href: string | null; current: boolean; }
export interface StorefrontPaginationModel {
  page: number;
  totalPages: number;
  prevHref: string | null;
  nextHref: string | null;
  items: StorefrontPaginationItem[];
}
export interface CatalogPageModel {
  eyebrow: string;
  heading: string;
  categories: StorefrontLink[];
  products: ProductCardModel[];
  sort: StorefrontSortModel;
  pagination: StorefrontPaginationModel;
}

export interface StorefrontGalleryImage { anchor: string; hero: StorefrontImage; thumbnail: StorefrontImage; }
export interface StorefrontVariant {
  id: string; label: string; formattedPrice: string; priceCents: number;
  soldOut: boolean; defaultSelected: boolean; imageAnchor: string;
}
export interface StorefrontExtra { id: string; label: string; formattedPriceDelta: string; priceDeltaCents: number; }

export interface ProductPurchaseModel {
  productId: string;
  cartAction: string;
  expressAction: string;
  hasOptions: boolean;
  soldOut: boolean;
  showAddToCart: boolean;
  showBuyNow: boolean;
  variantLabel: string | null;
  variants: StorefrontVariant[];
  extras: StorefrontExtra[];
}

export interface ProductSeoModel {
  title: string;
  description: string | null;
  imagePath: string;
  jsonLd: string;
}

export interface ProductDetailModel {
  id: string;
  name: string;
  description: string | null;
  descriptionHtml: string | null;
  formattedPrice: string;
  priceCents: number;
  currency: string;
  priceVaries: boolean;
  soldOut: boolean;
  lowStock: boolean;
  digitalDelivery: boolean;
  categories: StorefrontLink[];
  images: StorefrontGalleryImage[];
  heroImage: StorefrontImage;
  related: ProductCardModel[];
  backHref: string;
  error: string | null;
}

export interface ContentPageModel {
  title: string;
  html: string;
  layout: string;
  layoutStyle: string;
}
