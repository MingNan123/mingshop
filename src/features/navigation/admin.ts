import type { D1Database } from '@cloudflare/workers-types';
import type { MenuItem, MenuLocation, MenuTargetType } from './db.ts';

/**
 * How many options a picker offers before the merchant has to search.
 */
export const PICKER_LIMIT = 50;

export interface TargetOption {
  id: number;
  /** Prefixed public ID — what the admin picker submits; null only pre-backfill. */
  public_id: string | null;
  name: string;
}

export interface TargetChoices {
  options: TargetOption[];
  /** Matches beyond PICKER_LIMIT, so the UI can say "refine your search". */
  remaining: number;
}

export async function targetChoices(
  db: D1Database,
  targetType: MenuTargetType,
  query: string,
): Promise<TargetChoices> {
  const sources: Partial<Record<MenuTargetType, { table: string; name: string; where: string }>> = {
    page: { table: 'pages', name: 'title', where: 'published = 1' },
    product: { table: 'products', name: 'name', where: 'active = 1' },
    category: { table: 'categories', name: 'name', where: '1 = 1' },
  };
  const source = sources[targetType];
  if (!source) return { options: [], remaining: 0 };

  const q = query.trim();
  const filter = q ? `AND ${source.name} LIKE ?1` : '';
  const pattern = `%${q.slice(0, 60)}%`;

  const listSql = `SELECT id, public_id, ${source.name} AS name FROM ${source.table}
                    WHERE ${source.where} ${filter}
                    ORDER BY ${source.name} COLLATE NOCASE, id
                    LIMIT ${PICKER_LIMIT}`;
  const countSql = `SELECT COUNT(*) AS c FROM ${source.table}
                     WHERE ${source.where} ${filter}`;

  const [list, count] = await db.batch<Record<string, unknown>>([
    q ? db.prepare(listSql).bind(pattern) : db.prepare(listSql),
    q ? db.prepare(countSql).bind(pattern) : db.prepare(countSql),
  ]);

  const options = (list.results ?? []) as unknown as TargetOption[];
  const total = Number((count.results?.[0] as { c?: number } | undefined)?.c ?? 0);
  return { options, remaining: Math.max(0, total - options.length) };
}

export function unavailableReason(item: MenuItem): string | null {
  if (item.available) return null;
  if (!item.targetExists) return '目标不存在';
  switch (item.targetType) {
    case 'page':
      return '草稿 — 前台不可见';
    case 'product':
      return '已停用 — 前台不可见';
    case 'category':
      return '目标不存在';
    default:
      return '不可用';
  }
}

export async function menuReferencesFor(
  db: D1Database,
  targetType: MenuTargetType,
  ids: number[],
): Promise<Map<number, MenuLocation[]>> {
  const found = new Map<number, MenuLocation[]>();
  if (ids.length === 0) return found;

  const CHUNK = 90;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    const placeholders = chunk.map(() => '?').join(', ');
    const { results } = await db
      .prepare(
        `SELECT DISTINCT target_id, location FROM menu_items
          WHERE target_type = ? AND target_id IN (${placeholders})`,
      )
      .bind(targetType, ...chunk)
      .all<{ target_id: number; location: MenuLocation }>();
    for (const row of results ?? []) {
      const list = found.get(row.target_id) ?? [];
      if (!list.includes(row.location)) list.push(row.location);
      found.set(row.target_id, list);
    }
  }
  return found;
}

export const TARGET_TYPE_LABELS: Record<MenuTargetType, string> = {
  home: '首页',
  catalog: '商品目录',
  page: '页面',
  product: '商品',
  category: '分类',
};
