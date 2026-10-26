import type { APIRoute } from 'astro';
import { getEmailProvider } from '../../../../features/email';
import { isValidEmailAddress } from '../../../../features/email/recipients';
import { getStoreSettings } from '../../../../features/settings/db';
import { env } from 'cloudflare:workers';
import { emailDeliveryError } from '../../../../features/email/deliveryError';

export const prerender = false;

// POST /api/admin/email/test — send a one-off test email with the CURRENTLY SAVED
// email config (provider + key + from), so the owner can confirm delivery actually
// works (the only way past "binding present ≠ deliverable"). Returns JSON for the
// dashboard's inline button; falls back to a ?msg redirect without JS.
export const POST: APIRoute = async ({ request, redirect }) => {
  const form = await request.formData();
  const to = String(form.get('test_to') ?? '').trim();
  const wantsJson = request.headers.get('x-requested-with') === 'fetch';
  const done = (ok: boolean, message: string) =>
    wantsJson
      ? new Response(JSON.stringify({ ok, message }), {
          status: 200,
          headers: { 'content-type': 'application/json; charset=utf-8' },
        })
      : redirect(`/admin/settings?msg=${encodeURIComponent(message)}#email`, 303);

  if (!to || !isValidEmailAddress(to)) {
    return done(false, 'Enter a valid recipient address for the test email.');
  }
  const provider = await getEmailProvider();
  if (!provider) {
    return done(false, 'Email isn’t configured — pick a provider, add its key, and Save first.');
  }
  const storeName = (await getStoreSettings(env.DB)).storeName ?? 'your store';
  try {
    await provider.send({
      to,
      subject: `Test email from ${storeName}`,
      html: `<p>This is a test email from your ${storeName} admin. Email delivery is working ✅</p>`,
      text: `This is a test email from your ${storeName} admin. Email delivery is working.`,
    });
    // Only recover unsent domain-verification failures after a successful send.
    // Previously delivered receipts must never be replayed by this action.
    const recovered = await env.DB.prepare(`UPDATE order_notifications
      SET state = 'pending', attempts = 0, lease_expires_at = NULL, last_error = NULL
      WHERE state = 'dead' AND sent_at IS NULL
        AND last_error LIKE '%domain is not verified%'
        AND created_at >= datetime('now', '-7 days')`).run();
    return done(true, `测试邮件已提交至 ${to}。${recovered.meta.changes ? `已恢复 ${recovered.meta.changes} 封因域名验证失败而未发送的订单邮件，系统将自动重试。` : ''}`);
  } catch (err) {
    return done(false, emailDeliveryError(err));
  }
};
