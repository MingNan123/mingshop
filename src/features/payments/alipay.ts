import type { D1Database } from '@cloudflare/workers-types';
import type {
  CheckoutResult,
  CreateCheckoutParams,
  PaymentProvider,
  WebhookResult,
} from './provider';
import {
  createPendingPayment,
  getPendingByHash,
  pendingToPaidOrder,
} from './lightning/pending';

export const ALIPAY_CHECKOUT_TTL_SECONDS = 30 * 60;

export type AlipayMode = 'sandbox' | 'production';

export interface AlipayConfig {
  appId: string;
  privateKey: string;
  alipayPublicKey: string;
  mode: AlipayMode;
  gatewayUrl?: string;
}

const PROD_GATEWAY = 'https://openapi.alipay.com/gateway.do';

function gatewayFor(config: AlipayConfig): string {
  if (config.gatewayUrl?.trim()) return config.gatewayUrl.trim();
  if (config.mode === 'production') return PROD_GATEWAY;
  throw new Error(
    'ALIPAY_GATEWAY_URL is required in sandbox mode. Copy the current sandbox gateway from Alipay Open Platform.',
  );
}

function compactPem(value: string): string {
  return value
    .replace(/-----BEGIN [^-]+-----/g, '')
    .replace(/-----END [^-]+-----/g, '')
    .replace(/\s+/g, '');
}

function decodeBase64(value: string): ArrayBuffer {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function encodeBase64(value: ArrayBuffer): string {
  const bytes = new Uint8Array(value);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

async function importPrivateKey(pem: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'pkcs8',
    decodeBase64(compactPem(pem)),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
}

async function importAlipayPublicKey(pem: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'spki',
    decodeBase64(compactPem(pem)),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  );
}

function canonicalParams(
  params: Iterable<[string, string]>,
  excluded = new Set<string>(),
): string {
  return [...params]
    .filter(([key, value]) => !excluded.has(key) && value !== '')
    .sort(([a], [b]) => a.localeCompare(b, 'en'))
    .map(([key, value]) => `${key}=${value}`)
    .join('&');
}

async function rsa2Sign(content: string, privateKeyPem: string): Promise<string> {
  const key = await importPrivateKey(privateKeyPem);
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(content),
  );
  return encodeBase64(signature);
}

async function rsa2Verify(
  content: string,
  signature: string,
  alipayPublicKeyPem: string,
): Promise<boolean> {
  const key = await importAlipayPublicKey(alipayPublicKeyPem);
  return crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    decodeBase64(signature),
    new TextEncoder().encode(content),
  );
}

function alipayTimestamp(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')}`;
}

function yuan(cents: number): string {
  return (cents / 100).toFixed(2);
}

function orderSubject(params: CreateCheckoutParams): string {
  const first = params.lineItems[0]?.name?.trim() || 'Mingshop order';
  const suffix = params.lineItems.length > 1 ? ` +${params.lineItems.length - 1}` : '';
  return `${first}${suffix}`.slice(0, 128);
}

/**
 * Alipay Computer Website Payment adapter.
 *
 * Production deliberately requires a CNY store because alipay.trade.page.pay's
 * `total_amount` is RMB-denominated. Sandbox may use another store currency for
 * nominal-value integration testing only (e.g. a displayed $10 order sends 10.00
 * sandbox RMB); no real money is involved there.
 */
