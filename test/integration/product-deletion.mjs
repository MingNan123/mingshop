// Isolated SQLite regression checks; never connects to a deployed database.
import { DatabaseSync } from 'node:sqlite';
import assert from 'node:assert/strict';
import { deleteProduct, deleteProducts } from '../../src/features/products/db.ts';

const sql = new DatabaseSync(':memory:');
sql.exec(`
  PRAGMA foreign_keys = ON;
  CREATE TABLE products (id INTEGER PRIMARY KEY);
  CREATE TABLE product_variants (id INTEGER PRIMARY KEY, product_id INTEGER NOT NULL REFERENCES products(id));
  CREATE TABLE product_extras (id INTEGER PRIMARY KEY, product_id INTEGER NOT NULL REFERENCES products(id));
  CREATE TABLE product_categories (product_id INTEGER NOT NULL REFERENCES products(id));
  CREATE TABLE product_images (product_id INTEGER NOT NULL REFERENCES products(id));
  CREATE TABLE order_items (id INTEGER PRIMARY KEY, product_id INTEGER REFERENCES products(id), variant_id INTEGER,
    name TEXT, price_cents INTEGER, quantity INTEGER, file_key TEXT);
  INSERT INTO products VALUES (1), (2), (3), (4);
  INSERT INTO product_variants VALUES (10, 1), (20, 2);
  INSERT INTO product_extras VALUES (10, 1), (20, 2);
  INSERT INTO product_categories VALUES (1), (2);
  INSERT INTO product_images VALUES (1), (2);
  INSERT INTO order_items VALUES (1, 1, 10, 'Historical purchase', 500, 1, 'purchased-file'),
    (2, 2, 20, 'Another purchase', 700, 2, 'another-file');
`);
const db = {
  prepare(query) { return { bind(...values) { return { query, values }; } }; },
  async batch(statements) {
    sql.exec('BEGIN');
    try {
      const results = statements.map(({ query, values }) => sql.prepare(query).run(...values));
      sql.exec('COMMIT');
      return results;
    } catch (error) { sql.exec('ROLLBACK'); throw error; }
  },
};
try {
  assert.throws(() => sql.prepare('DELETE FROM products WHERE id = 1').run(), /FOREIGN KEY/);
  await deleteProduct(db, 1);
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM products WHERE id = 1').get().n, 0);
  assert.deepEqual({ ...sql.prepare('SELECT * FROM order_items WHERE id = 1').get() },
    { id: 1, product_id: null, variant_id: null, name: 'Historical purchase', price_cents: 500, quantity: 1, file_key: 'purchased-file' });
  for (const table of ['product_variants', 'product_extras', 'product_images', 'product_categories']) {
    assert.equal(sql.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE product_id = 1`).get().n, 0);
  }
  // A failure must roll back ALL selected products, including detached history.
  sql.exec("CREATE TRIGGER prevent_test_delete BEFORE DELETE ON products WHEN OLD.id = 3 BEGIN SELECT RAISE(ABORT, 'test failure'); END;");
  await assert.rejects(deleteProducts(db, [2, 3]), /test failure/);
  assert.equal(sql.prepare('SELECT product_id FROM order_items WHERE id = 2').get().product_id, 2);
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM product_variants WHERE product_id = 2').get().n, 1);
  sql.exec('DROP TRIGGER prevent_test_delete');
  await deleteProducts(db, [2, 2, 3]);
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM order_items').get().n, 2);
  assert.deepEqual(sql.prepare('SELECT id FROM products').all().map(row => row.id), [4]);
  assert.deepEqual(sql.prepare('PRAGMA foreign_key_check').all(), []);
  console.log('Product deletion: history preserved, dependencies removed, bulk rollback and unrelated product checks passed.');
} finally { sql.close(); }
