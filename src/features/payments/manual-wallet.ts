import type { D1Database } from '@cloudflare/workers-types';
import type {
  CheckoutResult,
  CreateCheckoutParams,
  PaymentProvider,
  WebhookResult,
} from './provider';
import { createPendingPayment } from './lightning/pending';

export type ManualWalletMethod = 'alipay' | 'wechatpay' | 'usdc' | 'usdt';

export const MANUAL_WALLET_CHECKOUT_TTL_SECONDS = 7 * 24 * 60 * 60;

type OrderItemSnap = { id?: number };

async function containsShippableProduct(db: D1Database, itemsJson?: string): Promise<boolean> {
  if (!itemsJson) return false;
  let ids: number[] = [];
  try {
    const parsed = JSON.parse(itemsJson) as OrderItemSnap[];
    ids = [...new Set(parsed.map((x) => Number(x.id)).filter((id) => Number.isInteger(id) && id > 0))];
  } catch {
    return false;
  }
  if (ids.length === 0) return false;
  const placeholders = ids.map(() => '?').join(',');
  const row = await db.prepare(
    `SELECT 1 AS yes FROM products WHERE id IN (${placeholders}) AND requires_shipping != 0 LIMIT 1`,
  ).bind(...ids).first<{ yes: number }>();
  return !!row;
}

/**
 * Direct-payment rails persist a server-priced pending payment. USDC/USDT are
 * chain-verified later; Alipay/WeChat still use the manual confirmation page.
 */
export function createManualWalletProvider(
  db: D1Database,
  method: ManualWalletMethod,
): PaymentProvider {
  return {
    async createCheckout(params: CreateCheckoutParams): Promise<CheckoutResult> {
      if (params.shipping && !params.selectedShipping) {
        throw new Error(`${method} checkout requires the in-app shipping step before payment.`);
      }
      // Defense in depth for crafted/programmatic requests. Hosted/manual wallet
      // rails cannot infer a destination after checkout begins, so a physical
      // basket must arrive with a server-selected shipping quote. Never create a
      // pending stablecoin order that silently omits shipping.
      if (!params.selectedShipping && await containsShippableProduct(db, params.orderItemsJson)) {
        throw new Error(`${method} checkout requires a validated shipping address and rate.`);
      }

      const subtotal = params.lineItems.reduce((s, li) => s + li.amountCents * li.quantity, 0);
      const shippingCents = params.selectedShipping?.amountCents ?? 0;
      const publicId = params.metadata?.public_id ?? crypto.randomUUID();
      const paymentHash = `${method}_${publicId}`;
      await createPendingPayment(db, {
        publicId,
        paymentHash,
        backend: method,
        bolt11: null,
        amountSat: null,
        amountTotalCents: subtotal + shippingCents,
        currency: params.lineItems[0]?.currency ?? 'usd',
        email: params.selectedShipping?.email ?? null,
        itemsJson: params.orderItemsJson ?? null,
        shippingCents,
        shippingLabel: params.selectedShipping?.label ?? null,
        shippingWeightGrams: params.selectedShipping?.weightGrams ?? null,
        deliveryMethod: params.selectedShipping?.deliveryMethod ?? null,
        shipAddressJson: params.selectedShipping ? JSON.stringify(params.selectedShipping.address) : null,
        reservationId: params.metadata?.reservation_id ?? null,
        expiresAt: new Date(Date.now() + MANUAL_WALLET_CHECKOUT_TTL_SECONDS * 1000).toISOString(),
      });
      return { url: new URL(`/pay/${params.accessToken ?? publicId}`, params.successUrl).href };
    },

    async verifyWebhook(): Promise<WebhookResult> {
      throw new Error(`${method} direct payment has no webhook.`);
    },
  };
}
