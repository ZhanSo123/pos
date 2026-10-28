ALTER TABLE products ADD COLUMN low_stock_threshold REAL NOT NULL DEFAULT 5 CHECK (low_stock_threshold >= 0);
ALTER TABLE sales ADD COLUMN subtotal_amount INTEGER NOT NULL DEFAULT 0 CHECK (subtotal_amount >= 0);
ALTER TABLE sales ADD COLUMN discount_amount INTEGER NOT NULL DEFAULT 0 CHECK (discount_amount >= 0);
ALTER TABLE sales ADD COLUMN discount_reason TEXT;
UPDATE sales SET subtotal_amount = total_amount WHERE subtotal_amount = 0;
