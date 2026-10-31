import type { APIRoute } from 'astro';
import { syncWaffoPayments } from '../../../../features/payments/waffoSync';
export const prerender=false;
export const POST: APIRoute = async ({redirect}) => {
  try {
    const result=await syncWaffoPayments();
    const message=result.skipped ? '同步正在进行中或 Waffo 尚未配置，请稍后刷新。' : `已同步 ${result.synced} 笔商户付款记录。`;
    return redirect(`/admin/payments?message=${encodeURIComponent(message)}`,303);
  } catch {
    return redirect('/admin/payments?message='+encodeURIComponent('同步失败，详情见下方提示。上次成功的数据仍保留。'),303);
  }
};
