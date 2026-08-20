import type { D1Database } from '@cloudflare/workers-types';
import { normalizeTimeZone } from './timeZone';
import {
  parseRuntimeShippingConfig,
  type ParsedRuntimeShippingConfig,
} from '../shipping/settings';
import { defaultWeightUnit, isWeightUnit, type WeightUnit } from '../shipping/weight';

/**
 * Runtime settings — the small set of values the setup wizard persists to D1 so
 * they can change without a redeploy. Everything else stays build-time config.
 * Reads here OVERLAY env/config defaults; absence means "use the default".
 */

/** Keys we store. Kept narrow on purpose — most config remains build-time. */
export type SettingKey =
  | 'setup_complete'
  | 'store_name'
  | 'time_zone'
  | 'stripe_webhook_secret'
  | 'payment_methods_disabled'
  | 'cart_enabled'
  | 'buy_now_enabled'
  | 'search_provider'
  | 'discounts_enabled'
  | 'tax_enabled'
  | 'accounts_enabled'
  | 'image_optimize'
  | 'image_delivery'
  | 'shipping_enabled'
  | 'shipping_config'
  | 'weight_unit'
  | 'ship_from'
  | 'parcel_default'
  | 'admin_password_hash'
  | 'email_enabled'
  | 'email_provider'
  | 'logo_image_key'
  | 'home_page'
  | 'announcement'
  | 'announcement_href'
  | 'email_from'
  | 'store_url'
  | 'email_from_name'
  | 'email_notify_to'
  | 'turnstile_enabled'
  | 'turnstile_site_key'
  | 'payment_provider'
  | 'lightning_backend'
  | 'lnbits_url'
  | 'phoenixd_url'
  | 'opennode_api_url'
  | `enc:${string}`;

export type FeatureKey = 'cart_enabled' | 'buy_now_enabled';

export interface StoreSettings {
  setupComplete: boolean;
  storeName: string | null;
  timeZone: string | null;
  stripeWebhookSecret: string | null;
  disabledPaymentMethods: string[];
  cartEnabled: boolean;
  buyNowEnabled: boolean;
  searchProvider: 'fts' | 'vector' | null;
  configuredSecrets: string[];
  emailEnabled: boolean;
  emailProvider: 'resend' | 'cloudflare';
  logoImageKey: string | null;
  homePage: string | null;
  announcement: string | null;
  announcementHref: string | null;
  emailFrom: string | null;
  emailFromName: string | null;
  emailNotifyTo: string | null;
  discountsEnabled: boolean | null;
  taxEnabled: boolean | null;
  accountsEnabled: boolean | null;
  imageOptimize: boolean | null;
  imageDelivery: 'original' | 'cloudflare';
  shippingEnabled: boolean | null;
  shippingConfig: ParsedRuntimeShippingConfig;
  weightUnit: WeightUnit;
  turnstileEnabled: boolean;
  turnstileSiteKey: string | null;
  paymentProvider: 'stripe' | 'waffo' | 'lightning' | 'opennode' | 'demo';
  lightningBackend: 'phoenixd' | 'lnbits';
  lnbitsUrl: string | null;
  phoenixdUrl: string | null;
  opennodeApiUrl: string | null;
}

export async function getSetting(db: D1Database, key: SettingKey): Promise<string | null> {
  const row = await db
    .prepare('SELECT value FROM settings WHERE key = ?')
    .bind(key)
    .first<{ value: string }>();
  return row?.value ?? null;
}

/** Upsert a setting (empty/undefined value deletes it → falls back to the default). */
export async function setSetting(
  db: D1Database,
  key: SettingKey,
  value: string | null | undefined,
): Promise<void> {
  if (value == null || value === '') {
    await db.prepare('DELETE FROM settings WHERE key = ?').bind(key).run();
    return;
  }
  await db
    .prepare(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
    )
    .bind(key, value)
    .run();
}

export const STORE_SETTINGS_SQL = 'SELECT key, value FROM settings';

