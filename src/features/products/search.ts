import type { D1Database } from '@cloudflare/workers-types';
import type { Product } from './db';
import { normalizeSearchQuery } from '../search/query';

/**
 * Turn raw user input into a safe FTS5 MATCH query. FTS5 throws a syntax error
 * on bare special characters (`-`, `"`, `:`, `*`, etc.), so we keep only
 * alphanumeric tokens and prefix-match each one (`tee` → `tee*`). Returns null
 * when there's nothing searchable.
 */
export function toFtsQuery(raw: string): string | null {
  const tokens = normalizeSearchQuery(raw).toLowerCase().match(/[a-z0-9]+/g);
  if (!tokens || tokens.length === 0) return null;
  // Space-joined terms are ANDed by FTS5; trailing * makes each a prefix match.
  return tokens.map((t) => `${t}*`).join(' ');
}

function exclusionSql(ids: number[]): string {
  return ids.length > 0 ? ` AND p.id NOT IN (${ids.map(() => '?').join(',')})` : '';
}

/** Unicode-safe, literal LIKE terms for the storefront's broad fuzzy search. */
export function toFuzzyTerms(raw: string): string[] {
  return normalizeSearchQuery(raw)
    .toLowerCase()
    .split(/\s+/u)
    .filter(Boolean)
    .slice(0, 8)
    .map((term) => `%${term.replace(/[\\%_]/g, '\\$&')}%`);
}

/**
 * Build one searchable text document per product. Unlike the legacy FTS table,
 * this includes Chinese text and all buyer-visible/catalog-identifying fields:
 * product copy, slug/id, filename, categories, variants/SKUs and extras.
 */
const FUZZY_PRODUCT_SOURCE = `(
  SELECT p.*,
         LOWER(
           COALESCE(p.name, '') || ' ' ||
           COALESCE(p.description, '') || ' ' ||
           COALESCE(p.slug, '') || ' ' ||
           COALESCE(p.public_id, '') || ' ' ||
           COALESCE(p.variant_label, '') || ' ' ||
           COALESCE(p.file_name, '') || ' ' ||
           COALESCE((SELECT GROUP_CONCAT(c.name || ' ' || c.slug, ' ')
                       FROM product_categories pc
                       JOIN categories c ON c.id = pc.category_id
                      WHERE pc.product_id = p.id), '') || ' ' ||
           COALESCE((SELECT GROUP_CONCAT(v.label || ' ' || COALESCE(v.sku, ''), ' ')
                       FROM product_variants v
                      WHERE v.product_id = p.id AND v.active = 1), '') || ' ' ||
           COALESCE((SELECT GROUP_CONCAT(e.label, ' ')
                       FROM product_extras e
                      WHERE e.product_id = p.id AND e.active = 1), '')
         ) AS search_text
    FROM products p
) p`;

function fuzzyWhere(terms: string[], excludeIds: number[]): string {
  return terms.map(() => "p.search_text LIKE ? ESCAPE '\\'").join(' AND ') + exclusionSql(excludeIds);
}

/** Count active FTS matches, optionally excluding results supplied elsewhere. */
export async function countSearchProducts(
  db: D1Database,
  raw: string,
  excludeIds: number[] = [],
): Promise<number> {
  const terms = toFuzzyTerms(raw);
  if (terms.length === 0) return 0;

  const row = await db
    .prepare(
      `SELECT COUNT(*) AS n
         FROM ${FUZZY_PRODUCT_SOURCE}
        WHERE p.active = 1 AND ${fuzzyWhere(terms, excludeIds)}`,
    )
    .bind(...terms, ...excludeIds)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/** One page of active fuzzy matches, with name matches ranked first. */
export async function searchProducts(
  db: D1Database,
  raw: string,
  limit = 50,
  offset = 0,
  excludeIds: number[] = [],
): Promise<Product[]> {
  const normalized = normalizeSearchQuery(raw).toLowerCase();
  const terms = toFuzzyTerms(normalized);
  if (terms.length === 0 || limit <= 0) return [];
  const escaped = normalized.replace(/[\\%_]/g, '\\$&');

  const { results } = await db
    .prepare(
      `SELECT p.*
         FROM ${FUZZY_PRODUCT_SOURCE}
        WHERE p.active = 1 AND ${fuzzyWhere(terms, excludeIds)}
        ORDER BY CASE
                   WHEN LOWER(p.name) = ? THEN 0
                   WHEN LOWER(p.name) LIKE ? ESCAPE '\\' THEN 1
                   WHEN LOWER(p.name) LIKE ? ESCAPE '\\' THEN 2
                   ELSE 3
                 END,
                 p.created_at DESC, p.id DESC
        LIMIT ? OFFSET ?`,
    )
    .bind(...terms, ...excludeIds, escaped, `${escaped}%`, `%${escaped}%`, limit, offset)
    .all<Product>();
  return results ?? [];
}

/** Levenshtein edit distance between two strings. */
export function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const curr = [i];
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = curr;
  }
  return prev[n];
}

/** Distinct ≥3-char words from active products' name + description. */
async function productVocabulary(db: D1Database): Promise<string[]> {
  const { results } = await db
    .prepare('SELECT name, description FROM products WHERE active = 1')
    .all<{ name: string; description: string | null }>();
  const words = new Set<string>();
  for (const r of results ?? []) {
    const matches = `${r.name} ${r.description ?? ''}`.toLowerCase().match(/[a-z0-9]+/g);
    for (const w of matches ?? []) if (w.length >= 3) words.add(w);
  }
  return [...words];
}

/**
 * When a search finds nothing, propose a corrected query by snapping each token
 * to the nearest product word within a small edit distance. Returns null if no
 * token is improved. Runs in the Worker (no spellfix1 needed on D1).
 */
export async function suggestQuery(db: D1Database, raw: string): Promise<string | null> {
  const tokens = raw.toLowerCase().match(/[a-z0-9]+/g);
  if (!tokens || tokens.length === 0) return null;
  const vocab = await productVocabulary(db);
  if (vocab.length === 0) return null;

  let changed = false;
  const corrected = tokens.map((tok) => {
    if (vocab.includes(tok)) return tok;
    let best = tok;
    let bestDist = Infinity;
    for (const w of vocab) {
      if (Math.abs(w.length - tok.length) > 2) continue; // cheap prune
      const d = editDistance(tok, w);
      if (d < bestDist) {
        bestDist = d;
        best = w;
      }
    }
    const maxDist = tok.length <= 4 ? 1 : 2; // stricter for short words
    if (best !== tok && bestDist <= maxDist) {
      changed = true;
      return best;
    }
    return tok;
  });

  return changed ? corrected.join(' ') : null;
}
