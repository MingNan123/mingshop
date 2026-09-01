import type { D1Database } from '@cloudflare/workers-types';
import { pendingToPaidOrder, type PendingPayment } from './lightning/pending';
import { recordPaidWebhookOrder } from '../orders/recordWebhook';
import { getStoreSettings } from '../settings/db';
import { getSecret } from '../secrets/store';
import {
  enabledStablecoinProfiles,
  loadStablecoinProfiles,
  parseStablecoinSnapshot,
  type StablecoinNetworkProfile,
  type StablecoinToken,
} from './stablecoin-networks';

const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
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
type PendingNetworkGroup = {
  profile: StablecoinNetworkProfile;
  pending: PendingPayment[];
};

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

function expectedUnits(amountCents: number, decimals: number): bigint {
  return BigInt(amountCents) * 10n ** BigInt(decimals - 2);
}
function toTopicAddress(address: string): string {
  return `0x${address.toLowerCase().slice(2).padStart(64, '0')}`;
}
function profileCursorKey(profile: StablecoinNetworkProfile): string {
  let host = 'endpoint';
  try { host = new URL(profile.endpoint).host.toLowerCase(); } catch {}
  const safe = (v: string) => v.toLowerCase().replace(/[^a-z0-9]/g, '').slice(-14) || 'x';
  return `stablecoin_cursor_${profile.kind}_${safe(profile.id)}_${safe(host)}_${safe(profile.receiveAddress)}_${safe(profile.tokenAddress)}`;
}

async function pendingNetworkGroups(db: D1Database): Promise<PendingNetworkGroup[]> {
  const { results } = await db.prepare(
    `SELECT * FROM pending_payments
      WHERE backend IN ('usdc','usdt') AND status = 'pending' AND lower(currency) = 'usd'
        AND email IS NOT NULL AND trim(email) <> ''
        AND stablecoin_network_snapshot IS NOT NULL
        AND (expires_at IS NULL OR expires_at > datetime('now'))
      ORDER BY created_at ASC LIMIT 250`,
  ).all<PendingPayment>();

  const groups = new Map<string, PendingNetworkGroup>();
  for (const pending of results ?? []) {
    const profile = parseStablecoinSnapshot(pending.stablecoin_network_snapshot);
    if (!profile || profile.token !== pending.backend) continue;
    const key = pending.stablecoin_network_snapshot!;
    const current = groups.get(key);
    if (current) current.pending.push(pending);
    else groups.set(key, { profile, pending: [pending] });
  }
  return [...groups.values()];
}

async function txAlreadyUsed(db: D1Database, txHash: string): Promise<boolean> {
  const row = await db.prepare(
    'SELECT id FROM orders WHERE lower(provider_payment_id) = lower(?) LIMIT 1',
  ).bind(txHash).first<{ id: number }>();
  return !!row;
}

async function settleMatchingTransfer(
  db: D1Database,
  group: PendingNetworkGroup,
  txHash: string,
  value: bigint,
  paidAt: number,
  origin: string,
): Promise<boolean> {
  if (await txAlreadyUsed(db, txHash)) return false;
  const amountMatches = group.pending.filter((p) => expectedUnits(p.amount_total_cents, group.profile.decimals) === value);
  if (amountMatches.length === 0) return false;
  const eligible = amountMatches.filter((p) => {
    const selectedAt = Date.parse(p.stablecoin_network_selected_at || p.created_at);
    const expiresAt = p.expires_at ? Date.parse(p.expires_at) : Number.POSITIVE_INFINITY;
    return Number.isFinite(selectedAt) && paidAt >= selectedAt - 120_000 && paidAt <= expiresAt;
  });
  if (eligible.length !== 1) {
    if (eligible.length > 1) {
      console.warn(JSON.stringify({
        event: 'stablecoin_ambiguous_payment',
        token: group.profile.token,
        network: group.profile.id,
        tx: txHash,
        matches: eligible.map((p) => p.public_id),
      }));
    }
    return false;
  }

  const pending = eligible[0];
  const settings = await getStoreSettings(db);
  const order = { ...pendingToPaidOrder(pending), providerPaymentId: txHash };
  await recordPaidWebhookOrder(
    { type: `${group.profile.token}.${group.profile.kind}.chain_confirmed`, order },
    origin,
    group.profile.token,
    settings,
  );
  console.log(JSON.stringify({
    event: 'stablecoin_payment_settled',
    token: group.profile.token,
    network: group.profile.id,
    order: pending.public_id,
    tx: txHash,
  }));
  return true;
}

