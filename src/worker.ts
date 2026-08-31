import { handle } from '@astrojs/cloudflare/handler';
import { env } from 'cloudflare:workers';
import { sweepStaleNotifications } from './features/email/outbox';
import {
  releaseExpiredReservations,
  releaseInventoryReservation,
} from './features/orders/reservations';
import { getSetting } from './features/settings/db';
import { sweepStablecoinPayments } from './features/payments/stablecoin-watcher';

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
  const origin = await getSetting(db, 'store_url');

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
}

export default {
  fetch: handle,
  scheduled(_controller, _env, ctx) {
    ctx.waitUntil(runScheduledSweeps());
  },
} satisfies ExportedHandler<Cloudflare.Env>;
