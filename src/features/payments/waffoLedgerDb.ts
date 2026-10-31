import type { D1Database } from '@cloudflare/workers-types';
import { matchMerchantPayment, type MatchingOrder, type MerchantPayment } from './waffoLedger';

export interface LedgerRow {
  payment_id: string; provider_order_id: string; external_id: string | null;
  status: string; payment_method: string | null; currency: string; amount_minor: number;
  refunded_minor: number | null; order_currency: string; order_amount_minor: number;
  local_order_id: number | null; local_public_id: string | null; match_status: string; paid_at: string;
}
export interface LedgerTotal {
  currency: string; payments: number; amount_minor: number; refunded_minor: number;
  unknown_refunds: number; unmatched: number;
}
export interface SyncState {
  last_success_at: string | null; last_error: string | null; lease_until: string | null; payment_count: number;
}

export async function storeMerchantPayments(db: D1Database, storeId: string, payments: MerchantPayment[]) {
  const { results } = await db.prepare(`SELECT id,public_id,provider_session_id,provider_payment_id,
    amount_total_cents,currency FROM orders WHERE payment_method='waffo'`).all<MatchingOrder>();
  if (payments.length) {
    // D1 batches are transactional: a rejected row must not publish a partial
    // financial refresh while the dashboard still labels the old sync current.
    await db.batch(payments.map(p => {
      const match = matchMerchantPayment(p, results ?? []);
      return db.prepare(`INSERT INTO waffo_payment_ledger
        (payment_id,store_id,provider_order_id,external_id,status,payment_method,currency,amount_minor,
         refunded_minor,order_currency,order_amount_minor,local_order_id,match_status,paid_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(payment_id) DO UPDATE SET
          status=excluded.status,payment_method=excluded.payment_method,currency=excluded.currency,
          amount_minor=excluded.amount_minor,refunded_minor=excluded.refunded_minor,
          order_currency=excluded.order_currency,order_amount_minor=excluded.order_amount_minor,
          local_order_id=excluded.local_order_id,match_status=excluded.match_status,
          external_id=excluded.external_id,synced_at=datetime('now')
        WHERE waffo_payment_ledger.store_id=excluded.store_id
          AND waffo_payment_ledger.provider_order_id=excluded.provider_order_id`)
        .bind(p.id,storeId,p.orderId,p.externalId,p.status,p.method,p.currency,p.amountMinor,
          p.refundedMinor,p.orderCurrency,p.orderAmountMinor,match.orderId,match.status,p.createdAt);
    }));
  }
}

export async function merchantLedgerSummary(db: D1Database) {
  const [totals, state] = await Promise.all([
    db.prepare(`SELECT currency,COUNT(*) AS payments,SUM(amount_minor) AS amount_minor,
      SUM(COALESCE(refunded_minor,0)) AS refunded_minor,
      SUM(CASE WHEN refunded_minor IS NULL THEN 1 ELSE 0 END) AS unknown_refunds,
      SUM(CASE WHEN match_status!='matched' THEN 1 ELSE 0 END) AS unmatched
      FROM waffo_payment_ledger WHERE status='succeeded'
        AND store_id=(SELECT store_id FROM waffo_sync_state WHERE id=1)
      GROUP BY currency ORDER BY currency`).all<LedgerTotal>(),
    db.prepare('SELECT * FROM waffo_sync_state WHERE id=1').first<SyncState>(),
  ]);
  return { totals: totals.results ?? [], state };
}

export async function countMerchantPayments(db:D1Database,successfulOnly=false) {
  const row=await db.prepare(`SELECT COUNT(*) AS n FROM waffo_payment_ledger
    WHERE store_id=(SELECT store_id FROM waffo_sync_state WHERE id=1)
      AND (?=0 OR status='succeeded')`).bind(successfulOnly?1:0).first<{n:number}>();
  return row?.n??0;
}

export async function listMerchantPayments(db: D1Database, limit=50, offset=0,successfulOnly=false) {
  const [rows, count] = await Promise.all([
    db.prepare(`SELECT p.*,o.public_id AS local_public_id FROM waffo_payment_ledger p
      LEFT JOIN orders o ON o.id=p.local_order_id
      WHERE p.store_id=(SELECT store_id FROM waffo_sync_state WHERE id=1)
        AND (?=0 OR p.status='succeeded')
      ORDER BY p.paid_at DESC,p.payment_id LIMIT ? OFFSET ?`)
      .bind(successfulOnly?1:0,limit,offset).all<LedgerRow>(),
    countMerchantPayments(db,successfulOnly),
  ]);
  return { rows: rows.results ?? [], count };
}

export async function merchantPaymentsForOrders(db:D1Database, ids:number[]) {
  if (!ids.length) return new Map<number,LedgerRow[]>();
  const {results}=await db.prepare(`SELECT *,NULL AS local_public_id FROM waffo_payment_ledger
    WHERE status='succeeded' AND store_id=(SELECT store_id FROM waffo_sync_state WHERE id=1)
      AND local_order_id IN (${ids.map(()=>'?').join(',')})`).bind(...ids).all<LedgerRow>();
  const grouped=new Map<number,LedgerRow[]>();
  for (const row of results??[]) {
    if (row.local_order_id===null) continue;
    const entries=grouped.get(row.local_order_id)??[];
    entries.push(row);grouped.set(row.local_order_id,entries);
  }
  return grouped;
}
