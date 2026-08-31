import { env } from 'cloudflare:workers';
import type { D1Database } from '@cloudflare/workers-types';
import { pendingToPaidOrder, type PendingPayment } from './lightning/pending';
import { recordPaidWebhookOrder } from '../orders/recordWebhook';
import { getStoreSettings } from '../settings/db';

export type StablecoinMethod = 'usdc' | 'usdt';

const TRANSFER_TOPIC =
  '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const INITIAL_LOOKBACK_BLOCKS = 2_000n;
const MAX_BLOCK_SPAN = 1_000n;

type RpcLog = {
  transactionHash: string;
  blockNumber: string;
  data: string;
  topics: string[];
  removed?: boolean;
};

type RpcBlock = { timestamp: string };

type WatchConfig = {
  method: StablecoinMethod;
  rpcUrl: string;
  tokenAddress: string;
  receiveAddress: string;
  decimals: number;
  confirmations: number;
};

function isEvmAddress(value: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(value);
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

async function loadWatchConfig(db: D1Database, method: StablecoinMethod): Promise<WatchConfig | null> {
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

async function blockTimestampMs(config: WatchConfig, blockHex: string): Promise<number> {
  const block = await rpc<RpcBlock>(config.rpcUrl, 'eth_getBlockByNumber', [blockHex, false]);
  return Number(BigInt(block.timestamp)) * 1000;
}

async function settleUniqueLog(
  db: D1Database,
  config: WatchConfig,
  log: RpcLog,
  origin: string,
): Promise<boolean> {
  if (log.removed || !/^0x[0-9a-fA-F]{64}$/.test(log.transactionHash)) return false;
  if (await txAlreadyUsed(db, log.transactionHash)) return false;
  let value: bigint;
  try { value = BigInt(log.data); } catch { return false; }

  const pending = await pendingCandidates(db, config.method);
  const amountMatches = pending.filter((p) => expectedUnits(p.amount_total_cents, config.decimals) === value);
  if (amountMatches.length === 0) return false;

  const paidAt = await blockTimestampMs(config, log.blockNumber);
  const eligible = amountMatches.filter((p) => {
    const createdAt = Date.parse(p.created_at);
    return Number.isFinite(createdAt) && paidAt >= createdAt - 120_000;
  });

  // Shared receiving addresses can have two live orders for the exact same amount.
  // Never guess which customer paid: only a unique match is auto-settled.
  if (eligible.length !== 1) {
    if (eligible.length > 1) {
      console.warn(JSON.stringify({ event: 'stablecoin_ambiguous_payment', method: config.method, tx: log.transactionHash, matches: eligible.map((p) => p.public_id) }));
    }
    return false;
  }

  const p = eligible[0];
  const settings = await getStoreSettings(db);
  const order = { ...pendingToPaidOrder(p), providerPaymentId: log.transactionHash };
  await recordPaidWebhookOrder(
    { type: `${config.method}.chain_confirmed`, order },
    origin,
    config.method,
    settings,
  );
  console.log(JSON.stringify({ event: 'stablecoin_payment_settled', method: config.method, order: p.public_id, tx: log.transactionHash }));
  return true;
}

async function scanMethod(db: D1Database, config: WatchConfig, origin: string): Promise<void> {
  const latestHex = await rpc<string>(config.rpcUrl, 'eth_blockNumber', []);
  const latest = BigInt(latestHex);
  const safeHead = latest >= BigInt(config.confirmations - 1)
    ? latest - BigInt(config.confirmations - 1)
    : 0n;
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
    for (const log of logs) await settleUniqueLog(db, config, log, origin);
    await writeSetting(db, cursorKey, to.toString());
    from = to + 1n;
  }
}

/**
 * Auto-settle confirmed ERC-20 USDC/USDT transfers on configured EVM networks.
 * Safe to run from Cron repeatedly: block cursors and provider_payment_id make it idempotent.
 */
export async function sweepStablecoinPayments(db: D1Database, origin: string): Promise<void> {
  for (const method of ['usdc', 'usdt'] as const) {
    try {
      const config = await loadWatchConfig(db, method);
      if (config) await scanMethod(db, config, origin);
    } catch (err) {
      console.error(`Scheduled ${method.toUpperCase()} chain sweep failed:`, err);
    }
  }
}

/** Used by admin/tests to determine whether automatic EVM verification is configured. */
export async function stablecoinAutoVerifyConfigured(db: D1Database, method: StablecoinMethod): Promise<boolean> {
  return !!(await loadWatchConfig(db, method));
}

// Keep the env import reachable in Workers builds that tree-shake scheduled-only modules.
void env;
