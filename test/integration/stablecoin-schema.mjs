import assert from 'node:assert/strict';
import { Miniflare } from 'miniflare';
import {
  createPendingPayment,
  selectPendingStablecoinNetwork,
} from '../../src/features/payments/lightning/pending.ts';

const mf = new Miniflare({
  modules: true,
  script: 'export default { fetch() { return new Response("ok") } }',
  compatibilityDate: '2026-07-20',
  d1Databases: ['DB'],
});

try {
  const db = await mf.getD1Database('DB');
  await db.exec(`
    CREATE TABLE pending_payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      public_id TEXT NOT NULL UNIQUE,
      payment_hash TEXT NOT NULL UNIQUE,
      backend TEXT NOT NULL,
      bolt11 TEXT,
      amount_sat INTEGER,
      amount_total_cents INTEGER NOT NULL,
      currency TEXT NOT NULL,
      email TEXT,
      items TEXT,
      shipping_cents INTEGER NOT NULL DEFAULT 0,
      shipping_label TEXT,
      shipping_weight_grams INTEGER,
      delivery_method TEXT,
      ship_address TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      expires_at TEXT,
      reservation_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `.replace(/\n\s*/g, ' '));

  const before = await db.prepare('PRAGMA table_info(pending_payments)').all();
  assert.equal(
    before.results.some((row) => row.name === 'stablecoin_network_snapshot'),
    false,
    'fixture starts with the pre-0040 pending_payments shape',
  );

  await createPendingPayment(db, {
    publicId: 'ord_schema0001',
    paymentHash: 'usdc_ord_schema0001',
    backend: 'usdc',
    bolt11: null,
    amountSat: null,
    amountTotalCents: 10000,
    currency: 'usd',
    email: null,
    itemsJson: JSON.stringify([{ id: 1, q: 1, n: 'ERP', p: 10000 }]),
    reservationId: 'ord_schema0001',
    expiresAt: '2026-09-09T00:00:00.000Z',
  });

  const pending = await db
    .prepare('SELECT public_id, stablecoin_network_snapshot FROM pending_payments WHERE public_id = ?')
    .bind('ord_schema0001')
    .first();
  assert.equal(pending.public_id, 'ord_schema0001');
  assert.equal(pending.stablecoin_network_snapshot, null);

  const locked = await selectPendingStablecoinNetwork(
    db,
    'ord_schema0001',
    'usdc',
    {
      id: 'usdc-base',
      token: 'usdc',
      label: 'Base',
      kind: 'evm',
      enabled: true,
      receiveAddress: '0x1111111111111111111111111111111111111111',
      endpoint: 'https://rpc.example.invalid',
      tokenAddress: '0x2222222222222222222222222222222222222222',
      decimals: 6,
      confirmations: 12,
    },
    'buyer@example.com',
  );
  assert.equal(locked, true);

  const row = await db
    .prepare(
      `SELECT stablecoin_network_id, stablecoin_network_snapshot, stablecoin_network_selected_at, email
         FROM pending_payments WHERE public_id = ?`,
    )
    .bind('ord_schema0001')
    .first();
  assert.equal(row.stablecoin_network_id, 'usdc-base');
  assert.ok(row.stablecoin_network_selected_at);
  assert.equal(row.email, 'buyer@example.com');
  assert.equal(JSON.parse(row.stablecoin_network_snapshot).receiveAddress, '0x1111111111111111111111111111111111111111');

  console.log('Stablecoin schema integration passed: pre-0040 pending_payments self-heals');
} finally {
  await mf.dispose();
}
