import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import {
  getPaymentProvider,
  isMethodAvailable,
  type PaymentMethod,
} from '../../../features/payments';
import { getStoreSettings } from '../../../features/settings/db';
import { recordPaidWebhookOrder } from '../../../features/orders/recordWebhook';

export const prerender = false;

const METHODS: PaymentMethod[] = ['stripe', 'waffo', 'lightning', 'opennode'];

// Per-provider webhook: POST /api/webhook/<method>. Each rail has its own
// signature scheme, so it must terminate at a provider-specific endpoint.
export const POST: APIRoute = async ({ request, params }) => {
  const method = params.provider as PaymentMethod;
  const settings = await getStoreSettings(env.DB);
  if (!METHODS.includes(method) || !isMethodAvailable(method, settings)) {
    return new Response('Unknown or unconfigured payment method', { status: 404 });
  }

  // Waffo signature verification depends on the exact raw request body.
  const payload = await request.text();
  const origin = new URL(request.url).origin;

  let result;
  try {
    const provider = await getPaymentProvider(method);
    result = await provider.verifyWebhook(payload, request.headers);
  } catch (err) {
    return new Response(`Webhook verification failed: ${(err as Error).message}`, { status: 400 });
  }

  await recordPaidWebhookOrder(result, origin, method, settings);
  return new Response('ok', { status: 200 });
};
