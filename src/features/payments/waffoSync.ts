import { env } from 'cloudflare:workers';
import { createWaffoClient, isWaffoConfigured } from './waffo';
import { normalizeMerchantOrder, type MerchantPayment } from './waffoLedger';
import { storeMerchantPayments } from './waffoLedgerDb';

interface Field {
  name: string;
  args?: {name:string}[];
  type?: {kind:string; name:string|null; ofType?: {kind:string;name:string|null}|null};
}
interface Discovery {
  onetimeProduct: {store:{id:string}} | null;
  payment: {fields:Field[]} | null;
  refund: {fields:Field[]} | null;
  order: {fields:Field[]} | null;
  __schema: {queryType:{fields:Field[]}};
}

function selection(field: Field, children: string) {
  const kind = field.type?.kind === 'NON_NULL' ? field.type.ofType?.kind : field.type?.kind;
  return kind === 'SCALAR' || kind === 'ENUM' ? field.name : `${field.name} { ${children} }`;
}

/** Only read-only signed GraphQL queries; this never creates charges or refunds. */
export async function syncWaffoPayments(): Promise<{synced:number;skipped:boolean}> {
  if (!isWaffoConfigured()) return {synced:0,skipped:true};
  const db = env.DB;
  const lease = crypto.randomUUID();
  const claim = await db.prepare(`UPDATE waffo_sync_state
    SET lease_until=datetime('now','+120 seconds'),lease_token=?
    WHERE id=1 AND (lease_until IS NULL OR lease_until<datetime('now'))
    RETURNING id`).bind(lease).first();
  if (!claim) return {synced:0,skipped:true};
  const deadline = Date.now()+90_000;
  try {
    const client = createWaffoClient();
    const query = async <T>(document: string, variables?: Record<string, unknown>) => {
      if (Date.now()>deadline) throw new Error('同步超时，请稍后重试');
      const response = await client.graphql.query<T>({query:document,variables});
      if (response.errors?.length || !response.data) {
        throw new Error(response.errors?.map(e=>e.message).join('; ') || 'Waffo 未返回数据');
      }
      return response.data;
    };
    // The configured product determines the store, preventing cross-store totals
    // when the merchant key has access to several stores. Discover optional
    // fields from the live schema instead of assuming SDK REST shapes are GraphQL.
    const schema = await query<Discovery>(`query($product:String!) {
      onetimeProduct(id:$product) { store { id } }
      payment:__type(name:"Payment") {fields {name type {kind name ofType {kind name}}}}
      refund:__type(name:"Refund") {fields {name type {kind name ofType {kind name}}}}
      order:__type(name:"OnetimeOrder") {fields {name}}
      __schema {queryType {fields {name args {name}}}}
    }`,{product:env.WAFFO_PRODUCT_ID});
    const storeId = schema.onetimeProduct?.store.id;
    if (!storeId) throw new Error('无法找到已配置商品所属的 Waffo 店铺');
    const paymentFields = new Map(schema.payment?.fields.map(f=>[f.name,f]));
    const psp = paymentFields.get('pspAmountDetails');
    if (!psp) throw new Error('Waffo API 未提供渠道实付金额字段，请核对商户 API 权限');
    const root = schema.__schema.queryType.fields.find(f=>f.name==='onetimeOrders');
    if (!root?.args?.some(a=>a.name==='offset') || !root.args.some(a=>a.name==='limit')) {
      throw new Error('Waffo API 分页结构已变化，暂未更新交易数据');
    }
    const fields = ['id','status','createdAt',selection(psp,'amount currency')];
    for (const name of ['paymentMethod','refundStatus']) {
      const field=paymentFields.get(name);
      if (field && ['SCALAR','ENUM'].includes(field.type?.ofType?.kind ?? field.type?.kind ?? '')) fields.push(name);
    }
    const refundFields = new Map(schema.refund?.fields.map(f=>[f.name,f]));
    const refundPsp=refundFields.get('pspAmountDetails');
    if (paymentFields.has('refunds') && refundPsp) {
      fields.push(`refunds { status ${selection(refundPsp,'amount currency')} }`);
    }
    const external = schema.order?.fields.some(f=>f.name==='orderMerchantExternalId') ? 'orderMerchantExternalId' : '';
    const document = `query($store:String!,$limit:Int!,$offset:Int!) {
      onetimeOrdersCount(storeId:$store)
      onetimeOrders(storeId:$store,limit:$limit,offset:$offset) {
        id testMode ${external} priceSnapshot {currency total}
        payments { ${fields.join(' ')} }
      }
    }`;
    const payments: MerchantPayment[]=[];
    const seenOrders=new Set<string>();
    let complete=false;
    for (let offset=0;offset<500;offset+=50) {
      const page=await query<{onetimeOrdersCount:number;onetimeOrders:unknown[]}>(document,{store:storeId,limit:50,offset});
      if (!Array.isArray(page.onetimeOrders) || !Number.isSafeInteger(page.onetimeOrdersCount)) throw new Error('Waffo 分页结果无效');
      for (const order of page.onetimeOrders) {
        const id=(order as {id?:string}).id;
        if (!id || seenOrders.has(id)) throw new Error('商户订单在分页期间发生变化，请重新同步');
        seenOrders.add(id);
        payments.push(...normalizeMerchantOrder(order));
      }
      if (seenOrders.size>=page.onetimeOrdersCount) { complete=true;break; }
      if (!page.onetimeOrders.length) break;
    }
    if (!complete) throw new Error('本次未读取完整付款记录，已保留上次数据');
    if (new Set(payments.map(p=>p.id)).size!==payments.length) throw new Error('Waffo 返回了重复付款记录');
    await storeMerchantPayments(db,storeId,payments);
    await db.prepare(`UPDATE waffo_sync_state SET last_success_at=datetime('now'),last_error=NULL,
      store_id=?,payment_count=?,lease_until=NULL,lease_token=NULL WHERE id=1 AND lease_token=?`).bind(storeId,payments.length,lease).run();
    return {synced:payments.length,skipped:false};
  } catch (error) {
    const message=error instanceof Error ? error.message.slice(0,600) : '商户交易同步失败';
    await db.prepare(`UPDATE waffo_sync_state SET last_error=?,lease_until=NULL,lease_token=NULL
      WHERE id=1 AND lease_token=?`).bind(message,lease).run();
    throw error;
  }
}
