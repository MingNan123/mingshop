import type { D1Database } from '@cloudflare/workers-types';
import { pendingToPaidOrder, type PendingPayment } from './lightning/pending';
import { recordPaidWebhookOrder } from '../orders/recordWebhook';
import { getStoreSettings } from '../settings/db';
import { getSecret } from '../secrets/store';

export type StablecoinMethod = 'usdc' | 'usdt';

const TRANSFER_TOPIC =
  '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const INITIAL_LOOKBACK_BLOCKS = 2_000n;
const MAX_BLOCK_SPAN = 1_000n;
const TRON_CURSOR_OVERLAP_MS = 30 * 60 * 1000;
const TRON_MAX_PAGES_PER_SWEEP = 20;

type RpcLog = {
  transactionHash: string;
  blockNumber: string;
  data: string;
  topics: string[];
  removed?: boolean;
};
type RpcBlock = { timestamp: string };
type EvmWatchConfig = {
  method: StablecoinMethod;
  rpcUrl: string;
  tokenAddress: string;
  receiveAddress: string;
  decimals: number;
  confirmations: number;
};
type TronWatchConfig = {
  baseUrl: string;
  tokenAddress: string;
  receiveAddress: string;
  decimals: number;
  apiKey: string | null;
};
type TronTrc20Transfer = {
  transaction_id?: string;
  token_info?: { address?: string; decimals?: number; symbol?: string };
  block_timestamp?: number;
  from?: string;
  to?: string;
  type?: string;
  value?: string;
};
type TronGridResponse = {
  success?: boolean;
  data?: TronTrc20Transfer[];
  meta?: { fingerprint?: string };
};

function isEvmAddress(value: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(value);
}
function isTronBase58Address(value: string): boolean {
  return /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(value);
}
async function readSetting(db: D1Database, key: string): Promise<string | null> {
  const row = await db.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first<{ value: string }>();
  return row?.value ?? null;
}
async function writeSetting(db: D1Database, key: string, value: string): Promise<void> {
  await db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
  ).bind(key, value).run();
}

async function rpc<T>(url: string, method: string, params: unknown[]): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  if (!response.ok) throw new Error(`Stablecoin RPC HTTP ${response.status}`);
  const body = await response.json() as { result?: T; error?: { message?: string } };
  if (body.error) throw new Error(body.error.message || `Stablecoin RPC ${method} failed`);
  if (body.result == null) throw new Error(`Stablecoin RPC ${method} returned no result`);
  return body.result;
}

async function stablecoinMode(db: D1Database, method: StablecoinMethod): Promise<'evm' | 'tron'> {
  if (method !== 'usdt') return 'evm';
  return (await readSetting(db, 'stablecoin_usdt_mode')) === 'tron' ? 'tron' : 'evm';
}

