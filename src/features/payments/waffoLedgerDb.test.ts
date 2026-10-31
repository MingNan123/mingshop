import {it,expect} from 'vitest';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import type {D1Database} from '@cloudflare/workers-types';
import {storeMerchantPayments,merchantLedgerSummary,listMerchantPayments} from './waffoLedgerDb';
import type {MerchantPayment} from './waffoLedger';
import {orderStats,dailyOrderTotals} from '../orders/db';
import {liveOrderFilter} from '../orders/live';

it('mirrors payments idempotently, scopes the store, and excludes failed/test sales from financial totals',async()=>{
  const sql=new DatabaseSync(':memory:');
  sql.exec(`CREATE TABLE orders(id INTEGER PRIMARY KEY,public_id TEXT,payment_method TEXT,
    provider_session_id TEXT,provider_payment_id TEXT,amount_total_cents INTEGER,
    currency TEXT,refunded_cents INTEGER,status TEXT,created_at TEXT);
    INSERT INTO orders VALUES(1,'ord_real','waffo','ORD_real','PAY_real',500,'USD',0,'paid',datetime('now'));
    INSERT INTO orders VALUES(2,'ord_demo','demo','demo_example',NULL,100000,'USD',0,'paid',datetime('now'));`);
  sql.exec(readFileSync(new URL('../../../migrations/0046_waffo_payment_ledger.sql',import.meta.url),'utf8'));
  const prepared=(query:string,args:(string|number|null)[]=[])=>({
    bind(...bound:(string|number|null)[]) {return prepared(query,bound);},
    async first(){return sql.prepare(query).get(...args)??null;},
    async all(){return {results:sql.prepare(query).all(...args)};},
    async run(){const result=sql.prepare(query).run(...args);return {meta:{changes:Number(result.changes)}};},
  });
  const db={prepare:prepared,async batch(statements:ReturnType<typeof prepared>[]) {
    sql.exec('BEGIN');
    try {const result=await Promise.all(statements.map(s=>s.run()));sql.exec('COMMIT');return result;}
    catch(error){sql.exec('ROLLBACK');throw error;}
  }} as unknown as D1Database;
  const payment:MerchantPayment={id:'PAY_real',orderId:'ORD_real',externalId:'ord_real',status:'succeeded',
    method:'wechatpay',currency:'CNY',amountMinor:3328,refundedMinor:0,orderCurrency:'USD',
    orderAmountMinor:500,createdAt:'2026-10-01T00:00:00Z'};
  try {
    await storeMerchantPayments(db,'store_a',[payment,{...payment,id:'PAY_failed',status:'failed'}]);
    await storeMerchantPayments(db,'store_a',[{...payment,refundedMinor:100}]);
    await storeMerchantPayments(db,'store_b',[{...payment,id:'PAY_other',orderId:'ORD_other',externalId:null}]);
    sql.exec("UPDATE waffo_sync_state SET store_id='store_a',last_success_at=datetime('now')");
    const summary=await merchantLedgerSummary(db);
    expect(summary.totals).toEqual([{currency:'CNY',payments:1,amount_minor:3328,refunded_minor:100,unknown_refunds:0,unmatched:0}]);
    const listed=await listMerchantPayments(db);
    expect(listed.count).toBe(2);
    expect((await listMerchantPayments(db,50,0,true)).count).toBe(1);
    expect(listed.rows.find(r=>r.payment_id==='PAY_real')).toMatchObject({local_order_id:1,match_status:'matched'});
    await expect(storeMerchantPayments(db,'store_a',[
      {...payment,refundedMinor:200}, {...payment,id:'PAY_invalid',amountMinor:-1},
    ])).rejects.toThrow();
    expect((await merchantLedgerSummary(db)).totals[0].refunded_minor).toBe(100);
    const filter=liveOrderFilter({where:'',params:[]});
    expect(await orderStats(db,filter)).toEqual({count:1,revenue_cents:500,refunded_cents:0});
    expect((await dailyOrderTotals(db,1,filter))[0]).toMatchObject({orders:1,total_cents:500});
  } finally {sql.close();}
});
