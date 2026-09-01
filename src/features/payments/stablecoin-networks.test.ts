import { describe, expect, it } from 'vitest';
import {
  enabledStablecoinProfiles,
  parseStablecoinProfiles,
  parseStablecoinSnapshot,
  stablecoinSnapshot,
} from './stablecoin-networks';

const base = {
  id: 'usdc-base', token: 'usdc', label: 'Base', kind: 'evm', enabled: true,
  receiveAddress: '0x1111111111111111111111111111111111111111',
  endpoint: 'https://base-rpc.example',
  tokenAddress: '0x2222222222222222222222222222222222222222',
  decimals: 6, confirmations: 12,
} as const;

const tron = {
  id: 'usdt-tron', token: 'usdt', label: 'TRON (TRC-20)', kind: 'tron', enabled: true,
  receiveAddress: 'TJRabPrwbZy45sbavfcjinPJC18kjpRTv8',
  endpoint: 'https://api.trongrid.io',
  tokenAddress: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
  decimals: 6, confirmations: 1,
} as const;

describe('stablecoin network profiles', () => {
  it('keeps multiple merchant-enabled networks and filters them by token', () => {
    const profiles = parseStablecoinProfiles(JSON.stringify([base, tron]));
    expect(profiles).toHaveLength(2);
    expect(enabledStablecoinProfiles(profiles, 'usdc').map((p) => p.id)).toEqual(['usdc-base']);
    expect(enabledStablecoinProfiles(profiles, 'usdt').map((p) => p.id)).toEqual(['usdt-tron']);
  });

  it('does not allow TRON as a USDC adapter', () => {
    const profiles = parseStablecoinProfiles(JSON.stringify([{ ...tron, token: 'usdc' }]));
    expect(profiles).toEqual([]);
  });

  it('round-trips an order snapshot independently from later merchant edits', () => {
    const snapshot = stablecoinSnapshot(base);
    const selected = parseStablecoinSnapshot(snapshot);
    expect(selected?.label).toBe('Base');
    expect(selected?.receiveAddress).toBe(base.receiveAddress);
    expect(selected?.tokenAddress).toBe(base.tokenAddress);
  });

  it('rejects invalid endpoints and addresses instead of exposing them to buyers', () => {
    expect(parseStablecoinProfiles(JSON.stringify([{ ...base, endpoint: 'http://unsafe.example' }]))).toEqual([]);
    expect(parseStablecoinProfiles(JSON.stringify([{ ...base, receiveAddress: '0x1234' }]))).toEqual([]);
  });
});
