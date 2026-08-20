import { env } from 'cloudflare:workers';
import { WaffoPancake, verifyWebhook } from '@waffo/pancake-ts';
import { currencyDecimals, toMajorUnits } from '../../money';
import type { PaidOrderInput, ShippingAddress } from '../orders/db';
import type {
  CheckoutResult,
  CreateCheckoutParams,
  PaymentProvider,
  WebhookResult,
} from './provider';

const nonEmpty = (value: string | undefined | null): string | null => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

/**
 * Waffo Pancake configuration is deliberately deployment-level. The merchant
 * private key is a Worker secret; product/tax configuration is supplied as vars
 * so the application never creates or publishes products implicitly.
 */
function getWaffoConfig() {
  const merchantId = nonEmpty(env.WAFFO_MERCHANT_ID);
  const privateKey = nonEmpty(env.WAFFO_PRIVATE_KEY);
  const productId = nonEmpty(env.WAFFO_PRODUCT_ID);
  const taxCategory = nonEmpty(env.WAFFO_TAX_CATEGORY);
  if (!merchantId || !privateKey || !productId || !taxCategory) {
    throw new Error(
      'Waffo is not fully configured. Set WAFFO_MERCHANT_ID, WAFFO_PRIVATE_KEY, WAFFO_PRODUCT_ID and WAFFO_TAX_CATEGORY.',
    );
  }
  return { merchantId, privateKey, productId, taxCategory };
}

export function isWaffoConfigured(): boolean {
  return Boolean(
    nonEmpty(env.WAFFO_MERCHANT_ID) &&
      nonEmpty(env.WAFFO_PRIVATE_KEY) &&
      nonEmpty(env.WAFFO_PRODUCT_ID) &&
      nonEmpty(env.WAFFO_TAX_CATEGORY),
  );
}

function createClient() {
  const { merchantId, privateKey } = getWaffoConfig();
  return new WaffoPancake({ merchantId, privateKey });
}

function displayAmount(minorUnits: number, currency: string): string {
  return toMajorUnits(minorUnits, currency).toFixed(currencyDecimals(currency));
}

function billingDetail(address: ShippingAddress) {
  const detail: {
    country: string;
    isBusiness: boolean;
    postcode?: string;
    state?: string;
  } = {
    country: address.country ?? '',
    isBusiness: false,
  };
  if (address.postal) detail.postcode = address.postal;
  if (address.state) detail.state = address.state;
  return detail;
}

export function createWaffoProvider(): PaymentProvider {
  return {
    async createCheckout(params: CreateCheckoutParams): Promise<CheckoutResult> {
      const { productId, taxCategory } = getWaffoConfig();
      const client = createClient();

      // Pancake's checkout is product-based. Mingshop therefore uses one
      // merchant-created one-time Waffo product as the payment rail and sends
      // the authoritative Mingshop subtotal + selected shipping as a
      // priceSnapshot. Inventory, itemization and the final order record remain
      // authoritative in D1 and are correlated through reservation_id.
      const subtotalMinor = params.lineItems.reduce(
        (sum, line) => sum + line.amountCents * line.quantity,
        0,
      );
      const shippingMinor = params.selectedShipping?.amountCents ?? 0;
      const chargeableMinor = subtotalMinor + shippingMinor;
      const currency = params.lineItems[0]?.currency?.toUpperCase();
      if (!currency) throw new Error('Waffo checkout requires at least one line item currency.');
      if (params.lineItems.some((line) => line.currency.toUpperCase() !== currency)) {
        throw new Error('Waffo checkout cannot mix currencies in one session.');
      }
      if (chargeableMinor <= 0) throw new Error('Waffo checkout amount must be greater than zero.');

      const metadata: Record<string, string> = { ...(params.metadata ?? {}) };
      const reservationId = metadata.reservation_id;
      if (reservationId) metadata.reservation_id = reservationId;
      if (params.selectedShipping) {
        metadata.shipping_cents = String(params.selectedShipping.amountCents);
        metadata.shipping_label = params.selectedShipping.label.slice(0, 120);
        metadata.shipping_weight_grams = String(params.selectedShipping.weightGrams ?? '');
        metadata.delivery_method = params.selectedShipping.deliveryMethod;
        metadata.shipping_address = JSON.stringify(params.selectedShipping.address);
      }

      const session = await client.checkout.createSession({
        productId,
        currency,
        priceSnapshot: {
          amount: displayAmount(chargeableMinor, currency),
          taxCategory,
        },
        buyerEmail: params.selectedShipping?.email ?? undefined,
        billingDetail: params.selectedShipping
          ? billingDetail(params.selectedShipping.address)
          : undefined,
        successUrl: params.successUrl,
        metadata,
        orderMerchantExternalId: reservationId,
        expiresInSeconds: 45 * 60,
      });

      return {
        url: session.checkoutUrl,
      };
    },

    async verifyWebhook(payload: string, headers: Headers): Promise<WebhookResult> {
      const signature = headers.get('x-waffo-signature');
      if (!signature) throw new Error('Missing X-Waffo-Signature header.');

      const event = verifyWebhook(payload, signature);
      const data = event.data;
      const metadata = data.orderMetadata ?? {};
      const reservationId = metadata.reservation_id ?? data.orderMerchantExternalId ?? undefined;

      if (event.eventType === 'order.completed') {
        const amount = Number(data.total ?? data.amount);
        const taxAmount = Number(data.taxAmount ?? '0');
        const decimals = currencyDecimals(data.currency);
        const shippingCents = Number(metadata.shipping_cents ?? '0');
        if (!Number.isFinite(amount) || amount < 0) {
          throw new Error('Waffo webhook contained an invalid order amount.');
        }
        if (!Number.isFinite(taxAmount) || taxAmount < 0) {
          throw new Error('Waffo webhook contained an invalid tax amount.');
        }
        if (!Number.isInteger(shippingCents) || shippingCents < 0) {
          throw new Error('Waffo webhook contained invalid shipping metadata.');
        }

        let shippingAddress: ShippingAddress | null = null;
        if (metadata.shipping_address) {
          try {
            const parsed = JSON.parse(metadata.shipping_address) as ShippingAddress;
            if (parsed && typeof parsed === 'object') shippingAddress = parsed;
          } catch {
            throw new Error('Waffo webhook contained invalid shipping address metadata.');
          }
        }

        const order: PaidOrderInput = {
          providerSessionId: event.eventId || data.orderId,
          publicId: reservationId,
          reservationId,
          email: data.buyerEmail || null,
          amountTotalCents: Math.round(amount * 10 ** decimals),
          shippingCents,
          shippingLabel: metadata.shipping_label ?? null,
          shippingWeightGrams: metadata.shipping_weight_grams
            ? Number(metadata.shipping_weight_grams)
            : null,
          deliveryMethod:
            metadata.delivery_method === 'pickup' || metadata.delivery_method === 'shipping'
              ? metadata.delivery_method
              : null,
          shippingAddress,
          taxCents: Math.round(taxAmount * 10 ** decimals),
          currency: data.currency,
          paymentMethod: 'waffo',
          providerPaymentId: data.paymentId ?? data.orderId ?? null,
          items: [],
        };

        return {
          type: event.eventType,
          order,
        };
      }

      // Other Waffo events are intentionally ignored by the generic one-time
      // order pipeline. Subscriptions can be added later without changing the
      // one-time checkout settlement contract.
      return { type: event.eventType };
    },
  };
}
