import { env } from 'cloudflare:workers';
import type { PaymentProvider } from './provider';
import type { StoreSettings } from '../settings/db';
import { getStoreSettings } from '../settings/db';
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
type ActivePaymentMethod = Exclude<PaymentMethod, 'demo'>;
const ALL_METHODS: ActivePaymentMethod[] = ['stripe','waffo','lightning','opennode','alipay','wechatpay','usdc','usdt'];
const OFFERED: ActivePaymentMethod[] = ['stripe','waffo','lightning','alipay','wechatpay','usdc','usdt'];

export function isPaymentMethod(value: string): value is PaymentMethod {
  return ['stripe','waffo','lightning','opennode','alipay','wechatpay','usdc','usdt','demo'].includes(value);
}
export function isMethodAvailable(method: PaymentMethod, settings: StoreSettings, vault = vaultReady()): boolean {
  const has = (name: string) => vault && settings.configuredSecrets.includes(name);
  switch (method) {
    case 'stripe': return has('stripe_secret_key') && has('stripe_webhook_secret');
    case 'waffo': return isWaffoConfigured();
    case 'opennode': return has('opennode_api_key');
    case 'alipay': return !!settings.alipayPaymentUrl;
    case 'wechatpay': return !!settings.wechatpayPaymentUrl;
    case 'usdc': return !!settings.usdcAddress && !!settings.usdcNetwork && settings.usdcAutoVerifyReady;
    case 'usdt': return !!settings.usdtAddress && !!settings.usdtNetwork && settings.usdtAutoVerifyReady;
    case 'lightning': return settings.lightningBackend === 'lnbits' ? !!settings.lnbitsUrl && has('lnbits_api_key') : !!settings.phoenixdUrl && has('phoenixd_password');
    case 'demo': return false;
  }
}
export function hasRealMethod(settings: StoreSettings, vault = vaultReady()): boolean { return ALL_METHODS.some((m) => isMethodAvailable(m, settings, vault)); }
export function paymentsInDemoMode(_settings: StoreSettings): boolean { return false; }
export function defaultMethod(settings: StoreSettings): ActivePaymentMethod { return settings.paymentProvider; }
export function enabledMethods(settings: StoreSettings, vault = vaultReady()): ActivePaymentMethod[] {
  const off = new Set(settings.disabledPaymentMethods); const def = defaultMethod(settings);
  return [def, ...ALL_METHODS.filter((m) => m !== def)].filter((m) => isMethodAvailable(m, settings, vault)).filter((m) => !off.has(m));
}
export function offeredMethods(settings: StoreSettings, vault = vaultReady()): ActivePaymentMethod[] {
  const off = new Set(settings.disabledPaymentMethods);
  const extra = ALL_METHODS.filter((m) => !OFFERED.includes(m) && isMethodAvailable(m, settings, vault));
  return ([...OFFERED, ...extra] as ActivePaymentMethod[]).filter((m) => !off.has(m));
}
export async function getPaymentProvider(method?: PaymentMethod): Promise<PaymentProvider> {
  const settings = await getStoreSettings(env.DB); const m = method ?? defaultMethod(settings);
  switch (m) {
    case 'demo': throw new Error('Demo checkout has been removed.');
    case 'waffo': if (!isWaffoConfigured()) throw new Error('Waffo is not fully configured.'); return createWaffoProvider();
    case 'lightning': return createLightningProvider(env.DB, await getLightningBackend());
    case 'opennode': { const key = await getSecret(env.DB, 'opennode_api_key'); if (!key) throw new Error('OpenNode is not configured.'); return createOpenNodeProvider(env.DB, key, settings.opennodeApiUrl ?? undefined); }
    case 'alipay': case 'wechatpay': case 'usdc': case 'usdt':
      if (!isMethodAvailable(m, settings)) throw new Error(`${m} is not configured.`);
      return createManualWalletProvider(env.DB, m);
    case 'stripe': default: {
      const secretKey = await getSecret(env.DB, 'stripe_secret_key'); const webhookSecret = await getSecret(env.DB, 'stripe_webhook_secret');
      if (!secretKey || !webhookSecret) throw new Error('Stripe is not fully configured.');
      return createStripeProvider(secretKey, webhookSecret);
    }
  }
}
