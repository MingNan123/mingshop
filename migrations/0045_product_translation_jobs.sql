CREATE TABLE product_translation_jobs (
  product_id INTEGER PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
  token TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  available_at TEXT NOT NULL DEFAULT (datetime('now')),
  generated_json TEXT,
  source_name TEXT NOT NULL,
  source_description TEXT NOT NULL
);