async function blockTimestampMs(profile: StablecoinNetworkProfile, blockHex: string): Promise<number> {
  const block = await rpc<RpcBlock>(profile.endpoint, 'eth_getBlockByNumber', [blockHex, false]);
  return Number(BigInt(block.timestamp)) * 1000;
}

async function scanEvmGroup(db: D1Database, group: PendingNetworkGroup, origin: string): Promise<void> {
  const profile = group.profile;
  const latestHex = await rpc<string>(profile.endpoint, 'eth_blockNumber', []);
  const latest = BigInt(latestHex);
  const safeHead = latest >= BigInt(profile.confirmations - 1)
    ? latest - BigInt(profile.confirmations - 1)
    : 0n;
  const cursorKey = profileCursorKey(profile);
  const cursorRaw = await readSetting(db, cursorKey);
  let from = cursorRaw ? BigInt(cursorRaw) + 1n : (safeHead > INITIAL_LOOKBACK_BLOCKS ? safeHead - INITIAL_LOOKBACK_BLOCKS : 0n);
  if (from > safeHead) return;

  const recipientTopic = toTopicAddress(profile.receiveAddress);
  while (from <= safeHead) {
    const to = from + MAX_BLOCK_SPAN - 1n < safeHead ? from + MAX_BLOCK_SPAN - 1n : safeHead;
    const logs = await rpc<RpcLog[]>(profile.endpoint, 'eth_getLogs', [{
      fromBlock: `0x${from.toString(16)}`,
      toBlock: `0x${to.toString(16)}`,
      address: profile.tokenAddress,
      topics: [TRANSFER_TOPIC, null, recipientTopic],
    }]);
    for (const log of logs) {
      if (log.removed || !/^0x[0-9a-fA-F]{64}$/.test(log.transactionHash)) continue;
      let value: bigint;
      try { value = BigInt(log.data); } catch { continue; }
      const paidAt = await blockTimestampMs(profile, log.blockNumber);
      await settleMatchingTransfer(db, group, log.transactionHash, value, paidAt, origin);
    }
    await writeSetting(db, cursorKey, to.toString());
    from = to + 1n;
  }
}

async function fetchTronPage(
  profile: StablecoinNetworkProfile,
  apiKey: string | null,
  minTimestamp: number,
  maxTimestamp: number,
  fingerprint?: string,
): Promise<TronGridResponse> {
  const url = new URL(`/v1/accounts/${encodeURIComponent(profile.receiveAddress)}/transactions/trc20`, `${profile.endpoint.replace(/\/+$/, '')}/`);
  url.searchParams.set('only_confirmed', 'true');
  url.searchParams.set('only_to', 'true');
  url.searchParams.set('limit', '200');
  url.searchParams.set('order_by', 'block_timestamp,asc');
  url.searchParams.set('min_timestamp', String(Math.max(0, Math.floor(minTimestamp))));
  url.searchParams.set('max_timestamp', String(Math.max(0, Math.floor(maxTimestamp))));
  url.searchParams.set('contract_address', profile.tokenAddress);
  if (fingerprint) url.searchParams.set('fingerprint', fingerprint);

  const headers: Record<string, string> = { accept: 'application/json' };
  const official = new URL(profile.endpoint).host.toLowerCase() === 'api.trongrid.io';
  if (official && apiKey) headers['TRON-PRO-API-KEY'] = apiKey;
  const response = await fetch(url.toString(), { headers });
  if (!response.ok) throw new Error(`TRON API HTTP ${response.status}`);
  const body = await response.json() as TronGridResponse;
  if (body.success === false) throw new Error('TRON API returned success=false');
  return body;
}

