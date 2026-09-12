import { describe, expect, it } from 'vitest';
import {
  enabledMethods,
  offeredMethods,
  isMethodAvailable,
  isNewCheckoutPaymentMethod,
  isWebhookPaymentMethod,
  webhookMethods,
} from './index';
import { parseStoreSettings } from '../settings/db';

const usdcProfile = {
  id: 'usdc-base', token: 'usdc', label: 'Base', kind: 'evm', enabled: true,
  receiveAddress: '0x1111111111111111111111111111111111111111',
  endpoint: 'https://base-rpc.example',
  tokenAddress: '0x2222222222222222222222222222222222222222',
  decimals: 6, confirmations: 12,
};
const usdtProfile = {
  id: 'usdt-evm', token: 'usdt', label: 'USDT EVM', kind: 'evm', enabled: true,
  receiveAddress: '0x3333333333333333333333333333333333333333',
  endpoint: 'https://evm-rpc.example',
  tokenAddress: '0x4444444444444444444444444444444444444444',
  decimals: 6, confirmations: 12,
};

describe('payment methods', () => {
  it('offers Waffo and the direct stablecoin setup entries', () => {
    const settings = parseStoreSettings([]);
    expect(offeredMethods(settings)).toEqual(['waffo', 'usdt', 'usdc']);
  });

  it('does not accept legacy payment rails even when their old settings still exist', () => {
    const settings = parseStoreSettings([
      { key: 'alipay_payment_url', value: 'https://qr.alipay.com/example' },
      { key: 'wechatpay_payment_url', value: 'weixin://wxpay/example' },
      { key: 'enc:stripe_secret_key', value: 'ciphertext' },
      { key: 'enc:stripe_webhook_secret', value: 'ciphertext' },
    ]);
    expect(isMethodAvailable('alipay', settings)).toBe(false);
    expect(isMethodAvailable('wechatpay', settings)).toBe(false);
    expect(isMethodAvailable('stripe', settings)).toBe(false);
  });

  it('allows every active rail through browser checkout and rejects retired rails', () => {
    for (const method of ['waffo', 'usdt', 'usdc']) {
      expect(isNewCheckoutPaymentMethod(method)).toBe(true);
    }
    for (const method of ['stripe', 'lightning', 'opennode', 'alipay', 'wechatpay', 'demo', 'unknown']) {
      expect(isNewCheckoutPaymentMethod(method)).toBe(false);
    }
  });

  it('keeps all signed webhook rails routable', () => {
    expect(webhookMethods()).toEqual(['stripe', 'waffo', 'lightning', 'opennode']);
    for (const method of ['stripe', 'waffo', 'lightning', 'opennode']) {
      expect(isWebhookPaymentMethod(method)).toBe(true);
    }
    expect(isWebhookPaymentMethod('usdt')).toBe(false);
    expect(isWebhookPaymentMethod('usdc')).toBe(false);
    expect(isWebhookPaymentMethod('demo')).toBe(false);
  });

  it('enables a coin when the merchant has an enabled validated network profile', () => {
    const settings = parseStoreSettings([
      { key: 'stablecoin_networks_json', value: JSON.stringify([usdcProfile, usdtProfile]) },
    ]);
    expect(isMethodAvailable('usdc', settings)).toBe(true);
    expect(isMethodAvailable('usdt', settings)).toBe(true);
    expect(enabledMethods(settings)).toEqual(['usdt', 'usdc']);
  });

  it('keeps a coin unavailable when its only profile is disabled', () => {
    const settings = parseStoreSettings([
      { key: 'stablecoin_networks_json', value: JSON.stringify([{ ...usdcProfile, enabled: false }]) },
    ]);
    expect(isMethodAvailable('usdc', settings)).toBe(false);
    expect(enabledMethods(settings)).toEqual([]);
  });
});