export function createAlipayProvider(
  db: D1Database,
  config: AlipayConfig,
): PaymentProvider {
  const gateway = gatewayFor(config);

  return {
    async createCheckout(params: CreateCheckoutParams): Promise<CheckoutResult> {
      const currency = (params.lineItems[0]?.currency ?? 'cny').toLowerCase();
      if (config.mode === 'production' && currency !== 'cny') {
        throw new Error(
          'Production Alipay checkout requires the store currency to be CNY. Sandbox mode may use nominal non-CNY amounts for testing only.',
        );
      }
      if (params.shipping && !params.selectedShipping) {
        throw new Error(
          'Alipay hosted checkout does not collect a shipping address. Use it for digital orders, or collect shipping in-app before payment.',
        );
      }

      const subtotalCents = params.lineItems.reduce(
        (sum, item) => sum + item.amountCents * item.quantity,
        0,
      );
      const shippingCents = params.selectedShipping?.amountCents ?? 0;
      const amountTotalCents = subtotalCents + shippingCents;
      if (!Number.isSafeInteger(amountTotalCents) || amountTotalCents <= 0) {
        throw new Error('Alipay checkout amount must be a positive integer minor-unit amount.');
      }

      const publicId = params.metadata?.public_id ?? crypto.randomUUID();
      const outTradeNo = `ali_${publicId}`.slice(0, 64);
      const origin = new URL(params.successUrl).origin;

      await createPendingPayment(db, {
        publicId,
        paymentHash: outTradeNo,
        backend: 'alipay',
        bolt11: null,
        amountSat: null,
        amountTotalCents,
        currency,
        email: params.selectedShipping?.email ?? null,
        itemsJson: params.orderItemsJson ?? null,
        shippingCents,
        shippingLabel: params.selectedShipping?.label ?? null,
        shippingWeightGrams: params.selectedShipping?.weightGrams ?? null,
        deliveryMethod: params.selectedShipping?.deliveryMethod ?? null,
        shipAddressJson: params.selectedShipping
          ? JSON.stringify(params.selectedShipping.address)
          : null,
        reservationId: params.metadata?.reservation_id ?? null,
        expiresAt: new Date(Date.now() + ALIPAY_CHECKOUT_TTL_SECONDS * 1000).toISOString(),
      });

      const common = new URLSearchParams({
        app_id: config.appId,
        method: 'alipay.trade.page.pay',
        format: 'JSON',
        charset: 'utf-8',
        sign_type: 'RSA2',
        timestamp: alipayTimestamp(),
        version: '1.0',
        notify_url: `${origin}/api/webhook/alipay`,
        return_url: params.successUrl,
        biz_content: JSON.stringify({
          out_trade_no: outTradeNo,
          product_code: 'FAST_INSTANT_TRADE_PAY',
          total_amount: yuan(amountTotalCents),
          subject: orderSubject(params),
          timeout_express: '30m',
        }),
      });
      const signContent = canonicalParams(common.entries());
      common.set('sign', await rsa2Sign(signContent, config.privateKey));

      return { url: `${gateway}?${common.toString()}` };
    },

    async verifyWebhook(payload: string): Promise<WebhookResult> {
      const form = new URLSearchParams(payload);
      const signature = form.get('sign');
      if (!signature) throw new Error('Missing Alipay sign field.');
      const content = canonicalParams(form.entries(), new Set(['sign', 'sign_type']));
      if (!(await rsa2Verify(content, signature, config.alipayPublicKey))) {
        throw new Error('Invalid Alipay RSA2 signature.');
      }

      if (form.get('app_id') !== config.appId) {
        throw new Error('Alipay app_id does not match this store.');
      }

      const outTradeNo = form.get('out_trade_no')?.trim() ?? '';
      if (!outTradeNo) throw new Error('Missing Alipay out_trade_no.');
      const pending = await getPendingByHash(db, outTradeNo);
      if (!pending || pending.backend !== 'alipay') {
        throw new Error('Unknown Alipay order.');
      }

      const paidCents = Math.round(Number(form.get('total_amount')) * 100);
      if (!Number.isSafeInteger(paidCents) || paidCents !== pending.amount_total_cents) {
        throw new Error('Alipay amount does not match the server-side order total.');
      }

      const tradeStatus = form.get('trade_status') ?? '';
      if (tradeStatus !== 'TRADE_SUCCESS' && tradeStatus !== 'TRADE_FINISHED') {
        return { type: `alipay.${tradeStatus || 'unknown'}` };
      }

      const order = pendingToPaidOrder(pending);
      return {
        type: `alipay.${tradeStatus}`,
        settlePendingPaymentId: String(pending.id),
        order: {
          ...order,
          providerPaymentId: form.get('trade_no') ?? null,
        },
      };
    },
  };
}