async function loadEvmWatchConfig(db: D1Database, method: StablecoinMethod): Promise<EvmWatchConfig | null> {
  if (await stablecoinMode(db, method) !== 'evm') return null;
  const [rpcUrl, tokenAddress, decimalsRaw, confirmationsRaw, receiveAddress] = await Promise.all([
    readSetting(db, `stablecoin_${method}_rpc_url`),
    readSetting(db, `stablecoin_${method}_token_address`),
    readSetting(db, `stablecoin_${method}_decimals`),
    readSetting(db, `stablecoin_${method}_confirmations`),
    readSetting(db, `${method}_address`),
  ]);
  const decimals = Number(decimalsRaw ?? '6');
  const confirmations = Number(confirmationsRaw ?? '12');
  if (!rpcUrl || !tokenAddress || !receiveAddress) return null;
  if (!/^https:\/\//i.test(rpcUrl)) return null;
  if (!isEvmAddress(tokenAddress) || !isEvmAddress(receiveAddress)) return null;
  if (!Number.isInteger(decimals) || decimals < 2 || decimals > 18) return null;
  if (!Number.isInteger(confirmations) || confirmations < 1 || confirmations > 200) return null;
  return { method, rpcUrl, tokenAddress, receiveAddress, decimals, confirmations };
}

async function loadTronWatchConfig(db: D1Database): Promise<TronWatchConfig | null> {
  if (await stablecoinMode(db, 'usdt') !== 'tron') return null;
  const [baseUrlRaw, tokenAddress, decimalsRaw, receiveAddress, apiKey] = await Promise.all([
    readSetting(db, 'stablecoin_usdt_tron_base_url'),
    readSetting(db, 'stablecoin_usdt_tron_token_address'),
    readSetting(db, 'stablecoin_usdt_decimals'),
    readSetting(db, 'usdt_address'),
    getSecret(db, 'trongrid_api_key'),
  ]);
  const baseUrl = (baseUrlRaw || 'https://api.trongrid.io').replace(/\/+$/, '');
  const decimals = Number(decimalsRaw ?? '6');
  if (!/^https:\/\//i.test(baseUrl) || !tokenAddress || !receiveAddress) return null;
  if (!isTronBase58Address(tokenAddress) || !isTronBase58Address(receiveAddress)) return null;
  if (!Number.isInteger(decimals) || decimals < 2 || decimals > 18) return null;
  let host = '';
  try { host = new URL(baseUrl).host.toLowerCase(); } catch { return null; }
  if (host === 'api.trongrid.io' && !apiKey) return null;
  return { baseUrl, tokenAddress, receiveAddress, decimals, apiKey };
}

function toTopicAddress(address: string): string {
  return `0x${address.toLowerCase().slice(2).padStart(64, '0')}`;
}
function expectedUnits(amountCents: number, decimals: number): bigint {
  return BigInt(amountCents) * 10n ** BigInt(decimals - 2);
}
async function pendingCandidates(db: D1Database, method: StablecoinMethod): Promise<PendingPayment[]> {
  const { results } = await db.prepare(
    `SELECT * FROM pending_payments
     WHERE backend = ? AND status = 'pending' AND lower(currency) = 'usd'
       AND email IS NOT NULL AND trim(email) <> ''
       AND (expires_at IS NULL OR expires_at > datetime('now'))
     ORDER BY created_at ASC LIMIT 100`,
  ).bind(method).all<PendingPayment>();
  return results ?? [];
}
async function txAlreadyUsed(db: D1Database, txHash: string): Promise<boolean> {
  const row = await db.prepare(
    'SELECT id FROM orders WHERE lower(provider_payment_id) = lower(?) LIMIT 1',
  ).bind(txHash).first<{ id: number }>();
  return !!row;
}

async function settleMatchingTransfer(
  db: D1Database,
  method: StablecoinMethod,
  txHash: string,
  value: bigint,
  decimals: number,
  paidAt: number,
  origin: string,
): Promise<boolean> {
  if (await txAlreadyUsed(db, txHash)) return false;
  const pending = await pendingCandidates(db, method);
  const amountMatches = pending.filter((p) => expectedUnits(p.amount_total_cents, decimals) === value);
  if (amountMatches.length === 0) return false;
  const eligible = amountMatches.filter((p) => {
    const createdAt = Date.parse(p.created_at);
    const expiresAt = p.expires_at ? Date.parse(p.expires_at) : Number.POSITIVE_INFINITY;
    return Number.isFinite(createdAt) && paidAt >= createdAt - 120_000 && paidAt <= expiresAt;
  });
  if (eligible.length !== 1) {
    if (eligible.length > 1) {
      console.warn(JSON.stringify({ event: 'stablecoin_ambiguous_payment', method, tx: txHash, matches: eligible.map((p) => p.public_id) }));
    }
    return false;
  }
  const p = eligible[0];
  const settings = await getStoreSettings(db);
  const order = { ...pendingToPaidOrder(p), providerPaymentId: txHash };
  await recordPaidWebhookOrder({ type: `${method}.chain_confirmed`, order }, origin, method, settings);
  console.log(JSON.stringify({ event: 'stablecoin_payment_settled', method, order: p.public_id, tx: txHash }));
  return true;
}

async function blockTimestampMs(config: EvmWatchConfig, blockHex: string): Promise<number> {
  const block = await rpc<RpcBlock>(config.rpcUrl, 'eth_getBlockByNumber', [blockHex, false]);
  return Number(BigInt(block.timestamp)) * 1000;
}
async function settleEvmLog(db: D1Database, config: EvmWatchConfig, log: RpcLog, origin: string): Promise<boolean> {
  if (log.removed || !/^0x[0-9a-fA-F]{64}$/.test(log.transactionHash)) return false;
  let value: bigint;
  try { value = BigInt(log.data); } catch { return false; }
  const paidAt = await blockTimestampMs(config, log.blockNumber);
  return settleMatchingTransfer(db, config.method, log.transactionHash, value, config.decimals, paidAt, origin);
}
async function scanEvmMethod(db: D1Database, config: EvmWatchConfig, origin: string): Promise<void> {
  const latestHex = await rpc<string>(config.rpcUrl, 'eth_blockNumber', []);
  const latest = BigInt(latestHex);
  const safeHead = latest >= BigInt(config.confirmations - 1) ? latest - BigInt(config.confirmations - 1) : 0n;
  const cursorKey = `stablecoin_${config.method}_cursor`;
  const cursorRaw = await readSetting(db, cursorKey);
  let from = cursorRaw ? BigInt(cursorRaw) + 1n : (safeHead > INITIAL_LOOKBACK_BLOCKS ? safeHead - INITIAL_LOOKBACK_BLOCKS : 0n);
  if (from > safeHead) return;
  const recipientTopic = toTopicAddress(config.receiveAddress);
  while (from <= safeHead) {
    const to = from + MAX_BLOCK_SPAN - 1n < safeHead ? from + MAX_BLOCK_SPAN - 1n : safeHead;
    const logs = await rpc<RpcLog[]>(config.rpcUrl, 'eth_getLogs', [{
      fromBlock: `0x${from.toString(16)}`,
      toBlock: `0x${to.toString(16)}`,
      address: config.tokenAddress,
      topics: [TRANSFER_TOPIC, null, recipientTopic],
    }]);
    for (const log of logs) await settleEvmLog(db, config, log, origin);
    await writeSetting(db, cursorKey, to.toString());
    from = to + 1n;
  }
}

async function fetchTronPage(
  config: TronWatchConfig,
  minTimestamp: number,
  maxTimestamp: number,
  fingerprint?: string,
): Promise<TronGridResponse> {
  const url = new URL(`/v1/accounts/${encodeURIComponent(config.receiveAddress)}/transactions/trc20`, `${config.baseUrl}/`);
  url.searchParams.set('only_confirmed', 'true');
  url.searchParams.set('only_to', 'true');
  url.searchParams.set('limit', '200');
  url.searchParams.set('order_by', 'block_timestamp,asc');
  url.searchParams.set('min_timestamp', String(Math.max(0, Math.floor(minTimestamp))));
  url.searchParams.set('max_timestamp', String(Math.max(0, Math.floor(maxTimestamp))));
  url.searchParams.set('contract_address', config.tokenAddress);
  if (fingerprint) url.searchParams.set('fingerprint', fingerprint);
  const headers: Record<string, string> = { accept: 'application/json' };
  if (config.apiKey) headers['TRON-PRO-API-KEY'] = config.apiKey;
  const response = await fetch(url.toString(), { headers });
  if (!response.ok) throw new Error(`TronGrid HTTP ${response.status}`);
  const body = await response.json() as TronGridResponse;
  if (body.success === false) throw new Error('TronGrid returned success=false');
  return body;
}

async function scanTronUsdt(db: D1Database, config: TronWatchConfig, origin: string): Promise<void> {
  const pending = await pendingCandidates(db, 'usdt');
  if (pending.length === 0) return;
  const oldestCreated = Math.min(...pending.map((p) => Date.parse(p.created_at)).filter(Number.isFinite));
  if (!Number.isFinite(oldestCreated)) return;
  const cursorRaw = await readSetting(db, 'stablecoin_usdt_tron_cursor_ms');
  const cursor = cursorRaw ? Number(cursorRaw) : NaN;
  const earliestOrder = oldestCreated - 120_000;
  const minTimestamp = Number.isFinite(cursor) ? Math.max(earliestOrder, cursor - TRON_CURSOR_OVERLAP_MS) : earliestOrder;
  const maxTimestamp = Date.now();
  let fingerprint: string | undefined;
  let pageCount = 0;
  let maxSeen = minTimestamp;

  do {
    const body = await fetchTronPage(config, minTimestamp, maxTimestamp, fingerprint);
    for (const transfer of body.data ?? []) {
      const tx = transfer.transaction_id ?? '';
      const paidAt = Number(transfer.block_timestamp ?? 0);
      if (!/^[0-9a-fA-F]{64}$/.test(tx) || !Number.isFinite(paidAt) || paidAt <= 0) continue;
      if (transfer.type && transfer.type !== 'Transfer') continue;
      if (transfer.to !== config.receiveAddress) continue;
      if (transfer.token_info?.address && transfer.token_info.address !== config.tokenAddress) continue;
      const tokenDecimals = Number(transfer.token_info?.decimals ?? config.decimals);
      if (tokenDecimals !== config.decimals) {
        console.warn(JSON.stringify({ event: 'stablecoin_tron_decimals_mismatch', tx, configured: config.decimals, observed: tokenDecimals }));
        continue;
      }
      let value: bigint;
      try { value = BigInt(transfer.value ?? ''); } catch { continue; }
      await settleMatchingTransfer(db, 'usdt', tx, value, config.decimals, paidAt, origin);
      if (paidAt > maxSeen) maxSeen = paidAt;
    }
    fingerprint = body.meta?.fingerprint || undefined;
    pageCount += 1;
  } while (fingerprint && pageCount < TRON_MAX_PAGES_PER_SWEEP);

  // Keep a large overlap so indexing delays cannot make us miss a confirmed transfer.
  // Tx-hash idempotency makes rescanning the overlap harmless.
  await writeSetting(
    db,
    'stablecoin_usdt_tron_cursor_ms',
    String(fingerprint ? Math.max(minTimestamp, maxSeen) : maxTimestamp),
  );
}

/** Auto-settle confirmed USDC/USDT transfers on configured networks. */
export async function sweepStablecoinPayments(db: D1Database, origin: string): Promise<void> {
  try {
    const usdc = await loadEvmWatchConfig(db, 'usdc');
    if (usdc) await scanEvmMethod(db, usdc, origin);
  } catch (err) {
    console.error('Scheduled USDC chain sweep failed:', err);
  }
  try {
    const mode = await stablecoinMode(db, 'usdt');
    if (mode === 'tron') {
      const tron = await loadTronWatchConfig(db);
      if (tron) await scanTronUsdt(db, tron, origin);
    } else {
      const usdt = await loadEvmWatchConfig(db, 'usdt');
      if (usdt) await scanEvmMethod(db, usdt, origin);
    }
  } catch (err) {
    console.error('Scheduled USDT chain sweep failed:', err);
  }
}

/** Used by admin/tests to determine whether automatic verification is configured. */
export async function stablecoinAutoVerifyConfigured(db: D1Database, method: StablecoinMethod): Promise<boolean> {
  if (method === 'usdt' && await stablecoinMode(db, method) === 'tron') return !!(await loadTronWatchConfig(db));
  return !!(await loadEvmWatchConfig(db, method));
}
