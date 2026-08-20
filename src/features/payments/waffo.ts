import { env } from 'cloudflare:workers';
import { WaffoPancake, verifyWebhook } from '@waffo/pancake-ts';
import type { TaxCategory } from '@waffo/pancake-ts';
import { currencyDecimals, toMajorUnits } from '../../money';
import type { PaidOrderInput, ShippingAddress } from '../orders/db';
import type { CheckoutResult, CreateCheckoutParams, PaymentProvider, WebhookResult } from './provider';

const TAX_CATEGORIES = [
  'digital_goods',
  'saas',
  'software',
  'ebook',
  'online_course',
  'consulting',
  'professional_service',
] as const;

const nonEmpty = (value: string | undefined | null): string | null => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

function getTaxCategory(value: string): TaxCategory {
  if ((TAX_CATEGORIES as readonly string[]).includes(value)) return value as unknown as TaxCategory;
  throw new Error(`Unsupported Waffo tax category: ${value}`);
}

function getWaffoConfig() {
  const merchantId = nonEmpty(env.WAFFO_MERCHANT_ID);
  const privateKey = nonEmpty(env.WAFFO_PRIVATE_KEY);
  const productId = nonEmpty(env.WAFFO_PRODUCT_ID);
  const rawTaxCategory = nonEmpty(env.WAFFO_TAX_CATEGORY);
  if (!merchantId || !privateKey || !productId || !rawTaxCategory) {
    throw new Error('Waffo is not fully configured. Set WAFFO_MERCHANT_ID, WAFFO_PRIVATE_KEY, WAFFO_PRODUCT_ID and WAFFO_TAX_CATEGORY.');
  }
  return { merchantId, privateKey, productId, taxCategory: getTaxCategory(rawTaxCategory) };
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
  const detail: { country: string; isBusiness: boolean; postcode?: string; state?: string } = {
    country: address.country ?? '',
    isBusiness: false,
  };
  if (address.postal) detail.postcode = address.postal;
  if (address.state) detail.state = address.state;
  return detail;
}

function describeProviderError(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) return { errorType: typeof error, error: String(error) };
  const candidate = error as Error & {
    code?: unknown;
    status?: unknown;
    statusCode?: unknown;
    response?: { status?: unknown; data?: unknown; error?: unknown };
    cause?: unknown;
  };
  const details: Record<string, unknown> = {
    errorType: error.constructor?.name ?? 'Error',
    message: error.message,
  };
  if (candidate.code != null) details.code = candidate.code;
  if (candidate.status != null) details.status = candidate.status;
  if (candidate.statusCode != null) details.statusCode = candidate.statusCode;
  if (candidate.response?.status != null) details.responseStatus = candidate.response.status;
  if (candidate.response?.data != null) details.responseData = candidate.response.data;
  if (candidate.response?.error != null) details.responseError = candidate.response.error;
  if (candidate.cause != null) details.cause = candidate.cause instanceof Error ? candidate.cause.message : candidate.cause;
  return details;
}

interface WaffoWebhookData {
  orderMetadata?: Record<string, unknown> | null;
  orderMerchantExternalId?: unknown;
  orderId?: unknown;
  paymentId?: unknown;
  eventId?: unknown;
  buyerEmail?: unknown;
  total?: unknown;
  amount?: unknown;
  taxAmount?: unknown;
  currency?: unknown;
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : value == null ? null : String(value);
}

