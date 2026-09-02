import { env } from 'cloudflare:workers';
import type { PaymentProvider } from './provider';
import type { StoreSettings } from '../settings/db';
import { getStoreSettings } from '../settings/db';
import { getConfig } from '../../config';
import { createStripeProvider } from './stripe';
import { createLightningProvider } from './lightning-provider';
import { getLightningBackend } from './lightning';
import { createOpenNodeProvider } from './opennode';
import { createWaffoProvider, isWaffoConfigured } from './waffo';
import { createManualWalletProvider } from './manual-wallet';
import { getSecret, vaultReady } from '../secrets/store';

export type { PaymentProvider } from './provider';
export {
  STRIPE_CHECKOUT_TTL_SECONDS,
  WAFFO_CHECKOUT_TTL_SECONDS,
  OPENNODE_CHECKOUT_TTL_SECONDS,
  RESERVATION_EXPIRY_GRACE_SECONDS,
} from './provider';
export { MANUAL_WALLET_CHECKOUT_TTL_SECONDS } from './manual-wallet';
export const DEMO_CHECKOUT_TTL_SECONDS = 0;

export type PaymentMethod =
  | 'stripe' | 'waffo' | 'lightning' | 'opennode' | 'alipay' | 'wechatpay' | 'usdc' | 'usdt' | 'demo';
export type ActivePaymentMethod = Exclude<PaymentMethod, 'demo'>;
export interface ActivePaymentMethodList extends Array<ActivePaymentMethod> {
  includes(searchElement: PaymentMethod, fromIndex?: number): boolean;
}

// New sales deliberately expose only stablecoins. Legacy provider code remains
// below so historical webhooks/orders are still readable and serviceable.
const ALL_METHODS: ActivePaymentMethod[] = ['usdt', 'usdc'];
const OFFERED: ActivePaymentMethod[] = ['usdt', 'usdc'];
const WEBHOOK_METHODS: PaymentMethod[] = ['stripe', 'waffo', 'lightning', 'opennode'];

export function isPaymentMethod(value: string): value is PaymentMethod {
  return ['stripe','waffo','lightning','opennode','alipay','wechatpay','usdc','usdt','demo'].includes(value);
}

export function isMethodAvailable(method: PaymentMethod, settings: StoreSettings, _vault = vaultReady()): boolean {
  const usdStore = getConfig().currency.toLowerCase() === 'usd';
  if (!usdStore) return false;
  if (method === 'usdc') return settings.usdcAutoVerifyReady;
  if (method === 'usdt') return settings.usdtAutoVerifyReady;
  return false;
}

export function hasRealMethod(settings: StoreSettings, vault = vaultReady()): boolean {
  return ALL_METHODS.some((m) => isMethodAvailable(m, settings, vault));
}
export function paymentsInDemoMode(_settings: StoreSettings): boolean { return false; }
export function defaultMethod(settings: StoreSettings): ActivePaymentMethod {
  return settings.paymentProvider === 'usdc' ? 'usdc' : 'usdt';
}
export function enabledMethods(settings: StoreSettings, vault = vaultReady()): ActivePaymentMethodList {
  const off = new Set(settings.disabledPaymentMethods);
  const def = defaultMethod(settings);
  return [def, ...ALL_METHODS.filter((m) => m !== def)]
    .filter((m) => isMethodAvailable(m, settings, vault))
    .filter((m) => !off.has(m)) as ActivePaymentMethodList;
}
export function offeredMethods(settings: StoreSettings, _vault = vaultReady()): ActivePaymentMethodList {
  const off = new Set(settings.disabledPaymentMethods);
  return OFFERED.filter((m) => !off.has(m)) as ActivePaymentMethodList;
}

export function isWebhookPaymentMethod(value: string): value is PaymentMethod {
  return (WEBHOOK_METHODS as string[]).includes(value);
}

export function webhookMethods(): PaymentMethod[] {
  return [...WEBHOOK_METHODS];
}

export async function getPaymentProvider(method?: PaymentMethod): Promise<PaymentProvider> {
  const settings = await getStoreSettings(env.DB);
  const m = method ?? defaultMethod(settings);
  switch (m) {
    case 'demo': throw new Error('Demo checkout has been removed.');
    case 'waffo': if (!isWaffoConfigured()) throw new Error('Waffo is not fully configured.'); return createWaffoProvider();
    case 'lightning': return createLightningProvider(env.DB, await getLightningBackend());
    case 'opennode': {
      const key = await getSecret(env.DB, 'opennode_api_key');
      if (!key) throw new Error('OpenNode is not configured.');
      return createOpenNodeProvider(env.DB, key, settings.opennodeApiUrl ?? undefined);
    }
    case 'alipay': case 'wechatpay':
      throw new Error(`${m} is no longer accepted for new checkout.`);
    case 'usdc': case 'usdt':
      if (!isMethodAvailable(m, settings)) throw new Error(`${m} is not configured.`);
      return createManualWalletProvider(env.DB, m);
    case 'stripe': default: {
      const secretKey = await getSecret(env.DB, 'stripe_secret_key');
      const webhookSecret = await getSecret(env.DB, 'stripe_webhook_secret');
      if (!secretKey || !webhookSecret) throw new Error('Stripe is not fully configured.');
      return createStripeProvider(secretKey, webhookSecret);
    }
  }
}
