import { describe, expect, it } from 'vitest';
import { parseBuyerDetails } from './buyer';

describe('parseBuyerDetails', () => {
  it('normalizes required buyer fields', () => {
    expect(parseBuyerDetails({ email: ' buyer@example.com ', name: ' Ming ', virtual_region: ' Hong Kong ' }))
      .toEqual({ email: 'buyer@example.com', name: 'Ming', virtualRegion: 'Hong Kong' });
  });

  it.each([
    { email: '', name: 'Ming', virtual_region: 'Hong Kong' },
    { email: 'invalid', name: 'Ming', virtual_region: 'Hong Kong' },
    { email: 'buyer@example.com', name: '', virtual_region: 'Hong Kong' },
    { email: 'buyer@example.com', name: 'Ming', virtual_region: '' },
  ])('rejects incomplete details', (value) => {
    expect(parseBuyerDetails(value)).toBeNull();
  });
});