async function scanTronGroup(db: D1Database, group: PendingNetworkGroup, origin: string): Promise<void> {
  const profile = group.profile;
  const official = new URL(profile.endpoint).host.toLowerCase() === 'api.trongrid.io';
  const apiKey = official ? await getSecret(db, 'trongrid_api_key') : null;
  if (official && !apiKey) throw new Error('Official TronGrid network snapshot requires a configured API key.');

  const selectionTimes = group.pending
    .map((p) => Date.parse(p.stablecoin_network_selected_at || p.created_at))
    .filter(Number.isFinite);
  if (selectionTimes.length === 0) return;
  const earliestSelection = Math.min(...selectionTimes) - 120_000;
  const cursorKey = profileCursorKey(profile);
  const cursorRaw = await readSetting(db, cursorKey);
  const cursor = cursorRaw ? Number(cursorRaw) : NaN;
  const minTimestamp = Number.isFinite(cursor)
    ? Math.max(earliestSelection, cursor - TRON_CURSOR_OVERLAP_MS)
    : earliestSelection;
  const maxTimestamp = Date.now();
  let fingerprint: string | undefined;
  let pageCount = 0;
  let maxSeen = minTimestamp;

  do {
    const body = await fetchTronPage(profile, apiKey, minTimestamp, maxTimestamp, fingerprint);
    for (const transfer of body.data ?? []) {
      const tx = transfer.transaction_id ?? '';
      const paidAt = Number(transfer.block_timestamp ?? 0);
      if (!/^[0-9a-fA-F]{64}$/.test(tx) || !Number.isFinite(paidAt) || paidAt <= 0) continue;
      if (transfer.type && transfer.type !== 'Transfer') continue;
      if (transfer.to !== profile.receiveAddress) continue;
      if (transfer.token_info?.address && transfer.token_info.address !== profile.tokenAddress) continue;
      const observedDecimals = Number(transfer.token_info?.decimals ?? profile.decimals);
      if (observedDecimals !== profile.decimals) {
        console.warn(JSON.stringify({ event: 'stablecoin_tron_decimals_mismatch', network: profile.id, tx, configured: profile.decimals, observed: observedDecimals }));
        continue;
      }
      let value: bigint;
      try { value = BigInt(transfer.value ?? ''); } catch { continue; }
      await settleMatchingTransfer(db, group, tx, value, paidAt, origin);
      if (paidAt > maxSeen) maxSeen = paidAt;
    }
    fingerprint = body.meta?.fingerprint || undefined;
    pageCount += 1;
  } while (fingerprint && pageCount < TRON_MAX_PAGES_PER_SWEEP);

  // Keep overlap to tolerate delayed indexing. Tx-hash idempotency makes repeat
  // reads harmless. If pagination remains, advance only to the newest processed row.
  await writeSetting(db, cursorKey, String(fingerprint ? Math.max(minTimestamp, maxSeen) : maxTimestamp));
}

/**
 * Auto-settle each pending order only on the network snapshot the buyer selected
 * from the merchant-approved list. Current admin settings never redirect an old
 * pending payment to a different chain or address.
 */
export async function sweepStablecoinPayments(db: D1Database, origin: string): Promise<void> {
  const groups = await pendingNetworkGroups(db);
  for (const group of groups) {
    try {
      if (group.profile.kind === 'tron') await scanTronGroup(db, group, origin);
      else await scanEvmGroup(db, group, origin);
    } catch (err) {
      console.error(`Scheduled ${group.profile.token.toUpperCase()} ${group.profile.label} sweep failed:`, err);
    }
  }
}

export async function stablecoinAutoVerifyConfigured(db: D1Database, method: StablecoinToken): Promise<boolean> {
  const profiles = enabledStablecoinProfiles(await loadStablecoinProfiles(db), method);
  for (const profile of profiles) {
    if (profile.kind !== 'tron') return true;
    const official = new URL(profile.endpoint).host.toLowerCase() === 'api.trongrid.io';
    if (!official || await getSecret(db, 'trongrid_api_key')) return true;
  }
  return false;
}
