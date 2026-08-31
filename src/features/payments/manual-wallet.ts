import type { D1Database } from '@cloudflare/workers-types';
import type {
  CheckoutResult,
  CreateCheckoutParams,
  PaymentProvider,
  WebhookResult,
} from './provider';
import { createPendingPayment } from './lightning/pending';

export type ManualWalletMethod = 'alipay' | 'wechatpay' | 'usdc';

export const MANUAL_WALLET_CHECKOUT_TTL_SECONDS = 7 * 24 * 60 * 60;

/**
 * Direct-payment rails for merchants who need to accept money immediately,
 * before a hosted processor/account review is available. Settlement is confirmed
 * on the self-rendered pay page and remains reconcilable by payment_method.
 */
export function createManualWalletProvider(
  db: D1Database,
  method: ManualWalletMethod,
): PaymentProvider {
  return {
    async createCheckout(params: CreateCheckoutParams): Promise<CheckoutResult> {
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
        shipAddressJson: params.selectedShipping
          ? JSON.stringify(params.selectedShipping.address)
          : null,
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
