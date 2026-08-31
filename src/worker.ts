import { handle } from '@astrojs/cloudflare/handler';
import { env } from 'cloudflare:workers';
import { sweepStaleNotifications } from './features/email/outbox';
import { releaseExpiredReservations } from './features/orders/reservations';
import { getSetting } from './features/settings/db';
import { sweepStablecoinPayments } from './features/payments/stablecoin-watcher';

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
