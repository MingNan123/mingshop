import type { D1Database } from '@cloudflare/workers-types';

export type StablecoinToken = 'usdc' | 'usdt';
export type StablecoinNetworkKind = 'evm' | 'tron';

export interface StablecoinNetworkProfile {
  id: string;
  token: StablecoinToken;
  label: string;
  kind: StablecoinNetworkKind;
  enabled: boolean;
  receiveAddress: string;
  endpoint: string;
  tokenAddress: string;
  decimals: number;
  confirmations: number;
}

const MAX_PROFILES = 12;
const ID_RE = /^[a-z0-9][a-z0-9_-]{0,47}$/;
const EVM_RE = /^0x[0-9a-fA-F]{40}$/;
const TRON_RE = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeProfile(raw: unknown): StablecoinNetworkProfile | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const id = clean(r.id).toLowerCase();
  const token = r.token === 'usdc' || r.token === 'usdt' ? r.token : null;
  const label = clean(r.label).slice(0, 80);
  const kind = r.kind === 'evm' || r.kind === 'tron' ? r.kind : null;
  const receiveAddress = clean(r.receiveAddress);
  const endpoint = clean(r.endpoint).replace(/\/+$/, '');
  const tokenAddress = clean(r.tokenAddress);
  const decimals = Number(r.decimals ?? 6);
  const confirmations = Number(r.confirmations ?? 12);
  const enabled = r.enabled === true;

  if (!token || !kind || !ID_RE.test(id) || !label) return null;
  if (kind === 'tron' && token !== 'usdt') return null;
  if (!/^https:\/\//i.test(endpoint)) return null;
  if (!Number.isInteger(decimals) || decimals < 2 || decimals > 18) return null;
  if (!Number.isInteger(confirmations) || confirmations < 1 || confirmations > 200) return null;
  if (kind === 'evm' && (!EVM_RE.test(receiveAddress) || !EVM_RE.test(tokenAddress))) return null;
  if (kind === 'tron' && (!TRON_RE.test(receiveAddress) || !TRON_RE.test(tokenAddress))) return null;

  return { id, token, label, kind, enabled, receiveAddress, endpoint, tokenAddress, decimals, confirmations };
}

export function parseStablecoinProfiles(raw: string | null | undefined): StablecoinNetworkProfile[] {
  if (!raw) return [];
  try {
    const value = JSON.parse(raw) as unknown;
    if (!Array.isArray(value)) return [];
    const out: StablecoinNetworkProfile[] = [];
    const ids = new Set<string>();
    for (const item of value.slice(0, MAX_PROFILES)) {
      const profile = normalizeProfile(item);
      if (!profile || ids.has(profile.id)) continue;
      ids.add(profile.id);
      out.push(profile);
    }
    return out;
  } catch {
    return [];
  }
}

export function enabledStablecoinProfiles(
  profiles: StablecoinNetworkProfile[],
  token?: StablecoinToken,
): StablecoinNetworkProfile[] {
  return profiles.filter((p) => p.enabled && (!token || p.token === token));
}

async function readSetting(db: D1Database, key: string): Promise<string | null> {
  const row = await db.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first<{ value: string }>();
  return row?.value ?? null;
}

async function legacyProfiles(db: D1Database): Promise<StablecoinNetworkProfile[]> {
  const rows = await db.prepare(
    `SELECT key, value FROM settings WHERE key IN (
      'usdc_address','usdc_network','stablecoin_usdc_rpc_url','stablecoin_usdc_token_address','stablecoin_usdc_decimals','stablecoin_usdc_confirmations',
      'usdt_address','usdt_network','stablecoin_usdt_mode','stablecoin_usdt_rpc_url','stablecoin_usdt_token_address','stablecoin_usdt_decimals','stablecoin_usdt_confirmations',
      'stablecoin_usdt_tron_base_url','stablecoin_usdt_tron_token_address'
    )`,
  ).all<{ key: string; value: string }>();
  const map = new Map((rows.results ?? []).map((r) => [r.key, r.value]));
  const candidates: unknown[] = [];

  if (map.get('usdc_address') && map.get('stablecoin_usdc_rpc_url') && map.get('stablecoin_usdc_token_address')) {
    candidates.push({
      id: 'usdc-legacy', token: 'usdc', label: map.get('usdc_network') || 'USDC EVM', kind: 'evm', enabled: true,
      receiveAddress: map.get('usdc_address'), endpoint: map.get('stablecoin_usdc_rpc_url'), tokenAddress: map.get('stablecoin_usdc_token_address'),
      decimals: Number(map.get('stablecoin_usdc_decimals') || 6), confirmations: Number(map.get('stablecoin_usdc_confirmations') || 12),
    });
  }

  if (map.get('usdt_address')) {
    if (map.get('stablecoin_usdt_mode') === 'tron') {
      candidates.push({
        id: 'usdt-tron-legacy', token: 'usdt', label: map.get('usdt_network') || 'TRON (TRC-20)', kind: 'tron', enabled: true,
        receiveAddress: map.get('usdt_address'), endpoint: map.get('stablecoin_usdt_tron_base_url') || 'https://api.trongrid.io',
        tokenAddress: map.get('stablecoin_usdt_tron_token_address') || 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
        decimals: Number(map.get('stablecoin_usdt_decimals') || 6), confirmations: 1,
      });
    } else if (map.get('stablecoin_usdt_rpc_url') && map.get('stablecoin_usdt_token_address')) {
      candidates.push({
        id: 'usdt-legacy', token: 'usdt', label: map.get('usdt_network') || 'USDT EVM', kind: 'evm', enabled: true,
        receiveAddress: map.get('usdt_address'), endpoint: map.get('stablecoin_usdt_rpc_url'), tokenAddress: map.get('stablecoin_usdt_token_address'),
        decimals: Number(map.get('stablecoin_usdt_decimals') || 6), confirmations: Number(map.get('stablecoin_usdt_confirmations') || 12),
      });
    }
  }

  return candidates.map(normalizeProfile).filter((p): p is StablecoinNetworkProfile => p !== null);
}

export async function loadStablecoinProfiles(db: D1Database): Promise<StablecoinNetworkProfile[]> {
  const raw = await readSetting(db, 'stablecoin_networks_json');
  if (raw) return parseStablecoinProfiles(raw);
  return legacyProfiles(db);
}

export async function saveStablecoinProfiles(db: D1Database, profiles: StablecoinNetworkProfile[]): Promise<void> {
  const normalized = profiles.map(normalizeProfile).filter((p): p is StablecoinNetworkProfile => p !== null).slice(0, MAX_PROFILES);
  if (normalized.length !== profiles.length) throw new Error('One or more stablecoin network profiles are invalid.');
  const ids = new Set(normalized.map((p) => p.id));
  if (ids.size !== normalized.length) throw new Error('Stablecoin network profile IDs must be unique.');
  await db.prepare(
    `INSERT INTO settings (key,value) VALUES ('stablecoin_networks_json',?)
     ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')`,
  ).bind(JSON.stringify(normalized)).run();
}

export function parseStablecoinSnapshot(raw: string | null | undefined): StablecoinNetworkProfile | null {
  if (!raw) return null;
  try { return normalizeProfile(JSON.parse(raw)); } catch { return null; }
}

export function stablecoinSnapshot(profile: StablecoinNetworkProfile): string {
  return JSON.stringify({ ...profile, enabled: true });
}
