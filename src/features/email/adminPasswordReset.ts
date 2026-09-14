import type { EmailMessage } from './provider';
import { PALETTE, emailButton, emailShell } from './layout';

export function adminPasswordResetEmail(to: string, link: string, storeName: string): EmailMessage {
  const subject = `重置 ${storeName} 后台密码`;
  const text = `有人请求重置 ${storeName} 的后台管理密码。\n\n请在 15 分钟内打开此链接：\n${link}\n\n如果不是你本人操作，请忽略此邮件。`;
  const html = emailShell({
    storeName,
    heading: '重置后台密码',
    subheading: '此链接将在 15 分钟后失效，并会在密码修改后立即作废。',
    body:
      emailButton(link, '设置新密码') +
      `<p style="margin:0;font-size:12px;line-height:1.6;color:${PALETTE.muted};">按钮无法打开？请复制此链接到浏览器：<br><a href="${link}" style="color:${PALETTE.muted};word-break:break-all;">${link}</a></p>`,
    footer: '如果不是你本人发起的请求，请忽略此邮件；当前密码不会改变。',
  });
  return { to, subject, html, text };
}
