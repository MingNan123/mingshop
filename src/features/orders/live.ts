import type { OrderFilter } from './db';

// Demo sales remain inspectable, but must not inflate production reporting.
export const LIVE_ORDER_CONDITION = "COALESCE(payment_method,'stripe') != 'demo'";
export function liveOrderFilter(filter: OrderFilter, includeDemo=false): OrderFilter {
  if (includeDemo) return filter;
  return {where: filter.where ? `${filter.where} AND ${LIVE_ORDER_CONDITION}` : `WHERE ${LIVE_ORDER_CONDITION}`, params:filter.params};
}
