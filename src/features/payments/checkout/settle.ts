import { env } from 'cloudflare:workers';
import {
  markPendingSettled,
  pendingToPaidOrder,
  type PendingPayment,
} from '../lightning/pending';
import { getLightningBackend } from '../lightning';
import { getOrderByProviderSessionId, recordPaidOrder } from '../../orders/db';
import { recordPaidWebhookOrder } from '../../orders/recordWebhook';
import { resolveRequiredOrderEmail } from '../../email/orderPolicy';
import { deliverOrderNotifications } from '../../email/outbox';
import type { StoreSettings } from '../../settings/db';
import { purgeStockProductCache } from '../../cache/purge';

export interface PaymentSettleResult {
  settled?: boolean;
  declined?: string | null;
}

export async function settleDemoCheckout(): Promise<PaymentSettleResult> {
  return { declined: 'Demo checkout has been removed.' };
}

/** Manual confirmation is intentionally limited to Alipay/WeChat.
 * USDC/USDT may only settle from verified chain data in stablecoin-watcher.ts. */
export async function settleManualWalletCheckout(
  pending: PendingPayment,
  form: FormData,
  origin: string,
  settings?: StoreSettings,
  waitUntil?: (promise: Promise<unknown>) => void,
): Promise<PaymentSettleResult> {
  if (pending.expires_at != null && Date.parse(pending.expires_at) <= Date.now()) {
    return { declined: 'This payment request has expired.' };
  }
  if (!['alipay', 'wechatpay'].includes(pending.backend)) {
    return { declined: 'This payment method requires automatic verification.' };
  }
  const email = resolveRequiredOrderEmail(String(form.get('email') ?? ''), pending.email);
  if (!email) return { declined: 'A valid email is required.' };
  const proof = String(form.get('proof') ?? '').trim().slice(0, 200);
  if (!proof) return { declined: 'Enter the payment reference.' };
  const order = { ...pendingToPaidOrder(pending), email, providerPaymentId: proof };
  await recordPaidWebhookOrder(
    { type: `${pending.backend}.confirmed`, order }, origin, pending.backend, settings, waitUntil,
  );
  return { settled: true };
}

export async function settleLightningOnLoad(
  pending: PendingPayment,
  origin: string,
  settings?: StoreSettings,
  waitUntil?: (promise: Promise<unknown>) => void,
): Promise<boolean> {
  let paid = false;
  try { const status = await (await getLightningBackend()).getIncoming(pending.payment_hash); paid = status.paid; } catch {}
  if (!paid) return false;
  const order = pendingToPaidOrder(pending);
  const orderId = await recordPaidOrder(env.DB, order, purgeStockProductCache);
  let settledOrderId = orderId;
  if (!orderId) {
    const existing = await getOrderByProviderSessionId(env.DB, order.providerSessionId);
    if (!existing) throw new Error(`Inventory reservation ${pending.public_id} is no longer active.`);
    settledOrderId = existing.id;
    await markPendingSettled(env.DB, pending.payment_hash);
  }
  const deliver = () => deliverOrderNotifications(env.DB, settledOrderId!, origin, settings);
  if (waitUntil) waitUntil(deliver().catch((err) => console.error('Notification delivery failed:', err)));
  else await deliver();
  return true;
}
