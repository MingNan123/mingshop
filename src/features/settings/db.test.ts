import { describe, it, expect } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';
import { getStoreSettings, parseStoreSettings } from './db';

/** Minimal stand-in for the single `SELECT key, value FROM settings` read. */
function fakeDb(rows: Array<{ key: string; value: string }>): D1Database {
  return {
    prepare: () => ({
      all: async () => ({ results: rows }),
    }),
  } as unknown as D1Database;
}

describe('getStoreSettings — logo', () => {
  it('is null when unset, so the header falls back to the text store name', async () => {
    const settings = await getStoreSettings(fakeDb([]));
    expect(settings.logoImageKey).toBeNull();
  });

  it('returns the stored object key', async () => {
    const settings = await getStoreSettings(
      fakeDb([{ key: 'logo_image_key', value: 'media/logo.webp' }]),
    );
    expect(settings.logoImageKey).toBe('media/logo.webp');
  });

  it('reads legacy product-prefixed keys too, since any media item can be the logo', async () => {
    const settings = await getStoreSettings(
      fakeDb([{ key: 'logo_image_key', value: 'products/old-mark.png' }]),
    );
    expect(settings.logoImageKey).toBe('products/old-mark.png');
  });

  it('does not disturb the other overlay settings', async () => {
    const settings = await getStoreSettings(
      fakeDb([
        { key: 'logo_image_key', value: 'media/logo.webp' },
        { key: 'store_name', value: 'Test Shop' },
        { key: 'cart_enabled', value: '0' },
      ]),
    );
    expect(settings.storeName).toBe('Test Shop');
    expect(settings.cartEnabled).toBe(false);
    expect(settings.logoImageKey).toBe('media/logo.webp');
  });
});

describe('parseStoreSettings — stablecoin checkout policy', () => {
  it('keeps legacy direct-payment settings readable for historical records', () => {
    const settings = parseStoreSettings([
      { key: 'payment_provider', value: 'usdc' },
      { key: 'alipay_payment_url', value: 'https://qr.alipay.com/example' },
      { key: 'wechatpay_payment_url', value: 'weixin://wxpay/example' },
      { key: 'usdc_address', value: '0x1111111111111111111111111111111111111111' },
      { key: 'usdc_network', value: 'Polygon' },
    ]);

    expect(settings.paymentProvider).toBe('usdc');
    expect(settings.alipayPaymentUrl).toBe('https://qr.alipay.com/example');
    expect(settings.wechatpayPaymentUrl).toBe('weixin://wxpay/example');
    expect(settings.usdcAddress).toBe('0x1111111111111111111111111111111111111111');
    expect(settings.usdcNetwork).toBe('Polygon');
  });

  it('normalizes legacy default providers to USDT and preserves stablecoin defaults', () => {
    expect(parseStoreSettings([{ key: 'payment_provider', value: 'alipay' }]).paymentProvider).toBe('usdt');
    expect(parseStoreSettings([{ key: 'payment_provider', value: 'wechatpay' }]).paymentProvider).toBe('usdt');
    expect(parseStoreSettings([{ key: 'payment_provider', value: 'stripe' }]).paymentProvider).toBe('usdt');
    expect(parseStoreSettings([{ key: 'payment_provider', value: 'usdt' }]).paymentProvider).toBe('usdt');
    expect(parseStoreSettings([{ key: 'payment_provider', value: 'usdc' }]).paymentProvider).toBe('usdc');
  });
});
