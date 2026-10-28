CREATE TABLE customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 200),
  phone TEXT,
  debt_amount INTEGER NOT NULL DEFAULT 0 CHECK (debt_amount >= 0),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_customers_name ON customers(name COLLATE NOCASE);
CREATE INDEX idx_customers_phone ON customers(phone);

ALTER TABLE products ADD COLUMN image_url TEXT;
ALTER TABLE shifts ADD COLUMN revenue_debt INTEGER NOT NULL DEFAULT 0 CHECK (revenue_debt >= 0);

CREATE TABLE sales_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cashier_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  shift_id INTEGER REFERENCES shifts(id) ON DELETE RESTRICT,
  customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  total_amount INTEGER NOT NULL CHECK (total_amount >= 0),
  payment_type TEXT NOT NULL CHECK (payment_type IN ('cash', 'card', 'debt')),
  cash_received INTEGER NOT NULL DEFAULT 0 CHECK (cash_received >= 0),
  change_amount INTEGER NOT NULL DEFAULT 0 CHECK (change_amount >= 0),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
INSERT INTO sales_new (id, cashier_id, shift_id, total_amount, payment_type, cash_received, change_amount, created_at)
SELECT id, cashier_id, shift_id, total_amount, payment_type, cash_received, change_amount, created_at FROM sales;
DROP TABLE sales;
ALTER TABLE sales_new RENAME TO sales;
CREATE INDEX idx_sales_created_at ON sales(created_at);
CREATE INDEX idx_sales_cashier_created ON sales(cashier_id, created_at);
CREATE INDEX idx_sales_shift ON sales(shift_id);
CREATE INDEX idx_sales_customer ON sales(customer_id);

CREATE TABLE debt_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  cashier_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  shift_id INTEGER REFERENCES shifts(id) ON DELETE RESTRICT,
  payment_type TEXT NOT NULL CHECK (payment_type IN ('cash', 'card')),
  amount INTEGER NOT NULL CHECK (amount > 0),
  cash_received INTEGER NOT NULL DEFAULT 0 CHECK (cash_received >= 0),
  change_amount INTEGER NOT NULL DEFAULT 0 CHECK (change_amount >= 0),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_debt_payments_customer_created ON debt_payments(customer_id, created_at DESC);
CREATE INDEX idx_debt_payments_shift ON debt_payments(shift_id);
