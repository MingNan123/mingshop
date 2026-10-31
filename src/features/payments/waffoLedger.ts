import { currencyDecimals } from '../../money';

export interface MerchantPayment {
  id: string;
  orderId: string;
  externalId: string | null;
  status: string;
  method: string | null;
  currency: string;
  amountMinor: number;
  refundedMinor: number | null;
  orderCurrency: string;
  orderAmountMinor: number;
  createdAt: string;
}

export function minorAmount(value: unknown, currency: string): number {
  const text = String(value ?? '');
  const places = currencyDecimals(currency);
  if (!/^\d+(?:\.\d+)?$/.test(text)) throw new Error('付款金额格式无效');
  const [whole, fractional = ''] = text.split('.');
  if (fractional.slice(places).replace(/0/g, '')) throw new Error('付款金额精度超出币种范围');
  const amount = Number(whole) * 10 ** places + Number(fractional.slice(0, places).padEnd(places, '0'));
  if (!Number.isSafeInteger(amount)) throw new Error('付款金额超出范围');
  return amount;
}

const object = (v: unknown): Record<string, unknown> => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('商户平台返回了无效数据');
  return v as Record<string, unknown>;
};
const text = (v: unknown): string => typeof v === 'string' ? v : '';
function amountDetails(v: unknown): { currency: string; amount: number } {
  const data = object(v);
  const currency = text(data.currency).toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error('商户平台未返回有效币种');
  return { currency, amount: minorAmount(data.amount ?? data.total, currency) };
}

/** Reject test-mode and malformed data rather than counting it as real money. */
export function normalizeMerchantOrder(value: unknown): MerchantPayment[] {
  const order = object(value);
  if (order.testMode === true) return [];
  if (order.testMode !== false) throw new Error('无法确认 Waffo 订单是否为生产付款');
  const orderId = text(order.id);
  if (!orderId.startsWith('ORD_')) throw new Error('Waffo 订单号无效');
  const snapshot = amountDetails(order.priceSnapshot);
  if (!Array.isArray(order.payments)) throw new Error('Waffo 未返回付款列表');
  return order.payments.map((v) => {
    const payment = object(v);
    const id = text(payment.id);
    const status = text(payment.status).toLowerCase();
    if (!id.startsWith('PAY_') || !status) throw new Error('Waffo 付款标识或状态无效');
    const actual = amountDetails(payment.pspAmountDetails ?? payment.snapshotAmountDetails ?? order.priceSnapshot);
    // Never pretend that the quoted order amount was the PSP charge amount.
    if (status === 'succeeded' && !payment.pspAmountDetails) throw new Error('Waffo 未提供渠道实付金额，已停止同步以避免混用币种');
    let refundedMinor: number | null = null;
    if (Array.isArray(payment.refunds)) {
      refundedMinor=0;
      for (const v of payment.refunds) {
        const refund = object(v);
        if (text(refund.status).toLowerCase() !== 'succeeded') continue;
        if (!refund.pspAmountDetails) { refundedMinor = null; break; }
        const actualRefund = amountDetails(refund.pspAmountDetails);
        if (actualRefund.currency !== actual.currency) { refundedMinor = null; break; }
        refundedMinor += actualRefund.amount;
      }
    } else if (['none','not_refunded','no_refund'].includes(text(payment.refundStatus).toLowerCase())) {
      refundedMinor = 0;
    }
    if (refundedMinor !== null && (!Number.isSafeInteger(refundedMinor) || refundedMinor > actual.amount)) {
      throw new Error('Waffo 退款金额与实付金额不一致');
    }
    const date = new Date(text(payment.createdAt));
    if (!Number.isFinite(date.getTime())) throw new Error('Waffo 交易时间无效');
    return {
      id, orderId, externalId: text(order.orderMerchantExternalId) || null,
      status, method: text(payment.paymentMethod) || null,
      currency: actual.currency, amountMinor: actual.amount, refundedMinor,
      orderCurrency: snapshot.currency, orderAmountMinor: snapshot.amount,
      createdAt: date.toISOString(),
    };
  });
}

export interface MatchingOrder {
  id: number;
  public_id: string | null;
  provider_session_id: string | null;
  provider_payment_id: string | null;
  amount_total_cents: number;
  currency: string;
}

export function matchMerchantPayment(payment: MerchantPayment, candidates: MatchingOrder[]) {
  const matches = candidates.filter(o =>
    o.provider_payment_id === payment.id || o.provider_session_id === payment.orderId ||
    (payment.externalId !== null && o.public_id === payment.externalId));
  if (matches.length !== 1) return { orderId: null, status: 'unmatched' };
  const order = matches[0];
  if ((order.provider_payment_id && order.provider_payment_id !== payment.id) ||
      (order.provider_session_id && order.provider_session_id !== payment.orderId)) {
    return { orderId: null, status: 'reference_mismatch' };
  }
  return { orderId: order.id, status:
    order.currency.toUpperCase() === payment.orderCurrency && order.amount_total_cents === payment.orderAmountMinor
      ? 'matched' : 'amount_mismatch' };
}
