/// <reference types="astro/client" />

declare module '*.sql?raw' {
  const content: string;
  export default content;
}

interface CacheStorage {
  readonly default: Cache;
}

interface ImagesBindingMin {
  input(stream: ReadableStream): {
    transform(opts: { width?: number; height?: number }): {
      output(opts: { format: string; quality?: number }): Promise<{ response(): Response }>;
    };
  };
}

type CloudflareRuntime = import('@astrojs/cloudflare').Runtime;
declare namespace App {
  interface Locals extends CloudflareRuntime {
    adminEmail?: string;
    settings?: import('./features/settings/db').StoreSettings;
    menus?: import('./features/navigation/db').Menus;
  }
}

declare namespace Cloudflare {
  interface Env {
    DB: import('@cloudflare/workers-types').D1Database;
    BUCKET: import('@cloudflare/workers-types').R2Bucket;
    FILES: import('@cloudflare/workers-types').R2Bucket;
    AUTH_RATE_LIMITER?: import('@cloudflare/workers-types').RateLimit;
    CHECKOUT_RATE_LIMITER?: import('@cloudflare/workers-types').RateLimit;
    SEARCH_RATE_LIMITER?: import('@cloudflare/workers-types').RateLimit;
    IMAGES?: ImagesBindingMin;
    AI?: import('@cloudflare/workers-types').Ai;
    VECTORIZE?: import('@cloudflare/workers-types').VectorizeIndex;
    SEARCH_PROVIDER?: string;
    STORE_NAME: string;
    TIME_ZONE?: string;
    IMAGE_BASE_URL?: string;
    MCP_URL?: string;
    CANONICAL_ORIGIN?: string;
    CF_ACCESS_TEAM_DOMAIN?: string;
    CF_ACCESS_AUD?: string;

    /** Waffo Pancake Merchant ID from Dashboard → API & Development. */
    WAFFO_MERCHANT_ID?: string;
    /** Waffo RSA private key. Store this as a Worker secret, never in git. */
    WAFFO_PRIVATE_KEY?: string;
    /** Existing Waffo one-time product used by Mingshop's dynamic-price checkout. */
    WAFFO_PRODUCT_ID?: string;
    /** Tax category configured for that Waffo product. */
    WAFFO_TAX_CATEGORY?: string;

    AUTH_SECRET?: string;
    CACHE_PURGE_SECRET?: string;
    SECRETS_KEK?: string;
    EMAIL?: import('./features/email/cloudflare').EmailBinding;
  }
}
