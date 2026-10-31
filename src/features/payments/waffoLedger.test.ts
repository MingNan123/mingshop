import {describe,it,expect} from 'vitest';
import {normalizeMerchantOrder,minorAmount,matchMerchantPayment} from './waffoLedger';

const order=()=>({id:'ORD_example',testMode:false,orderMerchantExternalId:'ord_example',
  priceSnapshot:{currency:'USD',total:'5.00'},payments:[{
    id:'PAY_example',status:'succeeded',createdAt:'2026-10-01T01:02:03Z',
    pspAmountDetails:{currency:'CNY',amount:'33.28'},refunds:[],
  }]});

describe('Waffo production payment normalization',()=>{
  it('keeps USD order pricing separate from the exact CNY payment',()=>{
    const [payment]=normalizeMerchantOrder(order());
    expect(payment).toMatchObject({currency:'CNY',amountMinor:3328,orderCurrency:'USD',orderAmountMinor:500,refundedMinor:0});
  });
  it('excludes test payments and refuses an unknown environment',()=>{
    expect(normalizeMerchantOrder({...order(),testMode:true})).toEqual([]);
    expect(()=>normalizeMerchantOrder({...order(),testMode:undefined})).toThrow('生产');
  });
  it('refuses to claim the USD quote was the PSP charge',()=>{
    const value=order();
    delete (value.payments[0] as {pspAmountDetails?:unknown}).pspAmountDetails;
    expect(()=>normalizeMerchantOrder(value)).toThrow('实付');
  });
  it('uses exact decimal arithmetic and validates precision',()=>{
    expect(minorAmount('1.01','USD')).toBe(101);
    expect(minorAmount('5','JPY')).toBe(5);
    expect(minorAmount('0.123','BHD')).toBe(123);
    for (const value of ['-1','NaN','1e3','1.001','9007199254740991']) expect(()=>minorAmount(value,'USD')).toThrow();
  });
  it('does not present unknown refund amounts as zero',()=>{
    const value=order();
    delete (value.payments[0] as {refunds?:unknown}).refunds;
    expect(normalizeMerchantOrder(value)[0].refundedMinor).toBeNull();
  });
  it('counts only successful refunds in the matching PSP currency',()=>{
    const value=order();
    Object.assign(value.payments[0],{refunds:[
      {status:'succeeded',pspAmountDetails:{currency:'CNY',amount:'10.00'}},
      {status:'pending',pspAmountDetails:{currency:'CNY',amount:'20.00'}},
    ]});
    expect(normalizeMerchantOrder(value)[0].refundedMinor).toBe(1000);
    Object.assign(value.payments[0],{refunds:[{status:'succeeded',pspAmountDetails:{currency:'USD',amount:'1.00'}}]});
    expect(normalizeMerchantOrder(value)[0].refundedMinor).toBeNull();
  });
});

describe('Waffo order reconciliation',()=>{
  const local=()=>({id:1,public_id:'ord_example',provider_session_id:'ORD_example',provider_payment_id:'PAY_example',amount_total_cents:500,currency:'usd'});
  it('matches provider IDs and compares the original order currency',()=>{
    expect(matchMerchantPayment(normalizeMerchantOrder(order())[0],[local()])).toEqual({orderId:1,status:'matched'});
  });
  it('flags original-currency amount disagreements without rewriting the order',()=>{
    expect(matchMerchantPayment(normalizeMerchantOrder(order())[0],[{...local(),amount_total_cents:600}]).status).toBe('amount_mismatch');
  });
  it('never trusts a conflicting business reference or ambiguous candidate',()=>{
    const payment=normalizeMerchantOrder(order())[0];
    expect(matchMerchantPayment(payment,[{...local(),provider_payment_id:'PAY_other'}])).toEqual({orderId:null,status:'reference_mismatch'});
    expect(matchMerchantPayment(payment,[local(),{...local(),id:2}]).status).toBe('unmatched');
  });
});
