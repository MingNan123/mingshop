export function emailDeliveryError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? '');
  if (/domain is not verified/i.test(message)) {
    return '发件域名尚未通过 Resend 验证，邮件被拒绝。请先在 Resend → Domains 添加并验证发件域名的 DNS 记录，然后发送测试邮件。仅填写 API Key 和发件邮箱不会完成域名验证。';
  }
  if (/Resend send failed \((401|403)\)/.test(message)) {
    return 'Resend 拒绝发送，请检查 API Key 的有效性、发送权限及发件域名验证状态。';
  }
  return message || '未知邮件发送错误';
}