export async function getStoreSettings(db: D1Database): Promise<StoreSettings> {
  const { results } = await db.prepare(STORE_SETTINGS_SQL).all<{ key: string; value: string }>();
  return parseStoreSettings(results ?? []);
}

export function parseStoreSettings(
  results: Array<{ key: string; value: string }>,
): StoreSettings {
  const map = new Map((results ?? []).map((r) => [r.key, r.value]));
  return {
    setupComplete: map.get('setup_complete') === '1',
    storeName: map.get('store_name') ?? null,
    timeZone: normalizeTimeZone(map.get('time_zone')),
    stripeWebhookSecret: map.get('stripe_webhook_secret') ?? null,
    disabledPaymentMethods: (map.get('payment_methods_disabled') ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    cartEnabled: map.get('cart_enabled') !== '0',
    buyNowEnabled: map.get('buy_now_enabled') !== '0',
    searchProvider: map.get('search_provider') === 'vector' ? 'vector'
      : map.get('search_provider') === 'fts' ? 'fts'
      : null,
    configuredSecrets: (results ?? [])
      .filter((r) => r.key.startsWith('enc:') && r.value)
      .map((r) => r.key.slice(4)),
    emailEnabled: map.get('email_enabled') !== '0',
    emailProvider: map.get('email_provider') === 'cloudflare' ? 'cloudflare' : 'resend',
    logoImageKey: map.get('logo_image_key') ?? null,
    homePage: map.get('home_page') ?? null,
    announcement: map.get('announcement') ?? null,
    announcementHref: map.get('announcement_href') ?? null,
    emailFrom: map.get('email_from') ?? null,
    emailFromName: map.get('email_from_name') ?? null,
    emailNotifyTo: map.get('email_notify_to') ?? null,
    discountsEnabled: map.get('discounts_enabled') == null ? null : map.get('discounts_enabled') === '1',
    taxEnabled: map.get('tax_enabled') == null ? null : map.get('tax_enabled') === '1',
    accountsEnabled: map.get('accounts_enabled') == null ? null : map.get('accounts_enabled') === '1',
    imageOptimize: map.get('image_optimize') == null ? null : map.get('image_optimize') === '1',
    imageDelivery: map.get('image_delivery') === 'cloudflare' ? 'cloudflare' : 'original',
    shippingEnabled: map.get('shipping_enabled') == null ? null : map.get('shipping_enabled') === '1',
    shippingConfig: parseRuntimeShippingConfig(map.get('shipping_config')),
    weightUnit: isWeightUnit(map.get('weight_unit'))
      ? (map.get('weight_unit') as WeightUnit)
      : defaultWeightUnit(normalizeTimeZone(map.get('time_zone'))),
    turnstileEnabled: map.get('turnstile_enabled') === '1',
    turnstileSiteKey: map.get('turnstile_site_key') ?? null,
    paymentProvider:
      map.get('payment_provider') === 'waffo' ? 'waffo'
      : map.get('payment_provider') === 'lightning' ? 'lightning'
      : map.get('payment_provider') === 'opennode' ? 'opennode'
      : map.get('payment_provider') === 'demo' ? 'demo'
      : 'stripe',
    lightningBackend: map.get('lightning_backend') === 'lnbits' ? 'lnbits' : 'phoenixd',
    lnbitsUrl: map.get('lnbits_url') ?? null,
    phoenixdUrl: map.get('phoenixd_url') ?? null,
    opennodeApiUrl: map.get('opennode_api_url') ?? null,
  };
}

export async function setFeatureEnabled(
  db: D1Database,
  key: FeatureKey,
  enabled: boolean,
): Promise<void> {
  await setSetting(db, key, enabled ? null : '0');
}

export async function setPaymentMethodDisabled(
  db: D1Database,
  method: string,
  disabled: boolean,
): Promise<void> {
  const current = (await getSetting(db, 'payment_methods_disabled')) ?? '';
  const set = new Set(
    current
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
  if (disabled) set.add(method);
  else set.delete(method);
  await setSetting(db, 'payment_methods_disabled', [...set].join(','));
}
