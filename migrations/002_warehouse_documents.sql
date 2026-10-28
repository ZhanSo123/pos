CREATE TABLE IF NOT EXISTS warehouse_documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL CHECK (type IN ('purchase', 'inventory')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'completed')),
  supplier_name TEXT,
  comment TEXT,
  created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS warehouse_document_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id INTEGER NOT NULL REFERENCES warehouse_documents(id) ON DELETE RESTRICT,
  product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  product_name TEXT NOT NULL,
  expected_quantity INTEGER CHECK (expected_quantity IS NULL OR expected_quantity >= 0),
  actual_quantity INTEGER NOT NULL CHECK (actual_quantity >= 0),
  purchase_price INTEGER CHECK (purchase_price IS NULL OR purchase_price >= 0),
  retail_price INTEGER CHECK (retail_price IS NULL OR retail_price >= 0)
);

CREATE TABLE IF NOT EXISTS stock_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  product_name TEXT NOT NULL,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  type TEXT NOT NULL CHECK (type IN ('purchase', 'sale', 'inventory_adjustment', 'manual_correction')),
  quantity_change INTEGER NOT NULL,
  stock_before INTEGER NOT NULL CHECK (stock_before >= 0),
  stock_after INTEGER NOT NULL CHECK (stock_after >= 0),
  reference_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (stock_after = stock_before + quantity_change)
);

CREATE INDEX IF NOT EXISTS idx_warehouse_documents_created ON warehouse_documents(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_warehouse_documents_type_status ON warehouse_documents(type, status);
CREATE INDEX IF NOT EXISTS idx_warehouse_document_items_document ON warehouse_document_items(document_id);
CREATE INDEX IF NOT EXISTS idx_stock_history_product_created ON stock_history(product_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stock_history_reference ON stock_history(type, reference_id);
