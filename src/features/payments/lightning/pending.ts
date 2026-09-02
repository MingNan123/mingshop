import type { D1Database } from '@cloudflare/workers-types';
import type { PaidOrderInput, OrderItemInput, ShippingAddress } from '../../orders/db';
import { stablecoinSnapshot, type StablecoinNetworkProfile, type StablecoinToken } from '../stablecoin-networks.ts';

const ensuredStablecoinSchema = new WeakSet<D1Database>();

function isDuplicateColumnError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /duplicate column name/i.test(message);
}

async function tableColumns(db: D1Database, table: string): Promise<Set<string>> {
  const rows = await db.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>();
  return new Set((rows.results ?? []).map((row) => row.name));
}

async function addColumnIfMissing(
  db: D1Database,
  table: string,
  column: string,
  ddl: string,
): Promise<void> {
  const columns = await tableColumns(db, table);
  if (columns.has(column)) return;
  try {
    await db.prepare(ddl).run();
  } catch (error) {
    if (!isDuplicateColumnError(error)) throw error;
  }
}

/**
 * Cloudflare's Git integration deploys code, not D1 migrations. Keep checkout
 * from 500ing when a deployment reaches production before additive migration
 * 0040 has been applied; the migration remains the source of truth.
 */
export async function ensurePendingStablecoinSchema(db: D1Database): Promise<void> {
  if (ensuredStablecoinSchema.has(db)) return;
  await addColumnIfMissing(
    db,
    'pending_payments',
    'stablecoin_network_id',
    'ALTER TABLE pending_payments ADD COLUMN stablecoin_network_id TEXT',
  );
  await addColumnIfMissing(
    db,
    'pending_payments',
    'stablecoin_network_snapshot',
    'ALTER TABLE pending_payments ADD COLUMN stablecoin_network_snapshot TEXT',
  );
  await addColumnIfMissing(
    db,
    'pending_payments',
    'stablecoin_network_selected_at',
    'ALTER TABLE pending_payments ADD COLUMN stablecoin_network_selected_at TEXT',
  );
  await db.prepare(
    `CREATE INDEX IF NOT EXISTS idx_pending_stablecoin_network
      ON pending_payments(backend, status, stablecoin_network_id, created_at)`,
  ).run();
  ensuredStablecoinSchema.add(db);
}

export interface PendingPayment {
  id: number;
  public_id: string;
  payment_hash: string;
  backend: string;
  bolt11: string | null;
  amount_sat: number | null;
  amount_total_cents: number;
  currency: string;
  email: string | null;
  items: string | null;
  shipping_cents: number;
  shipping_label: string | null;
  shipping_weight_grams: number | null;
  delivery_method: string | null;
  ship_address: string | null;
  reservation_id: string | null;
  stablecoin_network_id: string | null;
  stablecoin_network_snapshot: string | null;
  stablecoin_network_selected_at: string | null;
  status: string;
  expires_at: string | null;
  created_at: string;
}

export interface NewPendingPayment {
  publicId: string;
  paymentHash: string;
  backend: string;
  bolt11: string | null;
  amountSat: number | null;
  amountTotalCents: number;
  currency: string;
  email: string | null;
  itemsJson: string | null;
  shippingCents?: number;
  shippingLabel?: string | null;
  shippingWeightGrams?: number | null;
  deliveryMethod?: 'pickup' | 'shipping' | null;
  shipAddressJson?: string | null;
  reservationId?: string | null;
  stablecoinNetworkId?: string | null;
  stablecoinNetworkSnapshot?: string | null;
  expiresAt: string | null;
}

