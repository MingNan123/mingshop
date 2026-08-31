-- 0040: freeze the buyer-selected stablecoin network on each pending payment.
-- Merchant network settings may change while a payment is pending; these columns
-- keep the receiving address, token contract and chain adapter immutable for that order.

ALTER TABLE pending_payments ADD COLUMN stablecoin_network_id TEXT;
ALTER TABLE pending_payments ADD COLUMN stablecoin_network_snapshot TEXT;
ALTER TABLE pending_payments ADD COLUMN stablecoin_network_selected_at TEXT;

CREATE INDEX IF NOT EXISTS idx_pending_stablecoin_network
  ON pending_payments(backend, status, stablecoin_network_id, created_at);
