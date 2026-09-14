import { describe, expect, it } from 'vitest';
import { buyerRequirements, parseBuyerDetails } from './buyer';

const all = { email: true, name: true, virtualRegion: true };

describe('parseBuyerDetails', () => {
  it('normalizes required buyer fields', () => {
    expect(parseBuyerDetails({ email: ' buyer@example.com ', name: ' Ming ', virtual_region: ' Hong Kong ' }, all))
      .toEqual({ email: 'buyer@example.com', name: 'Ming', virtualRegion: 'Hong Kong' });
  });

  it.each([
    { email: '', name: 'Ming', virtual_region: 'Hong Kong' },
    { email: 'invalid', name: 'Ming', virtual_region: 'Hong Kong' },
    { email: 'buyer@example.com', name: '', virtual_region: 'Hong Kong' },
    { email: 'buyer@example.com', name: 'Ming', virtual_region: '' },
  ])('rejects incomplete details', (value) => {
    expect(parseBuyerDetails(value, all)).toBeNull();
  });

  it('ignores fields the product does not request', () => {
    expect(parseBuyerDetails({}, { email: false, name: false, virtualRegion: false }))
      .toEqual({ email: null, name: null, virtualRegion: null });
  });

  it('combines requirements across cart products', () => {
    expect(buyerRequirements([
      { collect_email: 1, collect_name: 0, collect_virtual_region: 0 },
      { collect_email: 0, collect_name: 1, collect_virtual_region: 1 },
    ])).toEqual(all);
  });
});
