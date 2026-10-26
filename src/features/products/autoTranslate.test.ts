import { describe, expect, it } from 'vitest';
import type { Ai } from '@cloudflare/workers-types';
import type { D1Database } from '@cloudflare/workers-types';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { enqueueProductTranslation, processProductTranslation, mergeAutomaticTranslations, translateProductContent } from './autoTranslate';

describe('automatic product translation', () => {
  it('refreshes machine copy, fills empty fields and preserves manual edits', () => {
    expect(mergeAutomaticTranslations(
      { en: { name: 'Hand edited', description: 'Old generated description' } },
      { en: { name: 'Old generated name', description: 'Old generated description' } },
      { en: { name: 'New generated name', description: 'New description' }, ja: { name: '商品' } },
    )).toEqual({ en: { name: 'Hand edited', description: 'New description' }, ja: { name: '商品' } });
  });

  it('rejects incomplete model output instead of publishing partial translations', async () => {
    const ai = { run: async () => ({ choices: [{ message: { content: '{"en":{"name":"Product"}}' } }] }) } as unknown as Ai;
    await expect(translateProductContent(ai, '商品', '说明')).rejects.toThrow('incomplete');
  });

  it('supports the hosted model response and retains Markdown', async () => {
    const translations = Object.fromEntries(['zh-Hant', 'en', 'ko', 'ja'].map(locale => [locale, { name: 'Product', description: '**20 USD** deposit' }]));
    const ai = { run: async () => ({ choices: [{ message: { content: JSON.stringify(translations) } }] }) } as unknown as Ai;
    expect((await translateProductContent(ai, '商品', '**20 USD** 定金')).en?.description).toBe('**20 USD** deposit');
  });

  it('accepts parsed JSON returned by the Workers AI binding', async () => {
    const translations = Object.fromEntries(['zh-Hant', 'en', 'ko', 'ja'].map(locale => [locale, { name: 'Product', description: 'Full details' }]));
    const ai = { run: async () => ({ response: translations }) } as unknown as Ai;
    expect((await translateProductContent(ai, '商品', '完整说明')).ja?.description).toBe('Full details');
  });

  it('persists generated translations and rejects an obsolete in-flight result', async () => {
    const sql = new DatabaseSync(':memory:');
    sql.exec('CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT, description TEXT, translations_json TEXT)');
    sql.exec(readFileSync(new URL('../../../migrations/0045_product_translation_jobs.sql', import.meta.url), 'utf8'));
    sql.prepare('INSERT INTO products VALUES (?, ?, ?, ?)').run(1, '商品', '说明', null);
    const db = {
      prepare(query: string) {
        return { bind(...args: (string | number)[]) {
          return {
            async first() { return sql.prepare(query).get(...args) ?? null; },
            async run() { const result = sql.prepare(query).run(...args); return { meta: { changes: Number(result.changes) } }; },
          };
        } };
      },
    } as unknown as D1Database;
    try {
      const generated = Object.fromEntries(['zh-Hant', 'en', 'ko', 'ja'].map(locale => [locale, { name: 'Product', description: 'Details' }]));
      await enqueueProductTranslation(db, { id: 1, name: '商品', description: '说明' });
      const ai = { run: async () => ({ response: generated }) } as unknown as Ai;
      expect(await processProductTranslation(db, ai, 1)).toBe(true);
      expect(JSON.parse(String(sql.prepare('SELECT translations_json FROM products').get()?.translations_json)).en.name).toBe('Product');
      sql.prepare('UPDATE products SET name = ? WHERE id = 1').run('新商品');
      const current = String(sql.prepare('SELECT translations_json FROM products').get()?.translations_json);
      await enqueueProductTranslation(db, { id: 1, name: '新商品', description: '说明', translations_json: current });
      const racingAi = { run: async () => {
        sql.prepare('UPDATE products SET name = ? WHERE id = 1').run('更新后的商品');
        return { response: generated };
      } } as unknown as Ai;
      expect(await processProductTranslation(db, racingAi, 1)).toBe(false);
      expect(sql.prepare('SELECT name FROM products').get()?.name).toBe('更新后的商品');
    } finally { sql.close(); }
  });
});
