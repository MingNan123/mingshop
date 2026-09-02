import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getPaymentProvider, webhookMethods } from '../../features/payments';
import { getStoreSettings } from '../../features/settings/db';
import { recordPaidWebhookOrder } from '../../features/orders/recordWebhook';

export const prerender = false;

// Legacy catch-all webhook. New provider integrations use /api/webhook/<method>,
// but older Stripe dashboards may still point at /api/webhook. Try only providers
// that have real webhook verification; whichever validates the payload settles it.
export const POST: APIRoute = async ({ request }) => {
  const payload = await request.text();
  const origin = new URL(request.url).origin;
  const settings = await getStoreSettings(env.DB);
  const errors: string[] = [];

  for (const method of webhookMethods()) {
    try {
      const provider = await getPaymentProvider(method);
      const result = await provider.verifyWebhook(payload, request.headers);
      await recordPaidWebhookOrder(result, origin, method, settings);
      return new Response('ok', { status: 200 });
    } catch (err) {
      errors.push(`${method}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return new Response(`Webhook verification failed: ${errors.join('; ')}`, { status: 400 });
};
