-- A read-only mirror of production merchant payments. Keep shop order pricing
-- separate from the PSP charge currency; USD order totals are not CNY receipts.
CREATE TABLE waffo_payment_ledger (
  payment_id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL,
  provider_order_id TEXT NOT NULL,
  external_id TEXT,
  status TEXT NOT NULL,
  payment_method TEXT,
  currency TEXT NOT NULL,
  amount_minor INTEGER NOT NULL CHECK (amount_minor >= 0),
  refunded_minor INTEGER CHECK (refunded_minor >= 0),
  order_currency TEXT NOT NULL,
  order_amount_minor INTEGER NOT NULL,
  local_order_id INTEGER REFERENCES orders(id),
  match_status TEXT NOT NULL,
  paid_at TEXT NOT NULL,
  synced_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX waffo_payment_ledger_local ON waffo_payment_ledger(local_order_id);
CREATE TABLE waffo_sync_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  lease_until TEXT,
  lease_token TEXT,
  store_id TEXT,
  last_success_at TEXT,
  last_error TEXT,
  payment_count INTEGER NOT NULL DEFAULT 0
);
INSERT INTO waffo_sync_state(id) VALUES (1);
