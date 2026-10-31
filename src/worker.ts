import { handle } from '@astrojs/cloudflare/handler';
import { env } from 'cloudflare:workers';
import { sweepStaleNotifications } from './features/email/outbox';
import {
  releaseExpiredReservations,
  releaseInventoryReservation,
} from './features/orders/reservations';
import { getSetting } from './features/settings/db';
import { sweepStablecoinPayments } from './features/payments/stablecoin-watcher';
import { scheduledOrigin } from './features/http/origin';
import { processProductTranslation } from './features/products/autoTranslate';
import { purgeCacheTags } from './features/cache/purge';
import { CACHE_TAG } from './features/cache/tags';
import { syncWaffoPayments } from './features/payments/waffoSync';

async function releaseExpiredUsdtReservations(): Promise<void> {
  const { results } = await env.DB.prepare(
    `SELECT public_id FROM checkout_reservations
     WHERE payment_method = 'usdt' AND status = 'active'
       AND expires_at <= datetime('now')
     ORDER BY expires_at LIMIT 50`,
  ).all<{ public_id: string }>();
  for (const row of results ?? []) {
    await releaseInventoryReservation(env.DB, row.public_id);
  }
}

async function runScheduledSweeps(): Promise<void> {
  const db = env.DB;
  const origin = scheduledOrigin(env.CANONICAL_ORIGIN, await getSetting(db, 'store_url'));

  // Verify chain payments before releasing expired inventory. A transfer that
  // landed near the end of a reservation window must get a chance to settle first.
  if (origin) {
    try {
      await sweepStablecoinPayments(db, origin);
    } catch (err) {
      console.error('Scheduled stablecoin sweep failed:', err);
    }
  }

  try {
    await releaseExpiredUsdtReservations();
    await releaseExpiredReservations(db, 50);
  } catch (err) {
    console.error('Scheduled reservation sweep failed:', err);
  }

  try {
    if (origin) await sweepStaleNotifications(db, origin);
  } catch (err) {
    console.error('Scheduled notification sweep failed:', err);
  }
  try {
    await syncWaffoPayments();
  } catch {
    // The dashboard retains the actionable provider error and last good data.
    console.error('Scheduled Waffo payment reconciliation failed');
  }
  // Translation work follows payment/inventory sweeps so inference latency
  // cannot postpone payment confirmation or reservation cleanup.
  if (env.AI) {
    try {
      if (await processProductTranslation(db, env.AI)) await purgeCacheTags([CACHE_TAG.catalog]);
    } catch (error) {
      console.error('Scheduled product translation failed', error);
    }
  }
}

export default {
  fetch: handle,
  scheduled(_controller, _env, ctx) {
    ctx.waitUntil(runScheduledSweeps());
  },
} satisfies ExportedHandler<Cloudflare.Env>;