export async function createPendingPayment(db: D1Database, p: NewPendingPayment): Promise<void> {
  await ensurePendingStablecoinSchema(db);
  await db
    .prepare(
      `INSERT INTO pending_payments
         (public_id, payment_hash, backend, bolt11, amount_sat, amount_total_cents, currency, email, items, shipping_cents, shipping_label, shipping_weight_grams, delivery_method, ship_address, expires_at, reservation_id, stablecoin_network_id, stablecoin_network_snapshot)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      p.publicId,
      p.paymentHash,
      p.backend,
      p.bolt11,
      p.amountSat,
      p.amountTotalCents,
      p.currency,
      p.email,
      p.itemsJson,
      p.shippingCents ?? 0,
      p.shippingLabel ?? null,
      p.shippingWeightGrams ?? null,
      p.deliveryMethod ?? null,
      p.shipAddressJson ?? null,
      p.expiresAt,
      p.reservationId ?? null,
      p.stablecoinNetworkId ?? null,
      p.stablecoinNetworkSnapshot ?? null,
    )
    .run();
}

export async function getPendingByPublicId(
  db: D1Database,
  publicId: string,
): Promise<PendingPayment | null> {
  return db.prepare('SELECT * FROM pending_payments WHERE public_id = ?').bind(publicId).first<PendingPayment>();
}

export async function getPendingByHash(
  db: D1Database,
  paymentHash: string,
): Promise<PendingPayment | null> {
  return db.prepare('SELECT * FROM pending_payments WHERE payment_hash = ?').bind(paymentHash).first<PendingPayment>();
}

export async function updatePendingEmail(
  db: D1Database,
  publicId: string,
  email: string,
): Promise<boolean> {
  const normalized = email.trim().toLowerCase();
  if (!/.+@.+\..+/.test(normalized) || normalized.length > 254) return false;
  const result = await db.prepare(
    `UPDATE pending_payments SET email = ?
     WHERE public_id = ? AND status = 'pending'`,
  ).bind(normalized, publicId).run();
  return (result.meta.changes ?? 0) > 0;
}

/**
 * Freeze the merchant-approved network chosen by the buyer. The UPDATE itself is
 * immutable: once a snapshot exists, neither UI nor a crafted POST can switch it.
 */
export async function selectPendingStablecoinNetwork(
  db: D1Database,
  publicId: string,
  token: StablecoinToken,
  profile: StablecoinNetworkProfile,
  email?: string | null,
): Promise<boolean> {
  await ensurePendingStablecoinSchema(db);
  if (!profile.enabled || profile.token !== token) return false;
  let normalizedEmail: string | null = null;
  if (email != null && email.trim() !== '') {
    normalizedEmail = email.trim().toLowerCase();
    if (!/.+@.+\..+/.test(normalizedEmail) || normalizedEmail.length > 254) return false;
  }
  const result = await db.prepare(
    `UPDATE pending_payments
        SET email = COALESCE(?, email),
            stablecoin_network_id = ?,
            stablecoin_network_snapshot = ?,
            stablecoin_network_selected_at = datetime('now')
      WHERE public_id = ? AND backend = ? AND status = 'pending'
        AND stablecoin_network_snapshot IS NULL`,
  ).bind(normalizedEmail, profile.id, stablecoinSnapshot(profile), publicId, token).run();
  return (result.meta.changes ?? 0) > 0;
}

export async function markPendingSettled(db: D1Database, paymentHash: string): Promise<void> {
  await db.prepare(`UPDATE pending_payments SET status = 'settled' WHERE payment_hash = ?`).bind(paymentHash).run();
}

export function pendingToPaidOrder(p: PendingPayment): PaidOrderInput {
  let items: OrderItemInput[] = [];
  if (p.items) {
    try {
      const raw = JSON.parse(p.items) as { id: number; q: number; n: string; p: number; v?: number | null }[];
      items = raw.map((r) => ({
        productId: r.id,
        variantId: r.v ?? null,
        name: r.n,
        priceCents: r.p,
        quantity: r.q,
      }));
    } catch {
      items = [];
    }
  }
  let shippingAddress: ShippingAddress | null = null;
  if (p.ship_address) {
    try { shippingAddress = JSON.parse(p.ship_address) as ShippingAddress; } catch { shippingAddress = null; }
  }
  return {
    providerSessionId: p.payment_hash,
    publicId: p.public_id,
    reservationId: p.reservation_id ?? undefined,
    email: p.email,
    amountTotalCents: p.amount_total_cents,
    shippingCents: p.shipping_cents,
    shippingLabel: p.shipping_label,
    shippingWeightGrams: p.shipping_weight_grams,
    deliveryMethod: p.delivery_method === 'pickup' ? 'pickup' : p.delivery_method === 'shipping' ? 'shipping' : null,
    shippingAddress,
    currency: p.currency,
    items,
    settlePaymentHash: p.payment_hash,
  };
}
