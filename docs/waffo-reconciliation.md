# Waffo payment reconciliation

`/admin/payments` mirrors production one-time payments from the Waffo GraphQL
API using the existing Worker credentials. The configured product determines
the store; test-mode orders are excluded. The five-minute scheduled handler
and the authenticated manual sync button use the same leased sync job.

The ledger preserves both the original order snapshot and the PSP amount,
including their currencies. It groups successful payments by PSP currency;
failed, canceled and pending payments never contribute to receipts. Refunds
are counted only when successful and denominated in the same PSP currency.
Unknown refund amounts are labeled for review rather than treated as zero.
Reference-currency conversions in the merchant dashboard are not accounting
amounts and are not used by MingShop.

Payment IDs are the upsert key. A full, validated API read precedes the atomic
database batch; a failed refresh retains the previous ledger and exposes its
last error and last successful sync. Reads are bounded to 500 one-time orders;
an incomplete read fails explicitly instead of presenting partial totals.

Only Waffo orders match against this ledger, using payment ID, provider order
ID and merchant external reference. Conflicting IDs or original-currency
amounts are flagged. Sync does not fabricate missing order items, create
charges, refund payments, change fulfillment or send duplicate receipt emails.
Existing signed payment webhooks remain responsible for paid-order creation.

Admin order lists, exports and dashboard reporting exclude the `demo` payment
method by default. Demo history is retained and accessible through the order
list toggle or the Demo method filter. Other payment methods remain visible.
