CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL COLLATE NOCASE UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('cashier', 'admin')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 200),
  sku TEXT COLLATE NOCASE UNIQUE,
  purchase_price INTEGER NOT NULL CHECK (purchase_price >= 0),
  retail_price INTEGER NOT NULL CHECK (retail_price >= 0),
  stock_quantity INTEGER NOT NULL DEFAULT 0 CHECK (stock_quantity >= 0),
  size TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS shifts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cashier_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  opened_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  closed_at TEXT,
  revenue_cash INTEGER NOT NULL DEFAULT 0 CHECK (revenue_cash >= 0),
  revenue_card INTEGER NOT NULL DEFAULT 0 CHECK (revenue_card >= 0),
  total_revenue INTEGER NOT NULL DEFAULT 0 CHECK (total_revenue >= 0),
  net_profit INTEGER NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_shifts_one_open_per_cashier
  ON shifts(cashier_id) WHERE closed_at IS NULL;

CREATE TABLE IF NOT EXISTS sales (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cashier_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  shift_id INTEGER REFERENCES shifts(id) ON DELETE RESTRICT,
  total_amount INTEGER NOT NULL CHECK (total_amount >= 0),
  payment_type TEXT NOT NULL CHECK (payment_type IN ('cash', 'card')),
  cash_received INTEGER NOT NULL DEFAULT 0 CHECK (cash_received >= 0),
  change_amount INTEGER NOT NULL DEFAULT 0 CHECK (change_amount >= 0),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS sale_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE RESTRICT,
  product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  product_name TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  price_at_sale INTEGER NOT NULL CHECK (price_at_sale >= 0),
  cost_price_at_sale INTEGER NOT NULL CHECK (cost_price_at_sale >= 0)
);

CREATE INDEX IF NOT EXISTS idx_sales_created_at ON sales(created_at);
CREATE INDEX IF NOT EXISTS idx_sales_cashier_created ON sales(cashier_id, created_at);
CREATE INDEX IF NOT EXISTS idx_sales_shift ON sales(shift_id);
CREATE INDEX IF NOT EXISTS idx_sale_items_sale ON sale_items(sale_id);
CREATE INDEX IF NOT EXISTS idx_products_name ON products(name);
