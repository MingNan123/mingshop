import { describe, expect, it } from 'vitest';
import { clientControlledPriceFields, hasClientControlledPriceFields } from './priceGuard';

describe('checkout price guard', () => {
  it('rejects fields a buyer could use to try to set the payable amount', () => {
    expect(clientControlledPriceFields({
      product_id: 'prod_abc',
      quantity: 1,
      price_cents: 1,
      amount: '0.01',
      currency: 'usd',
    })).toEqual(['price_cents', 'amount', 'currency']);
  });

  it('allows selector-only checkout input', () => {
    expect(hasClientControlledPriceFields({
      product_id: 'prod_abc',
      quantity: 1,
      variant_id: 'var_abc',
      extra_ids: ['xtra_abc'],
    })).toBe(false);
  });
});
