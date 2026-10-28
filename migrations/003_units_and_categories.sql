CREATE TABLE products_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 200),
  sku TEXT COLLATE NOCASE UNIQUE,
  purchase_price INTEGER NOT NULL CHECK (purchase_price >= 0),
  retail_price INTEGER NOT NULL CHECK (retail_price >= 0),
  stock_quantity REAL NOT NULL DEFAULT 0 CHECK (stock_quantity >= 0),
  size TEXT,
  unit TEXT NOT NULL DEFAULT 'pcs' CHECK (unit IN ('pcs', 'm')),
  category TEXT NOT NULL DEFAULT 'Общая' CHECK (length(trim(category)) BETWEEN 1 AND 100),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
INSERT INTO products_new (id, name, sku, purchase_price, retail_price, stock_quantity, size, unit, category, created_at, updated_at)
SELECT id, name, sku, purchase_price, retail_price, stock_quantity, size, 'pcs', 'Общая', created_at, updated_at FROM products;
DROP TABLE products;
ALTER TABLE products_new RENAME TO products;
CREATE INDEX IF NOT EXISTS idx_products_name ON products(name);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category COLLATE NOCASE);

CREATE TABLE sale_items_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE RESTRICT,
  product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  product_name TEXT NOT NULL,
  quantity REAL NOT NULL CHECK (quantity > 0),
  price_at_sale INTEGER NOT NULL CHECK (price_at_sale >= 0),
  cost_price_at_sale INTEGER NOT NULL CHECK (cost_price_at_sale >= 0)
);
INSERT INTO sale_items_new (id, sale_id, product_id, product_name, quantity, price_at_sale, cost_price_at_sale)
SELECT id, sale_id, product_id, product_name, quantity, price_at_sale, cost_price_at_sale FROM sale_items;
DROP TABLE sale_items;
ALTER TABLE sale_items_new RENAME TO sale_items;
CREATE INDEX IF NOT EXISTS idx_sale_items_sale ON sale_items(sale_id);

CREATE TABLE warehouse_document_items_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id INTEGER NOT NULL REFERENCES warehouse_documents(id) ON DELETE RESTRICT,
  product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  product_name TEXT NOT NULL,
  expected_quantity REAL CHECK (expected_quantity IS NULL OR expected_quantity >= 0),
  actual_quantity REAL NOT NULL CHECK (actual_quantity >= 0),
  purchase_price INTEGER CHECK (purchase_price IS NULL OR purchase_price >= 0),
  retail_price INTEGER CHECK (retail_price IS NULL OR retail_price >= 0)
);
INSERT INTO warehouse_document_items_new (id, document_id, product_id, product_name, expected_quantity, actual_quantity, purchase_price, retail_price)
SELECT id, document_id, product_id, product_name, expected_quantity, actual_quantity, purchase_price, retail_price FROM warehouse_document_items;
DROP TABLE warehouse_document_items;
ALTER TABLE warehouse_document_items_new RENAME TO warehouse_document_items;
CREATE INDEX IF NOT EXISTS idx_warehouse_document_items_document ON warehouse_document_items(document_id);

CREATE TABLE stock_history_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  product_name TEXT NOT NULL,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  type TEXT NOT NULL CHECK (type IN ('purchase', 'sale', 'inventory_adjustment', 'manual_correction')),
  quantity_change REAL NOT NULL,
  stock_before REAL NOT NULL CHECK (stock_before >= 0),
  stock_after REAL NOT NULL CHECK (stock_after >= 0),
  reference_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (ABS(stock_after - (stock_before + quantity_change)) < 0.000001)
);
INSERT INTO stock_history_new (id, product_id, product_name, user_id, type, quantity_change, stock_before, stock_after, reference_id, created_at)
SELECT id, product_id, product_name, user_id, type, quantity_change, stock_before, stock_after, reference_id, created_at FROM stock_history;
DROP TABLE stock_history;
ALTER TABLE stock_history_new RENAME TO stock_history;
CREATE INDEX IF NOT EXISTS idx_stock_history_product_created ON stock_history(product_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stock_history_reference ON stock_history(type, reference_id);