export function createWaffoProvider(): PaymentProvider {
  return {
    async createCheckout(params: CreateCheckoutParams): Promise<CheckoutResult> {
      const { productId, taxCategory } = getWaffoConfig();
      const client = createClient();
      const subtotalMinor = params.lineItems.reduce((sum, line) => sum + line.amountCents * line.quantity, 0);
      const fallbackShipping =
        params.selectedShipping == null && params.shipping
          ? params.shipping.options.length === 1
            ? params.shipping.options[0]
            : params.shipping.options.length === 0
              ? null
              : undefined
          : null;
      if (fallbackShipping === undefined) {
        throw new Error('Waffo checkout requires a single shipping rate. Configure one Waffo-compatible rate or use another payment method.');
      }
      const shippingMinor = params.selectedShipping?.amountCents ?? fallbackShipping?.amountCents ?? 0;
      const chargeableMinor = subtotalMinor + shippingMinor;
      const currency = params.lineItems[0]?.currency?.toUpperCase();
      if (!currency) throw new Error('Waffo checkout requires at least one line item currency.');
      if (params.lineItems.some((line) => line.currency.toUpperCase() !== currency)) throw new Error('Waffo checkout cannot mix currencies in one session.');
      if (chargeableMinor <= 0) throw new Error('Waffo checkout amount must be greater than zero.');

      const metadata: Record<string, string> = { ...(params.metadata ?? {}) };
      const reservationId = metadata.reservation_id;
      const selectedShipping = params.selectedShipping ??
        (fallbackShipping
          ? {
              label: fallbackShipping.label,
              amountCents: fallbackShipping.amountCents,
              weightGrams: params.shipping?.shipmentWeightGrams ?? null,
              deliveryMethod: fallbackShipping.pickup ? 'pickup' : 'shipping',
              address: {
                name: null,
                line1: null,
                line2: null,
                city: null,
                state: null,
                postal: null,
                country: params.shipping?.addressCountries[0] ?? null,
              },
              email: null,
            }
          : null);
      if (selectedShipping) {
        metadata.shipping_cents = String(selectedShipping.amountCents);
        metadata.shipping_label = selectedShipping.label.slice(0, 120);
        metadata.shipping_weight_grams = String(selectedShipping.weightGrams ?? '');
        metadata.delivery_method = selectedShipping.deliveryMethod;
        if (selectedShipping.address.line1 || selectedShipping.address.country) metadata.shipping_address = JSON.stringify(selectedShipping.address);
      }

      try {
        const session = await client.checkout.createSession({
          productId,
          currency,
          priceSnapshot: { amount: displayAmount(chargeableMinor, currency), taxCategory },
          buyerEmail: params.selectedShipping?.email ?? undefined,
          billingDetail: selectedShipping?.address.country ? billingDetail(selectedShipping.address) : undefined,
          successUrl: params.successUrl,
          metadata,
          orderMerchantExternalId: reservationId,
          expiresInSeconds: 45 * 60,
        });
        return { url: session.checkoutUrl };
      } catch (error) {
        console.error('Waffo checkout.createSession failed', {
          merchantId: productId ? 'configured' : 'missing',
          productId: productId ? 'configured' : 'missing',
          currency,
          amount: displayAmount(chargeableMinor, currency),
          taxCategory,
          error: describeProviderError(error),
        });
        throw new Error('Waffo checkout creation failed. Check Worker logs for the provider error details.');
      }
    },

    async verifyWebhook(payload: string, headers: Headers): Promise<WebhookResult> {
      const signature = headers.get('x-waffo-signature');
      if (!signature) throw new Error('Missing X-Waffo-Signature header.');
      const event = verifyWebhook(payload, signature);
      const data = event.data as WaffoWebhookData;
      const metadata: Record<string, string> = {};
      if (data.orderMetadata && typeof data.orderMetadata === 'object') {
        for (const [key, value] of Object.entries(data.orderMetadata)) {
          const stringified = stringValue(value);
          if (stringified !== null) metadata[key] = stringified;
        }
      }
      const reservationId = metadata.reservation_id ?? stringValue(data.orderMerchantExternalId) ?? undefined;

      if (event.eventType === 'order.completed') {
        const currency = stringValue(data.currency);
        if (!currency) throw new Error('Waffo webhook did not contain a currency.');
        const amount = Number(data.total ?? data.amount);
        const taxAmount = Number(data.taxAmount ?? '0');
        const decimals = currencyDecimals(currency);
        const shippingCents = Number(metadata.shipping_cents ?? '0');
        if (!Number.isFinite(amount) || amount < 0) throw new Error('Waffo webhook contained an invalid order amount.');
        if (!Number.isFinite(taxAmount) || taxAmount < 0) throw new Error('Waffo webhook contained an invalid tax amount.');
        if (!Number.isInteger(shippingCents) || shippingCents < 0) throw new Error('Waffo webhook contained invalid shipping metadata.');

        let shippingAddress: ShippingAddress | null = null;
        if (metadata.shipping_address) {
          try {
            const parsed = JSON.parse(metadata.shipping_address) as ShippingAddress;
            if (parsed && typeof parsed === 'object') shippingAddress = parsed;
          } catch {
            throw new Error('Waffo webhook contained invalid shipping address metadata.');
          }
        }

        const providerSessionId = stringValue(data.orderId) ?? stringValue(data.eventId);
        if (!providerSessionId) throw new Error('Waffo webhook did not contain an order/session id.');
        const providerPaymentId = stringValue(data.paymentId) ?? stringValue(data.orderId);
        const buyerEmail = stringValue(data.buyerEmail);
        const shippingWeightGrams = metadata.shipping_weight_grams ? Number(metadata.shipping_weight_grams) : null;
        if (shippingWeightGrams !== null && (!Number.isFinite(shippingWeightGrams) || shippingWeightGrams < 0)) throw new Error('Waffo webhook contained invalid shipping weight metadata.');

        const order: PaidOrderInput = {
          providerSessionId,
          publicId: reservationId,
          reservationId,
          email: buyerEmail,
          amountTotalCents: Math.round(amount * 10 ** decimals),
          shippingCents,
          shippingLabel: metadata.shipping_label ?? null,
          shippingWeightGrams,
          deliveryMethod: metadata.delivery_method === 'pickup' || metadata.delivery_method === 'shipping' ? metadata.delivery_method : null,
          shippingAddress,
          taxCents: Math.round(taxAmount * 10 ** decimals),
          currency,
          paymentMethod: 'waffo',
          providerPaymentId,
          items: [],
        };
        return { type: event.eventType, order };
      }
      return { type: event.eventType };
    },
  };
}
