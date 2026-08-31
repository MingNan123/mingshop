import { describe, expect, it } from 'vitest';
import { enabledMethods, offeredMethods, isMethodAvailable } from './index';
import { parseStoreSettings } from '../settings/db';

describe('direct wallet payment methods', () => {
  it('offers direct wallet setup entries even before they are configured', () => {
    const settings = parseStoreSettings([]);

    expect(offeredMethods(settings)).toEqual([
      'stripe',
      'waffo',
      'lightning',
      'alipay',
      'wechatpay',
      'usdc',
      'usdt',
    ]);
  });

  it('does not enable stablecoins from an address and network alone', () => {
    const settings = parseStoreSettings([
      { key: 'usdc_address', value: '0x1111111111111111111111111111111111111111' },
      { key: 'usdc_network', value: 'Base' },
    ]);

    expect(isMethodAvailable('usdc', settings)).toBe(false);
  });

  it('enables direct wallets after their required admin settings are saved', () => {
    const settings = parseStoreSettings([
      { key: 'alipay_payment_url', value: 'https://qr.alipay.com/example' },
      { key: 'wechatpay_payment_url', value: 'weixin://wxpay/example' },
      { key: 'usdc_address', value: '0x1111111111111111111111111111111111111111' },
      { key: 'usdc_network', value: 'Base' },
      { key: 'stablecoin_usdc_rpc_url', value: 'https://base-rpc.example' },
      { key: 'stablecoin_usdc_token_address', value: '0x2222222222222222222222222222222222222222' },
    ]);

    expect(isMethodAvailable('alipay', settings)).toBe(true);
    expect(isMethodAvailable('wechatpay', settings)).toBe(true);
    expect(isMethodAvailable('usdc', settings)).toBe(true);
    expect(enabledMethods(settings)).toEqual(['alipay', 'wechatpay', 'usdc']);
  });
});
