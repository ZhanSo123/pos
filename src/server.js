require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { z } = require('zod');
const db = require('./db');

const app = express();
const port = Number(process.env.PORT || 3000);
const appTimeZone = process.env.APP_TIME_ZONE || 'Asia/Aqtau';
const datePartsFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: appTimeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
const dateTimePartsFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: appTimeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
const jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret || jwtSecret.length < 32) {
  console.error('JWT_SECRET is required and must be at least 32 characters. Set it in .env.');
  process.exit(1);
}

app.disable('x-powered-by');
app.use(helmet());
const allowedOrigins = (process.env.CORS_ORIGIN || '').split(',').map(value => value.trim()).filter(Boolean);
app.use(cors({ origin(origin, callback) {
  if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
  const developmentOrigins = ['http://localhost:5173', 'http://127.0.0.1:5173'];
  if (!allowedOrigins.length && process.env.NODE_ENV !== 'production' && developmentOrigins.includes(origin)) return callback(null, true);
  return callback(new Error('Origin is not allowed by CORS'));
} }));
app.use(express.json({ limit: '100kb' }));

const asyncRoute = handler => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
const money = z.number().finite().min(0).max(100000000000).transform(value => Math.round(value * 100));
const productInput = z.object({
  name: z.string().trim().min(1).max(200),
  sku: z.string().trim().max(100).optional().nullable().transform(value => value || null),
  purchase_price: money,
  retail_price: money,
  stock_quantity: z.number().finite().min(0).max(1000000000),
  size: z.string().trim().max(100).optional().nullable().transform(value => value || null),
  unit: z.enum(['pcs', 'm']).default('pcs'),
  category: z.string().trim().min(1).max(100).default('Общая'),
  image_url: z.string().trim().max(2000).optional().nullable().transform(value => value || null),
  low_stock_threshold: z.number().finite().min(0).max(1000000000).default(5)
}).strict().superRefine((value, context) => {
  if (Math.abs(value.stock_quantity * 1000 - Math.round(value.stock_quantity * 1000)) > 0.0000001) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Остаток можно указать максимум с тремя знаками после запятой.', path: ['stock_quantity'] });
  if (Math.abs(value.low_stock_threshold * 1000 - Math.round(value.low_stock_threshold * 1000)) > 0.0000001) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Порог остатка можно указать максимум с тремя знаками после запятой.', path: ['low_stock_threshold'] });
  if (value.unit === 'pcs' && !Number.isInteger(value.stock_quantity)) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Для штучного товара остаток должен быть целым числом.', path: ['stock_quantity'] });
  if (value.unit === 'pcs' && !Number.isInteger(value.low_stock_threshold)) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Порог остатка для штучного товара должен быть целым числом.', path: ['low_stock_threshold'] });
});

function dateInZone(date) {
  const parts = Object.fromEntries(datePartsFormatter.formatToParts(date).filter(p => p.type !== 'literal').map(p => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
function zonedMidnightUtc(value) {
  const [year, month, day] = value.split('-').map(Number);
  const target = Date.UTC(year, month - 1, day);
  let instant = target;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = Object.fromEntries(dateTimePartsFormatter.formatToParts(new Date(instant)).filter(p => p.type !== 'literal').map(p => [p.type, Number(p.value)]));
    instant += target - Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  }
  return new Date(instant).toISOString().replace('Z', '+00:00');
}
const oracleTimestamp = bind => `TO_TIMESTAMP_TZ(:${bind}, 'YYYY-MM-DD"T"HH24:MI:SS.FF3TZH:TZM')`;
function nextDay(value) { const date = new Date(`${value}T00:00:00.000Z`); date.setUTCDate(date.getUTCDate() + 1); return date.toISOString().slice(0, 10); }
function nextMonth(value) { const date = new Date(`${value}T00:00:00.000Z`); date.setUTCMonth(date.getUTCMonth() + 1); return date.toISOString().slice(0, 10); }
function addDays(value, amount) { const date = new Date(`${value}T00:00:00.000Z`); date.setUTCDate(date.getUTCDate() + amount); return date.toISOString().slice(0, 10); }
function parseId(value) { const id = Number(value); return Number.isSafeInteger(id) && id > 0 ? id : null; }
function httpError(status, message) { const error = new Error(message); error.status = status; return error; }
function isUnique(error) { return error.errorNum === 1 || error.code === 'ORA-00001'; }
function checkQuantity(unit, quantity, label) {
  if (Math.abs(quantity * 1000 - Math.round(quantity * 1000)) > 0.0000001) throw httpError(400, `Для товара «${label}» количество можно указать максимум с тремя знаками после запятой.`);
  if (unit === 'pcs' && !Number.isInteger(quantity)) throw httpError(400, `Для товара «${label}» количество должно быть целым числом.`);
}
const roles = (...allowed) => (req, res, next) => allowed.includes(req.user.role) ? next() : res.status(403).json({ error: 'Недостаточно прав.' });

const auth = asyncRoute(async (req, res, next) => {
  const match = /^Bearer\s+(.+)$/i.exec(req.get('authorization') || '');
  if (!match) return res.status(401).json({ error: 'Требуется авторизация.' });
  let claims;
  try { claims = jwt.verify(match[1], jwtSecret); }
  catch { return res.status(401).json({ error: 'Сессия недействительна или истекла.' }); }
  const userId = parseId(claims.sub);
  const user = userId ? await db.get('SELECT id, username, role FROM users WHERE id=:id', { id: userId }) : null;
  if (!user) return res.status(401).json({ error: 'Пользователь больше недоступен. Войдите снова.' });
  req.user = { ...claims, sub: String(user.id), username: user.username, role: user.role };
  next();
});

async function productById(id, connection = null) {
  return db.get(`SELECT id, name, sku, purchase_price / 100 AS purchase_price, retail_price / 100 AS retail_price,
    stock_quantity, low_stock_threshold, size_label AS "size", unit, category, image_url, created_at, updated_at
    FROM products WHERE id=:id`, { id }, connection);
}
async function customerById(id, connection = null) {
  return db.get('SELECT id, name, phone, debt_amount / 100 AS debt_amount, created_at FROM customers WHERE id=:id', { id }, connection);
}
async function warehouseDocumentById(id, connection = null) {
  const document = await db.get(`SELECT d.id, d.type, d.status, d.supplier_name, d.comment_text AS "comment", d.created_by,
    d.created_at, d.completed_at, u.username AS created_by_username FROM warehouse_documents d
    JOIN users u ON u.id=d.created_by WHERE d.id=:id`, { id }, connection);
  if (!document) return null;
  document.items = await db.all(`SELECT id, document_id, product_id, product_name, expected_quantity, actual_quantity,
    purchase_price / 100 AS purchase_price, retail_price / 100 AS retail_price
    FROM warehouse_document_items WHERE document_id=:id ORDER BY id`, { id }, connection);
  return document;
}

app.get('/api/health', asyncRoute(async (req, res) => {
  await db.get('SELECT 1 AS ok FROM dual');
  res.json({ status: 'ok', database: 'oracle', time_zone: appTimeZone });
}));

app.post('/api/auth/login', asyncRoute(async (req, res) => {
  const parsed = z.object({ username: z.string().trim().min(1).max(50), password: z.string().min(1).max(200) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Укажите имя пользователя и пароль.' });
  const user = await db.get('SELECT id, username, password_hash, role FROM users WHERE UPPER(username)=UPPER(:username)', { username: parsed.data.username });
  if (!user || !(await bcrypt.compare(parsed.data.password, user.password_hash))) return res.status(401).json({ error: 'Неверное имя пользователя или пароль.' });
  const expiresIn = process.env.JWT_EXPIRES_IN || '8h';
  const token = jwt.sign({ sub: String(user.id), username: user.username, role: user.role }, jwtSecret, { expiresIn });
  res.json({ token, token_type: 'Bearer', expires_in: expiresIn, user: { id: user.id, username: user.username, role: user.role } });
}));
app.get('/api/auth/me', auth, (req, res) => res.json({ user: { id: Number(req.user.sub), username: req.user.username, role: req.user.role } }));

const customerInput = z.object({ name: z.string().trim().min(1).max(200), phone: z.string().trim().max(50).optional().nullable().transform(value => value || null) }).strict();
app.get('/api/customers', auth, asyncRoute(async (req, res) => {
  const search = typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 100) : '';
  const customers = await db.all(`SELECT id, name, phone, debt_amount / 100 AS debt_amount, created_at FROM customers
    ${search ? 'WHERE INSTR(UPPER(name), UPPER(:search)) > 0 OR INSTR(UPPER(NVL(phone, \' \')), UPPER(:search)) > 0' : ''}
    ORDER BY UPPER(name)`, search ? { search } : {});
  res.json({ customers });
}));
app.get('/api/customers/:id/debt-history', auth, asyncRoute(async (req, res) => {
  const customerId = parseId(req.params.id);
  const parsed = z.object({ limit: z.coerce.number().int().min(1).max(100).default(50) }).strict().safeParse(req.query);
  if (!customerId || !parsed.success) return res.status(400).json({ error: 'Некорректные параметры истории оплат.' });
  const customer = await customerById(customerId);
  if (!customer) return res.status(404).json({ error: 'Клиент не найден.' });
  const transactions = await db.all(`SELECT * FROM (
      SELECT s.id, 'debt' AS type, s.payment_type, s.total_amount / 100 AS amount, 0 AS change_amount,
        s.created_at, s.cashier_id, u.username AS cashier_name, s.id AS receipt_id
      FROM sales s JOIN users u ON u.id=s.cashier_id WHERE s.customer_id=:customer_id AND s.payment_type='debt'
      UNION ALL
      SELECT dp.id, 'payment' AS type, dp.payment_type, dp.amount / 100 AS amount, dp.change_amount / 100 AS change_amount,
        dp.created_at, dp.cashier_id, u.username AS cashier_name, CAST(NULL AS NUMBER) AS receipt_id
      FROM debt_payments dp JOIN users u ON u.id=dp.cashier_id WHERE dp.customer_id=:customer_id
    ) ORDER BY created_at DESC, id DESC FETCH FIRST :limit ROWS ONLY`, { customer_id: customerId, limit: parsed.data.limit });
  res.json({ customer, transactions });
}));
app.post('/api/customers', auth, asyncRoute(async (req, res) => {
  const parsed = customerInput.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Укажите корректное имя клиента.', details: parsed.error.flatten() });
  const id = await db.insert('INSERT INTO customers (name, phone) VALUES (:name, :phone)', parsed.data);
  res.status(201).json({ customer: await customerById(id) });
}));

const debtPaymentInput = z.object({ payment_type: z.enum(['cash', 'card']), amount: z.number().finite().positive().max(100000000000), cash_received: z.number().finite().min(0).max(100000000000).optional() }).strict();
app.post('/api/customers/:id/pay-debt', auth, asyncRoute(async (req, res) => {
  const customerId = parseId(req.params.id); const parsed = debtPaymentInput.safeParse(req.body);
  if (!customerId || !parsed.success) return res.status(400).json({ error: 'Некорректные данные оплаты долга.', details: parsed.success ? undefined : parsed.error.flatten() });
  try {
    const payment = await db.transaction(async connection => {
      const customer = await db.get('SELECT * FROM customers WHERE id=:id FOR UPDATE', { id: customerId }, connection);
      if (!customer) throw httpError(404, 'Клиент не найден.');
      const shift = await db.get('SELECT id FROM shifts WHERE cashier_id=:cashier_id AND closed_at IS NULL FOR UPDATE', { cashier_id: Number(req.user.sub) }, connection);
      if (!shift) throw httpError(409, 'Сначала откройте смену кассира.');
      const amount = Math.round(parsed.data.amount * 100);
      if (amount <= 0) throw httpError(400, 'Сумма оплаты слишком мала.');
      if (amount > customer.debt_amount) throw httpError(409, `Сумма оплаты превышает долг. Текущий долг: ${(customer.debt_amount / 100).toFixed(2)}.`);
      const received = parsed.data.payment_type === 'cash' ? Math.round((parsed.data.cash_received ?? parsed.data.amount) * 100) : amount;
      if (parsed.data.payment_type === 'cash' && received < amount) throw httpError(400, 'Полученная сумма меньше суммы оплаты долга.');
      const change = parsed.data.payment_type === 'cash' ? received - amount : 0;
      await db.execute('UPDATE customers SET debt_amount=debt_amount-:amount WHERE id=:id', { amount, id: customerId }, connection);
      const id = await db.insert(`INSERT INTO debt_payments (customer_id, cashier_id, shift_id, payment_type, amount, cash_received, change_amount)
        VALUES (:customer_id, :cashier_id, :shift_id, :payment_type, :amount, :cash_received, :change_amount)`, {
        customer_id: customerId, cashier_id: Number(req.user.sub), shift_id: shift.id, payment_type: parsed.data.payment_type,
        amount, cash_received: received, change_amount: change
      }, connection);
      return { id, customer: await customerById(customerId, connection), payment_type: parsed.data.payment_type, amount: amount / 100, cash_received: received / 100, change_amount: change / 100 };
    });
    res.status(201).json({ payment });
  } catch (error) { if (error.status) return res.status(error.status).json({ error: error.message }); throw error; }
}));

app.get('/api/products', auth, asyncRoute(async (req, res) => {
  const parsed = z.object({ search: z.string().trim().max(100).optional(), sku: z.string().trim().max(100).optional(), category: z.string().trim().max(100).optional(), in_stock: z.enum(['true', 'false']).optional(), low_stock: z.enum(['true', 'false']).optional() }).safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: 'Параметры поиска имеют неверный формат.' });
  const where = []; const binds = {};
  if (parsed.data.search) { where.push('(INSTR(UPPER(name), UPPER(:search)) > 0 OR INSTR(UPPER(NVL(sku, \' \')), UPPER(:search)) > 0)'); binds.search = parsed.data.search; }
  if (parsed.data.sku) { where.push('UPPER(sku)=UPPER(:sku)'); binds.sku = parsed.data.sku; }
  if (parsed.data.category) { where.push('UPPER(category)=UPPER(:category)'); binds.category = parsed.data.category; }
  if (parsed.data.in_stock === 'true') where.push('stock_quantity > 0');
  if (parsed.data.in_stock === 'false') where.push('stock_quantity = 0');
  if (parsed.data.low_stock === 'true') where.push('stock_quantity <= low_stock_threshold');
  if (parsed.data.low_stock === 'false') where.push('stock_quantity > low_stock_threshold');
  const costField = req.user.role === 'admin' ? 'purchase_price / 100 AS purchase_price, ' : '';
  const products = await db.all(`SELECT id, name, sku, ${costField}retail_price / 100 AS retail_price, stock_quantity,
    low_stock_threshold, size_label AS "size", unit, category, image_url, created_at, updated_at FROM products
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY UPPER(name)`, binds);
  res.json({ products });
}));
app.post('/api/products', auth, roles('admin'), asyncRoute(async (req, res) => {
  const parsed = productInput.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Некорректные данные товара.', details: parsed.error.flatten() });
  try {
    const data = parsed.data;
    const id = await db.transaction(async connection => {
      const productId = await db.insert(`INSERT INTO products (name, sku, purchase_price, retail_price, stock_quantity, size_label, unit, category, image_url, low_stock_threshold)
        VALUES (:name, :sku, :purchase_price, :retail_price, :stock_quantity, :size, :unit, :category, :image_url, :low_stock_threshold)`, data, connection);
      if (data.stock_quantity > 0) await db.insert(`INSERT INTO stock_history (product_id, product_name, user_id, type, quantity_change, stock_before, stock_after)
        VALUES (:product_id, :product_name, :user_id, 'manual_correction', :quantity_change, 0, :stock_after)`, {
        product_id: productId, product_name: data.name, user_id: Number(req.user.sub), quantity_change: data.stock_quantity, stock_after: data.stock_quantity
      }, connection);
      return productId;
    });
    res.status(201).json({ product: await productById(id) });
  } catch (error) { if (isUnique(error)) return res.status(409).json({ error: 'Такой SKU уже существует.' }); throw error; }
}));
app.put('/api/products/:id', auth, roles('admin'), asyncRoute(async (req, res) => {
  const id = parseId(req.params.id); const parsed = productInput.safeParse(req.body);
  if (!id || !parsed.success) return res.status(400).json({ error: 'Некорректный идентификатор или данные товара.', details: parsed.success ? undefined : parsed.error.flatten() });
  try {
    await db.transaction(async connection => {
      const before = await db.get('SELECT stock_quantity FROM products WHERE id=:id FOR UPDATE', { id }, connection);
      if (!before) throw httpError(404, 'Товар не найден.');
      const data = parsed.data;
      await db.execute(`UPDATE products SET name=:name, sku=:sku, purchase_price=:purchase_price, retail_price=:retail_price,
        stock_quantity=:stock_quantity, size_label=:size, unit=:unit, category=:category, image_url=:image_url,
        low_stock_threshold=:low_stock_threshold, updated_at=SYSTIMESTAMP WHERE id=:id`, { ...data, id }, connection);
      const delta = data.stock_quantity - before.stock_quantity;
      if (Math.abs(delta) > 0.000001) await db.insert(`INSERT INTO stock_history (product_id, product_name, user_id, type, quantity_change, stock_before, stock_after)
        VALUES (:id, :name, :user_id, 'manual_correction', :delta, :before, :after)`, {
        id, name: data.name, user_id: Number(req.user.sub), delta, before: before.stock_quantity, after: data.stock_quantity
      }, connection);
    });
    res.json({ product: await productById(id) });
  } catch (error) { if (isUnique(error)) return res.status(409).json({ error: 'Такой SKU уже существует.' }); if (error.status) return res.status(error.status).json({ error: error.message }); throw error; }
}));
app.delete('/api/products/:id', auth, roles('admin'), asyncRoute(async (req, res) => {
  const id = parseId(req.params.id); if (!id) return res.status(400).json({ error: 'Некорректный идентификатор товара.' });
  const result = await db.execute('DELETE FROM products WHERE id=:id', { id });
  if (!result.rowsAffected) return res.status(404).json({ error: 'Товар не найден.' });
  res.status(204).end();
}));

const warehouseDocumentQuery = z.object({ type: z.enum(['purchase', 'inventory']).optional(), status: z.enum(['draft', 'completed']).optional(), limit: z.coerce.number().int().min(1).max(100).default(50), offset: z.coerce.number().int().min(0).default(0) }).strict();
const purchaseDocumentInput = z.object({
  supplier_name: z.string().trim().max(200).optional().nullable().transform(value => value || null),
  comment: z.string().trim().max(2000).optional().nullable().transform(value => value || null),
  items: z.array(z.object({ product_id: z.number().int().positive(), quantity: z.number().finite().positive().max(1000000000), purchase_price: money, retail_price: money }).strict()).min(1).max(500)
}).strict().superRefine((value, context) => { if (new Set(value.items.map(item => item.product_id)).size !== value.items.length) context.addIssue({ code: z.ZodIssueCode.custom, message: 'В документе нельзя повторять товар.', path: ['items'] }); });
const inventoryInput = z.object({ comment: z.string().trim().max(2000).optional().nullable().transform(value => value || null), items: z.array(z.object({ product_id: z.number().int().positive(), actual_quantity: z.number().finite().min(0).max(1000000000) }).strict()).min(1).max(500) }).strict().superRefine((value, context) => { if (new Set(value.items.map(item => item.product_id)).size !== value.items.length) context.addIssue({ code: z.ZodIssueCode.custom, message: 'В инвентаризации нельзя повторять товар.', path: ['items'] }); });

app.get('/api/warehouse/documents', auth, roles('admin'), asyncRoute(async (req, res) => {
  const parsed = warehouseDocumentQuery.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: 'Некорректные фильтры документов.', details: parsed.error.flatten() });
  const where = []; const binds = { limit: parsed.data.limit, offset: parsed.data.offset };
  if (parsed.data.type) { where.push('d.type=:type'); binds.type = parsed.data.type; }
  if (parsed.data.status) { where.push('d.status=:status'); binds.status = parsed.data.status; }
  const rows = await db.all(`SELECT d.id FROM warehouse_documents d ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY d.id DESC OFFSET :offset ROWS FETCH NEXT :limit ROWS ONLY`, binds);
  const documents = await Promise.all(rows.map(row => warehouseDocumentById(row.id)));
  res.json({ documents, limit: parsed.data.limit, offset: parsed.data.offset });
}));
app.post('/api/warehouse/documents', auth, roles('admin'), asyncRoute(async (req, res) => {
  const parsed = purchaseDocumentInput.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Некорректные данные приходного документа.', details: parsed.error.flatten() });
  try {
    const id = await db.transaction(async connection => {
      const documentId = await db.insert(`INSERT INTO warehouse_documents (type, status, supplier_name, comment_text, created_by)
        VALUES ('purchase', 'draft', :supplier_name, :comment, :created_by)`, { ...parsed.data, created_by: Number(req.user.sub) }, connection);
      for (const item of parsed.data.items) {
        const product = await db.get('SELECT id, name, unit FROM products WHERE id=:id', { id: item.product_id }, connection);
        if (!product) throw httpError(404, `Товар с id ${item.product_id} не найден.`);
        checkQuantity(product.unit, item.quantity, product.name);
        await db.insert(`INSERT INTO warehouse_document_items (document_id, product_id, product_name, expected_quantity, actual_quantity, purchase_price, retail_price)
          VALUES (:document_id, :product_id, :product_name, NULL, :quantity, :purchase_price, :retail_price)`, {
          document_id: documentId, product_id: product.id, product_name: product.name, quantity: item.quantity, purchase_price: item.purchase_price, retail_price: item.retail_price
        }, connection);
      }
      return documentId;
    });
    res.status(201).json({ document: await warehouseDocumentById(id) });
  } catch (error) { if (error.status) return res.status(error.status).json({ error: error.message }); throw error; }
}));
app.post('/api/warehouse/documents/:id/complete', auth, roles('admin'), asyncRoute(async (req, res) => {
  const id = parseId(req.params.id); if (!id) return res.status(400).json({ error: 'Некорректный идентификатор документа.' });
  try {
    await db.transaction(async connection => {
      const document = await db.get('SELECT * FROM warehouse_documents WHERE id=:id FOR UPDATE', { id }, connection);
      if (!document) throw httpError(404, 'Складской документ не найден.');
      if (document.type !== 'purchase') throw httpError(409, 'Проведение доступно только для приходного документа.');
      if (document.status !== 'draft') throw httpError(409, 'Документ уже проведён.');
      const items = await db.all('SELECT * FROM warehouse_document_items WHERE document_id=:id ORDER BY id', { id }, connection);
      if (!items.length) throw httpError(409, 'Нельзя провести пустой документ.');
      for (const item of items) {
        if (!item.product_id) throw httpError(409, `Товар «${item.product_name}» удалён и не может быть принят на склад.`);
        const product = await db.get('SELECT id, name, unit, stock_quantity FROM products WHERE id=:id FOR UPDATE', { id: item.product_id }, connection);
        if (!product) throw httpError(409, `Товар «${item.product_name}» не найден.`);
        checkQuantity(product.unit, item.actual_quantity, product.name);
        const after = product.stock_quantity + item.actual_quantity;
        if (after > 1000000000) throw httpError(400, `Остаток товара «${product.name}» превышает допустимый лимит.`);
        await db.execute('UPDATE products SET stock_quantity=:stock, purchase_price=:purchase, retail_price=:retail, updated_at=SYSTIMESTAMP WHERE id=:id', { stock: after, purchase: item.purchase_price, retail: item.retail_price, id: product.id }, connection);
        await db.insert(`INSERT INTO stock_history (product_id, product_name, user_id, type, quantity_change, stock_before, stock_after, reference_id)
          VALUES (:product_id, :name, :user_id, 'purchase', :quantity, :before, :after, :reference_id)`, {
          product_id: product.id, name: product.name, user_id: Number(req.user.sub), quantity: item.actual_quantity, before: product.stock_quantity, after, reference_id: id
        }, connection);
      }
      await db.execute("UPDATE warehouse_documents SET status='completed', completed_at=SYSTIMESTAMP WHERE id=:id", { id }, connection);
    });
    res.json({ document: await warehouseDocumentById(id) });
  } catch (error) { if (error.status) return res.status(error.status).json({ error: error.message }); throw error; }
}));
app.post('/api/warehouse/inventory', auth, roles('admin'), asyncRoute(async (req, res) => {
  const parsed = inventoryInput.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Некорректные данные инвентаризации.', details: parsed.error.flatten() });
  try {
    const id = await db.transaction(async connection => {
      const documentId = await db.insert(`INSERT INTO warehouse_documents (type, status, comment_text, created_by, completed_at)
        VALUES ('inventory', 'completed', :comment, :created_by, SYSTIMESTAMP)`, { comment: parsed.data.comment, created_by: Number(req.user.sub) }, connection);
      for (const item of [...parsed.data.items].sort((a, b) => a.product_id - b.product_id)) {
        const product = await db.get('SELECT id, name, unit, stock_quantity, purchase_price, retail_price FROM products WHERE id=:id FOR UPDATE', { id: item.product_id }, connection);
        if (!product) throw httpError(404, `Товар с id ${item.product_id} не найден.`);
        checkQuantity(product.unit, item.actual_quantity, product.name);
        const difference = item.actual_quantity - product.stock_quantity;
        await db.insert(`INSERT INTO warehouse_document_items (document_id, product_id, product_name, expected_quantity, actual_quantity, purchase_price, retail_price)
          VALUES (:document_id, :product_id, :product_name, :expected, :actual, :purchase, :retail)`, {
          document_id: documentId, product_id: product.id, product_name: product.name, expected: product.stock_quantity, actual: item.actual_quantity, purchase: product.purchase_price, retail: product.retail_price
        }, connection);
        if (Math.abs(difference) > 0.000001) {
          await db.execute('UPDATE products SET stock_quantity=:actual, updated_at=SYSTIMESTAMP WHERE id=:id', { actual: item.actual_quantity, id: product.id }, connection);
          await db.insert(`INSERT INTO stock_history (product_id, product_name, user_id, type, quantity_change, stock_before, stock_after, reference_id)
            VALUES (:product_id, :name, :user_id, 'inventory_adjustment', :delta, :before, :after, :reference_id)`, {
            product_id: product.id, name: product.name, user_id: Number(req.user.sub), delta: difference, before: product.stock_quantity, after: item.actual_quantity, reference_id: documentId
          }, connection);
        }
      }
      return documentId;
    });
    res.status(201).json({ document: await warehouseDocumentById(id) });
  } catch (error) { if (error.status) return res.status(error.status).json({ error: error.message }); throw error; }
}));
app.get('/api/warehouse/products/:id/history', auth, roles('admin'), asyncRoute(async (req, res) => {
  const productId = parseId(req.params.id); if (!productId) return res.status(400).json({ error: 'Некорректный идентификатор товара.' });
  const product = await db.get('SELECT id, name FROM products WHERE id=:id', { id: productId });
  if (!product) return res.status(404).json({ error: 'Товар не найден.' });
  const history = await db.all(`SELECT h.id, h.product_id, h.product_name, h.user_id, u.username, h.type, h.quantity_change,
    h.stock_before, h.stock_after, h.reference_id, h.created_at FROM stock_history h LEFT JOIN users u ON u.id=h.user_id
    WHERE h.product_id=:id ORDER BY h.id DESC`, { id: productId });
  res.json({ product, history });
}));

const saleInput = z.object({
  payment_type: z.enum(['cash', 'card', 'debt']), customer_id: z.number().int().positive().optional(),
  discount_percent: z.number().finite().min(0).max(100).default(0), discount_reason: z.string().trim().max(200).optional().nullable(),
  cash_received: z.number().finite().min(0).max(100000000000).optional(),
  items: z.array(z.object({ product_id: z.number().int().positive(), quantity: z.number().finite().positive().max(1000000) }).strict()).min(1).max(500)
}).strict();
async function createSale(cashierId, payload, role) {
  if (payload.discount_percent > 0 && role !== 'admin') throw httpError(403, 'Применять скидку может только администратор.');
  return db.transaction(async connection => {
    await db.get('SELECT id FROM users WHERE id=:id FOR UPDATE', { id: cashierId }, connection);
    const shift = await db.get('SELECT id FROM shifts WHERE cashier_id=:cashier_id AND closed_at IS NULL FOR UPDATE', { cashier_id: cashierId }, connection);
    if (!shift) throw httpError(409, 'Сначала откройте смену кассира.');
    const quantities = new Map();
    for (const item of payload.items) quantities.set(item.product_id, (quantities.get(item.product_id) || 0) + item.quantity);
    const products = [];
    for (const [productId, quantity] of [...quantities.entries()].sort(([a], [b]) => a - b)) {
      const product = await db.get('SELECT id, name, unit, retail_price, purchase_price, stock_quantity FROM products WHERE id=:id FOR UPDATE', { id: productId }, connection);
      if (!product) throw httpError(404, `Товар с id ${productId} не найден.`);
      checkQuantity(product.unit, quantity, product.name);
      if (product.stock_quantity < quantity) throw httpError(409, `Недостаточно товара «${product.name}» на складе. Остаток: ${product.stock_quantity}.`);
      products.push({ ...product, quantity });
    }
    const subtotal = Math.round(products.reduce((sum, product) => sum + product.retail_price * product.quantity, 0));
    const discount = Math.min(subtotal, Math.round(subtotal * payload.discount_percent / 100));
    const total = subtotal - discount;
    if (payload.discount_percent > 0 && !payload.discount_reason?.trim()) throw httpError(400, 'Для скидки укажите причину.');
    if (payload.payment_type === 'debt' && !payload.customer_id) throw httpError(400, 'Для продажи в долг обязательно выберите клиента.');
    const customer = payload.payment_type === 'debt' ? await db.get('SELECT id, name FROM customers WHERE id=:id FOR UPDATE', { id: payload.customer_id }, connection) : null;
    if (payload.payment_type === 'debt' && !customer) throw httpError(404, 'Выбранный клиент не найден.');
    const received = payload.payment_type === 'cash' ? Math.round((payload.cash_received || 0) * 100) : payload.payment_type === 'debt' ? 0 : total;
    if (payload.payment_type === 'cash' && received < total) throw httpError(400, 'Полученная сумма меньше суммы чека.');
    const change = payload.payment_type === 'cash' ? received - total : 0;
    const saleId = await db.insert(`INSERT INTO sales (cashier_id, shift_id, customer_id, total_amount, payment_type, cash_received, change_amount, subtotal_amount, discount_amount, discount_reason)
      VALUES (:cashier_id, :shift_id, :customer_id, :total, :payment_type, :received, :change, :subtotal, :discount, :reason)`, {
      cashier_id: cashierId, shift_id: shift.id, customer_id: customer?.id || null, total, payment_type: payload.payment_type, received, change,
      subtotal, discount, reason: payload.discount_reason?.trim() || null
    }, connection);
    if (customer) await db.execute('UPDATE customers SET debt_amount=debt_amount+:amount WHERE id=:id', { amount: total, id: customer.id }, connection);
    for (const product of products) {
      const after = product.stock_quantity - product.quantity;
      const update = await db.execute('UPDATE products SET stock_quantity=:stock, updated_at=SYSTIMESTAMP WHERE id=:id AND stock_quantity>=:quantity', { stock: after, id: product.id, quantity: product.quantity }, connection);
      if (!update.rowsAffected) throw httpError(409, `Остаток товара «${product.name}» успел измениться. Повторите запрос.`);
      await db.insert(`INSERT INTO sale_items (sale_id, product_id, product_name, quantity, price_at_sale, cost_price_at_sale)
        VALUES (:sale_id, :product_id, :product_name, :quantity, :price, :cost)`, {
        sale_id: saleId, product_id: product.id, product_name: product.name, quantity: product.quantity, price: product.retail_price, cost: product.purchase_price
      }, connection);
      await db.insert(`INSERT INTO stock_history (product_id, product_name, user_id, type, quantity_change, stock_before, stock_after, reference_id)
        VALUES (:product_id, :name, :user_id, 'sale', :delta, :before, :after, :reference_id)`, {
        product_id: product.id, name: product.name, user_id: cashierId, delta: -product.quantity, before: product.stock_quantity, after, reference_id: saleId
      }, connection);
    }
    const sale = await db.get('SELECT created_at FROM sales WHERE id=:id', { id: saleId }, connection);
    return { id: saleId, cashier_id: cashierId, shift_id: shift.id, customer_id: customer?.id || null, customer_name: customer?.name || null,
      subtotal_amount: subtotal / 100, discount_amount: discount / 100, discount_reason: payload.discount_reason?.trim() || null,
      total_amount: total / 100, payment_type: payload.payment_type, cash_received: received / 100, change_amount: change / 100,
      created_at: sale.created_at, items: products.map(p => ({ product_id: p.id, name: p.name, quantity: p.quantity, price_at_sale: p.retail_price / 100, cost_price_at_sale: p.purchase_price / 100 })) };
  });
}
app.post('/api/sales', auth, asyncRoute(async (req, res) => {
  const parsed = saleInput.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Некорректные данные продажи.', details: parsed.error.flatten() });
  try { res.status(201).json({ sale: await createSale(Number(req.user.sub), parsed.data, req.user.role) }); }
  catch (error) { if (error.status) return res.status(error.status).json({ error: error.message }); throw error; }
}));

const salesQuery = z.object({ page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(20), date_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), date_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), cashier_id: z.coerce.number().int().positive().optional(), search: z.string().trim().max(50).optional() }).strict().superRefine((value, context) => {
  if (Boolean(value.date_from) !== Boolean(value.date_to)) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Укажите обе даты диапазона.', path: ['date_to'] });
  if (value.date_from && value.date_to && value.date_from > value.date_to) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Начальная дата не может быть позже конечной.', path: ['date_from'] });
});
async function itemsForSales(ids, includeCost) {
  const grouped = new Map(ids.map(id => [id, []]));
  if (!ids.length) return grouped;
  const binds = {};
  const placeholders = ids.map((id, index) => { binds[`id${index}`] = id; return `:id${index}`; }).join(',');
  const cost = includeCost ? 'si.cost_price_at_sale / 100 AS cost_price_at_sale,' : '';
  const rows = await db.all(`SELECT si.sale_id, si.product_id, si.product_name AS name, si.quantity,
    si.price_at_sale / 100 AS price_at_sale, ${cost} si.price_at_sale * si.quantity / 100 AS line_total, p.unit
    FROM sale_items si LEFT JOIN products p ON p.id=si.product_id WHERE si.sale_id IN (${placeholders}) ORDER BY si.id`, binds);
  for (const row of rows) { const { sale_id, ...item } = row; grouped.get(sale_id)?.push(item); }
  return grouped;
}
function serializeSale(row, items) {
  return { ...row, receipt_number: String(row.id), subtotal_amount: row.subtotal_amount / 100, discount_amount: row.discount_amount / 100,
    total_amount: row.total_amount / 100, cash_received: row.cash_received / 100, change_amount: row.change_amount / 100, items };
}
app.get('/api/sales', auth, asyncRoute(async (req, res) => {
  const parsed = salesQuery.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: 'Некорректные параметры истории продаж.', details: parsed.error.flatten() });
  const { page, limit, date_from, date_to, search, cashier_id } = parsed.data;
  if ((date_from && !validateReportDate(date_from)) || (date_to && !validateReportDate(date_to))) return res.status(400).json({ error: 'Указана некорректная дата.' });
  const where = []; const binds = { offset: (page - 1) * limit, limit };
  if (req.user.role !== 'admin') { where.push('s.cashier_id=:scope_cashier'); binds.scope_cashier = Number(req.user.sub); }
  else if (cashier_id) { where.push('s.cashier_id=:cashier_id'); binds.cashier_id = cashier_id; }
  if (date_from) { where.push(`s.created_at>=${oracleTimestamp('start_date')}`); binds.start_date = zonedMidnightUtc(date_from); }
  if (date_to) { where.push(`s.created_at<${oracleTimestamp('end_date')}`); binds.end_date = zonedMidnightUtc(nextDay(date_to)); }
  if (search) {
    if (!/^\d+$/.test(search) || !Number.isSafeInteger(Number(search))) return res.json({ sales: [], pagination: { page, limit, total: 0, pages: 0 } });
    where.push('s.id=:receipt_id'); binds.receipt_id = Number(search);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const countBinds = { ...binds }; delete countBinds.offset; delete countBinds.limit;
  const totalRow = await db.get(`SELECT COUNT(*) AS count FROM sales s ${whereSql}`, countBinds);
  const rows = await db.all(`SELECT s.id, s.cashier_id, u.username AS cashier_name, s.customer_id, c.name AS customer_name, s.shift_id,
    s.total_amount, s.payment_type, s.cash_received, s.change_amount, s.subtotal_amount, s.discount_amount, s.discount_reason, s.created_at
    FROM sales s JOIN users u ON u.id=s.cashier_id LEFT JOIN customers c ON c.id=s.customer_id ${whereSql}
    ORDER BY s.id DESC OFFSET :offset ROWS FETCH NEXT :limit ROWS ONLY`, binds);
  const itemsBySale = await itemsForSales(rows.map(row => row.id), req.user.role === 'admin');
  res.json({ sales: rows.map(row => serializeSale(row, itemsBySale.get(row.id) || [])), pagination: { page, limit, total: totalRow.count, pages: Math.ceil(totalRow.count / limit) } });
}));
app.get('/api/sales/:id', auth, asyncRoute(async (req, res) => {
  const id = parseId(req.params.id); if (!id) return res.status(400).json({ error: 'Некорректный номер чека.' });
  const scope = req.user.role === 'admin' ? '' : ' AND s.cashier_id=:cashier_id';
  const binds = { id }; if (scope) binds.cashier_id = Number(req.user.sub);
  const row = await db.get(`SELECT s.id, s.cashier_id, u.username AS cashier_name, s.customer_id, c.name AS customer_name, s.shift_id,
    s.total_amount, s.payment_type, s.cash_received, s.change_amount, s.subtotal_amount, s.discount_amount, s.discount_reason, s.created_at
    FROM sales s JOIN users u ON u.id=s.cashier_id LEFT JOIN customers c ON c.id=s.customer_id WHERE s.id=:id${scope}`, binds);
  if (!row) return res.status(404).json({ error: 'Чек не найден.' });
  const items = (await itemsForSales([id], req.user.role === 'admin')).get(id) || [];
  res.json({ sale: serializeSale(row, items) });
}));

app.post('/api/shifts/open', auth, asyncRoute(async (req, res) => {
  try {
    const shift = await db.transaction(async connection => {
      const cashierId = Number(req.user.sub);
      await db.get('SELECT id FROM users WHERE id=:id FOR UPDATE', { id: cashierId }, connection);
      const open = await db.get('SELECT id FROM shifts WHERE cashier_id=:id AND closed_at IS NULL', { id: cashierId }, connection);
      if (open) throw httpError(409, 'У кассира уже есть открытая смена.');
      const id = await db.insert('INSERT INTO shifts (cashier_id) VALUES (:cashier_id)', { cashier_id: cashierId }, connection);
      return db.get('SELECT * FROM shifts WHERE id=:id', { id }, connection);
    });
    res.status(201).json({ shift });
  } catch (error) { if (error.status) return res.status(error.status).json({ error: error.message }); throw error; }
}));
app.get('/api/shifts/current', auth, asyncRoute(async (req, res) => {
  const shift = await db.get(`SELECT id, cashier_id, opened_at, closed_at, revenue_cash/100 AS revenue_cash,
    revenue_card/100 AS revenue_card, revenue_debt/100 AS revenue_debt, total_revenue/100 AS total_revenue, net_profit/100 AS net_profit
    FROM shifts WHERE cashier_id=:id AND closed_at IS NULL`, { id: Number(req.user.sub) });
  res.json({ shift });
}));
app.post('/api/shifts/close', auth, asyncRoute(async (req, res) => {
  try {
    const shift = await db.transaction(async connection => {
      const current = await db.get('SELECT * FROM shifts WHERE cashier_id=:id AND closed_at IS NULL FOR UPDATE', { id: Number(req.user.sub) }, connection);
      if (!current) throw httpError(404, 'Открытая смена не найдена.');
      const totals = await db.get(`WITH sale_costs AS (
        SELECT sale_id, SUM(cost_price_at_sale*quantity) AS cost_total FROM sale_items GROUP BY sale_id
      )
      SELECT SUM(CASE WHEN s.payment_type='cash' THEN s.total_amount ELSE 0 END) AS revenue_cash,
        SUM(CASE WHEN s.payment_type='card' THEN s.total_amount ELSE 0 END) AS revenue_card,
        SUM(CASE WHEN s.payment_type='debt' THEN s.total_amount ELSE 0 END) AS revenue_debt,
        SUM(s.total_amount) AS total_revenue,
        ROUND(SUM(s.total_amount-NVL(sc.cost_total,0))) AS net_profit
        FROM sales s LEFT JOIN sale_costs sc ON sc.sale_id=s.id WHERE s.shift_id=:id`, { id: current.id }, connection);
      const received = await db.get(`SELECT SUM(CASE WHEN payment_type='cash' THEN amount ELSE 0 END) AS cash,
        SUM(CASE WHEN payment_type='card' THEN amount ELSE 0 END) AS card FROM debt_payments WHERE shift_id=:id`, { id: current.id }, connection);
      const cash = Number(totals.revenue_cash || 0) + Number(received.cash || 0);
      const card = Number(totals.revenue_card || 0) + Number(received.card || 0);
      await db.execute(`UPDATE shifts SET closed_at=SYSTIMESTAMP, revenue_cash=:cash, revenue_card=:card, revenue_debt=:debt,
        total_revenue=:total, net_profit=:profit WHERE id=:id`, {
        cash, card, debt: totals.revenue_debt || 0, total: totals.total_revenue || 0, profit: totals.net_profit || 0, id: current.id
      }, connection);
      return db.get(`SELECT id, cashier_id, opened_at, closed_at, revenue_cash/100 AS revenue_cash, revenue_card/100 AS revenue_card,
        revenue_debt/100 AS revenue_debt, total_revenue/100 AS total_revenue, net_profit/100 AS net_profit FROM shifts WHERE id=:id`, { id: current.id }, connection);
    });
    res.json({ shift });
  } catch (error) { if (error.status) return res.status(error.status).json({ error: error.message }); throw error; }
}));

function validateReportDate(value) { return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value; }
async function reportRange(req, res, monthly) {
  const parsed = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), month: z.string().regex(/^\d{4}-\d{2}$/).optional() }).safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: 'Дата должна иметь формат YYYY-MM-DD или месяц YYYY-MM.' });
  const today = dateInZone(new Date());
  const start = monthly ? `${parsed.data.month || today.slice(0, 7)}-01` : parsed.data.date || today;
  if (!validateReportDate(start)) return res.status(400).json({ error: 'Указана некорректная дата.' });
  const end = monthly ? nextMonth(start) : nextDay(start);
  const from = zonedMidnightUtc(start); const to = zonedMidnightUtc(end);
  const report = await db.get(`WITH sale_costs AS (
    SELECT sale_id, SUM(cost_price_at_sale*quantity) AS cost_total FROM sale_items GROUP BY sale_id
  ), sales_aggregate AS (
    SELECT COUNT(*) AS sales_count, NVL(SUM(s.total_amount),0) AS total_revenue,
      NVL(SUM(CASE WHEN s.payment_type='cash' THEN s.total_amount ELSE 0 END),0) AS revenue_cash,
      NVL(SUM(CASE WHEN s.payment_type='card' THEN s.total_amount ELSE 0 END),0) AS revenue_card,
      NVL(SUM(CASE WHEN s.payment_type='debt' THEN s.total_amount ELSE 0 END),0) AS revenue_debt,
      ROUND(NVL(SUM(s.total_amount-NVL(sc.cost_total,0)),0)) AS net_profit
    FROM sales s LEFT JOIN sale_costs sc ON sc.sale_id=s.id
    WHERE s.created_at>=${oracleTimestamp('from_date')} AND s.created_at<${oracleTimestamp('to_date')}
  ), debt_payment_aggregate AS (
    SELECT NVL(SUM(CASE WHEN payment_type='cash' THEN amount ELSE 0 END),0) AS revenue_cash,
      NVL(SUM(CASE WHEN payment_type='card' THEN amount ELSE 0 END),0) AS revenue_card
    FROM debt_payments WHERE created_at>=${oracleTimestamp('from_date')} AND created_at<${oracleTimestamp('to_date')}
  )
  SELECT sales_aggregate.sales_count, sales_aggregate.total_revenue,
    sales_aggregate.revenue_cash+debt_payment_aggregate.revenue_cash AS revenue_cash,
    sales_aggregate.revenue_card+debt_payment_aggregate.revenue_card AS revenue_card,
    sales_aggregate.revenue_debt, sales_aggregate.net_profit
  FROM sales_aggregate CROSS JOIN debt_payment_aggregate`, { from_date: from, to_date: to });
  res.json({ period: monthly ? { month: start.slice(0, 7) } : { date: start }, ...Object.fromEntries(Object.entries(report).map(([key, value]) => [key, key === 'sales_count' ? value : Number(value || 0) / 100])) });
}
app.get('/api/reports/daily', auth, roles('admin'), asyncRoute(async (req, res) => reportRange(req, res, false)));
app.get('/api/reports/monthly', auth, roles('admin'), asyncRoute(async (req, res) => reportRange(req, res, true)));

const topQuery = z.object({ period: z.enum(['day', 'month', 'all']).optional().default('month'), date_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), date_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), limit: z.coerce.number().int().min(1).max(100).default(10), sort: z.enum(['revenue', 'profit', 'quantity']).default('revenue') }).strict().superRefine((value, context) => {
  if (Boolean(value.date_from) !== Boolean(value.date_to)) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Укажите обе даты диапазона.', path: ['date_to'] });
  if (value.date_from && value.date_to && value.date_from > value.date_to) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Начальная дата не может быть позже конечной.', path: ['date_from'] });
});
function topPeriod(period, fromDate, toDate) {
  const today = dateInZone(new Date());
  const start = fromDate || (period === 'day' ? today : period === 'month' ? `${today.slice(0, 7)}-01` : null);
  const end = toDate ? nextDay(toDate) : period === 'day' ? nextDay(today) : period === 'month' ? nextMonth(start) : null;
  return { start, end };
}
app.get('/api/reports/top-products', auth, roles('admin'), asyncRoute(async (req, res) => {
  const parsed = topQuery.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: 'Некорректные параметры отчёта по товарам.', details: parsed.error.flatten() });
  const { period, date_from, date_to, limit, sort } = parsed.data;
  if ((date_from && !validateReportDate(date_from)) || (date_to && !validateReportDate(date_to))) return res.status(400).json({ error: 'Указана некорректная дата.' });
  const { start, end } = topPeriod(period, date_from, date_to);
  const where = []; const binds = { limit };
  if (start) { where.push(`s.created_at>=${oracleTimestamp('from_date')}`); binds.from_date = zonedMidnightUtc(start); }
  if (end) { where.push(`s.created_at<${oracleTimestamp('to_date')}`); binds.to_date = zonedMidnightUtc(end); }
  const order = { revenue: 'revenue DESC, sold_quantity DESC', profit: 'gross_profit DESC, revenue DESC', quantity: 'sold_quantity DESC, revenue DESC' }[sort];
  const products = await db.all(`SELECT si.product_id, si.product_name AS name, NVL(p.category, 'Архивные товары') AS category,
    NVL(p.unit, 'unknown') AS unit, SUM(si.quantity) AS sold_quantity,
    SUM(si.price_at_sale*si.quantity)/100 AS revenue,
    SUM((si.price_at_sale-si.cost_price_at_sale)*si.quantity-CASE WHEN s.subtotal_amount>0 THEN s.discount_amount*(si.price_at_sale*si.quantity/s.subtotal_amount) ELSE 0 END)/100 AS gross_profit,
    SUM(CASE WHEN s.subtotal_amount>0 THEN s.discount_amount*(si.price_at_sale*si.quantity/s.subtotal_amount) ELSE 0 END)/100 AS allocated_discount
    FROM sale_items si JOIN sales s ON s.id=si.sale_id LEFT JOIN products p ON p.id=si.product_id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    GROUP BY si.product_id, si.product_name, NVL(p.category, 'Архивные товары'), NVL(p.unit, 'unknown')
    ORDER BY ${order} FETCH FIRST :limit ROWS ONLY`, binds);
  res.json({ period: date_from ? { type: 'range', date_from, date_to } : { type: period, date_from: start, date_to: end }, sort, limit, products });
}));

const analyticsQueryShape = z.object({
  date_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), date_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  category: z.string().trim().max(100).optional(), unit: z.enum(['pcs', 'm']).optional(), cashier_id: z.coerce.number().int().positive().optional(),
  payment_type: z.enum(['cash', 'card', 'debt']).optional(),
  stock_status: z.enum(['all', 'in_stock', 'low_stock', 'out_of_stock']).default('all')
}).strict();
const analyticsQuery = analyticsQueryShape.superRefine((value, context) => {
  if (Boolean(value.date_from) !== Boolean(value.date_to)) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Укажите обе даты периода.', path: ['date_to'] });
  if (value.date_from && value.date_to && value.date_from > value.date_to) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Начальная дата не может быть позже конечной.', path: ['date_from'] });
  if (value.date_from && value.date_to && (Date.parse(`${value.date_to}T00:00:00Z`) - Date.parse(`${value.date_from}T00:00:00Z`)) / 86400000 > 365) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Период отчёта не может превышать 366 дней.', path: ['date_to'] });
});
async function buildAnalytics(filters) {
  const today = dateInZone(new Date());
  const endCivil = filters.date_to || today;
  const startCivil = filters.date_from || addDays(endCivil, -29);
  const from = zonedMidnightUtc(startCivil); const to = zonedMidnightUtc(nextDay(endCivil));
  const days = Math.max(1, Math.round((new Date(to).getTime() - new Date(from).getTime()) / 86400000));
  const where = []; const binds = { from_date: from, to_date: to };
  if (filters.category) { where.push('UPPER(p.category)=UPPER(:category)'); binds.category = filters.category; }
  if (filters.unit) { where.push('p.unit=:unit'); binds.unit = filters.unit; }
  if (filters.stock_status === 'in_stock') where.push('p.stock_quantity>0');
  if (filters.stock_status === 'low_stock') where.push('p.stock_quantity>0 AND p.stock_quantity<=p.low_stock_threshold');
  if (filters.stock_status === 'out_of_stock') where.push('p.stock_quantity=0');
  const productWhere = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const saleConditions = [];
  if (filters.cashier_id) saleConditions.push('s.cashier_id=:cashier_id');
  if (filters.payment_type) saleConditions.push('s.payment_type=:payment_type');
  const saleFilter = saleConditions.length ? ` AND ${saleConditions.join(' AND ')}` : '';
  if (filters.cashier_id) binds.cashier_id = filters.cashier_id;
  if (filters.payment_type) binds.payment_type = filters.payment_type;
  const products = await db.all(`WITH filtered_products AS (
      SELECT p.id, p.name, p.category, p.unit, p.stock_quantity, p.low_stock_threshold, p.purchase_price, p.retail_price, p.created_at
      FROM products p ${productWhere}
    ), product_sales AS (
      SELECT si.product_id, SUM(si.quantity) AS sold_quantity,
        SUM(si.price_at_sale*si.quantity-CASE WHEN s.subtotal_amount>0 THEN s.discount_amount*(si.price_at_sale*si.quantity/s.subtotal_amount) ELSE 0 END) AS revenue_minor,
        SUM((si.price_at_sale-si.cost_price_at_sale)*si.quantity-CASE WHEN s.subtotal_amount>0 THEN s.discount_amount*(si.price_at_sale*si.quantity/s.subtotal_amount) ELSE 0 END) AS profit_minor
      FROM sale_items si JOIN sales s ON s.id=si.sale_id JOIN filtered_products fp ON fp.id=si.product_id
      WHERE s.created_at>=${oracleTimestamp('from_date')} AND s.created_at<${oracleTimestamp('to_date')}${saleFilter}
      GROUP BY si.product_id
    )
    SELECT fp.id AS product_id, fp.name, fp.category, fp.unit, fp.stock_quantity, fp.low_stock_threshold,
      fp.purchase_price/100 AS purchase_price, fp.retail_price/100 AS retail_price,
      NVL(ps.sold_quantity,0) AS sold_quantity, NVL(ps.revenue_minor,0)/100 AS revenue,
      NVL(ps.profit_minor,0)/100 AS gross_profit,
      CASE WHEN NVL(ps.revenue_minor,0)>0 THEN NVL(ps.profit_minor,0)/ps.revenue_minor
        WHEN fp.retail_price>0 THEN (fp.retail_price-fp.purchase_price)/fp.retail_price ELSE 0 END AS gross_margin,
      fp.created_at
    FROM filtered_products fp LEFT JOIN product_sales ps ON ps.product_id=fp.id ORDER BY revenue DESC, fp.name`, binds);
  const timeZoneLiteral = appTimeZone.replace(/'/g, "''");
  const series = await db.all(`WITH filtered_products AS (SELECT p.id FROM products p ${productWhere})
    SELECT TO_CHAR(CAST(s.created_at AT TIME ZONE '${timeZoneLiteral}' AS DATE), 'YYYY-MM-DD') AS "day",
      SUM(si.price_at_sale*si.quantity-CASE WHEN s.subtotal_amount>0 THEN s.discount_amount*(si.price_at_sale*si.quantity/s.subtotal_amount) ELSE 0 END)/100 AS revenue,
      SUM((si.price_at_sale-si.cost_price_at_sale)*si.quantity-CASE WHEN s.subtotal_amount>0 THEN s.discount_amount*(si.price_at_sale*si.quantity/s.subtotal_amount) ELSE 0 END)/100 AS gross_profit,
      SUM(si.quantity) AS quantity
    FROM sale_items si JOIN sales s ON s.id=si.sale_id JOIN filtered_products fp ON fp.id=si.product_id
    WHERE s.created_at>=${oracleTimestamp('from_date')} AND s.created_at<${oracleTimestamp('to_date')}${saleFilter}
    GROUP BY TO_CHAR(CAST(s.created_at AT TIME ZONE '${timeZoneLiteral}' AS DATE), 'YYYY-MM-DD') ORDER BY "day"`, binds);
  const categories = await db.all('SELECT DISTINCT category FROM products ORDER BY UPPER(category)');
  const cashiers = await db.all("SELECT id, username FROM users WHERE role='cashier' OR role='admin' ORDER BY UPPER(username)");
  const summary = products.reduce((result, product) => {
    result.revenue += Number(product.revenue || 0); result.gross_profit += Number(product.gross_profit || 0);
    result.sold_quantity += Number(product.sold_quantity || 0); return result;
  }, { revenue: 0, gross_profit: 0, sold_quantity: 0, products_count: products.length });
  const salesSummary = await db.get(`WITH filtered_products AS (SELECT p.id FROM products p ${productWhere}), scoped_sales AS (
      SELECT s.id, s.payment_type,
        SUM(si.price_at_sale*si.quantity-CASE WHEN s.subtotal_amount>0 THEN s.discount_amount*(si.price_at_sale*si.quantity/s.subtotal_amount) ELSE 0 END) AS revenue_minor
      FROM sale_items si JOIN sales s ON s.id=si.sale_id JOIN filtered_products fp ON fp.id=si.product_id
      WHERE s.created_at>=${oracleTimestamp('from_date')} AND s.created_at<${oracleTimestamp('to_date')}${saleFilter}
      GROUP BY s.id, s.payment_type
    ) SELECT COUNT(*) AS sales_count, NVL(SUM(revenue_minor),0)/100 AS revenue,
      NVL(SUM(CASE WHEN payment_type='cash' THEN revenue_minor ELSE 0 END),0)/100 AS revenue_cash,
      NVL(SUM(CASE WHEN payment_type='card' THEN revenue_minor ELSE 0 END),0)/100 AS revenue_card,
      NVL(SUM(CASE WHEN payment_type='debt' THEN revenue_minor ELSE 0 END),0)/100 AS revenue_debt
    FROM scoped_sales`, binds);
  summary.revenue = Number(salesSummary.revenue || 0);
  summary.sales_count = Number(salesSummary.sales_count || 0);
  summary.average_check = summary.sales_count ? summary.revenue / summary.sales_count : 0;
  summary.payment_mix = {
    cash: Number(salesSummary.revenue_cash || 0),
    card: Number(salesSummary.revenue_card || 0),
    debt: Number(salesSummary.revenue_debt || 0)
  };
  const previousStartCivil = addDays(startCivil, -days);
  const previousBinds = { ...binds, from_date: zonedMidnightUtc(previousStartCivil), to_date: from };
  const previousSummary = await db.get(`WITH filtered_products AS (SELECT p.id FROM products p ${productWhere}), previous_sales AS (
      SELECT s.id,
        SUM(si.price_at_sale*si.quantity-CASE WHEN s.subtotal_amount>0 THEN s.discount_amount*(si.price_at_sale*si.quantity/s.subtotal_amount) ELSE 0 END) AS revenue_minor,
        SUM((si.price_at_sale-si.cost_price_at_sale)*si.quantity-CASE WHEN s.subtotal_amount>0 THEN s.discount_amount*(si.price_at_sale*si.quantity/s.subtotal_amount) ELSE 0 END) AS profit_minor
      FROM sale_items si JOIN sales s ON s.id=si.sale_id JOIN filtered_products fp ON fp.id=si.product_id
      WHERE s.created_at>=${oracleTimestamp('from_date')} AND s.created_at<${oracleTimestamp('to_date')}${saleFilter}
      GROUP BY s.id
    ) SELECT COUNT(*) AS sales_count, NVL(SUM(revenue_minor),0)/100 AS revenue,
      NVL(SUM(profit_minor),0)/100 AS gross_profit FROM previous_sales`, previousBinds);
  const previousRevenue = Number(previousSummary.revenue || 0);
  const previousProfit = Number(previousSummary.gross_profit || 0);
  summary.comparison = {
    date_from: previousStartCivil,
    date_to: addDays(startCivil, -1),
    revenue: previousRevenue,
    gross_profit: previousProfit,
    revenue_change_percent: previousRevenue ? (summary.revenue - previousRevenue) / previousRevenue * 100 : null,
    gross_profit_change_percent: previousProfit > 0 ? (summary.gross_profit - previousProfit) / previousProfit * 100 : null
  };
  const totalPositiveRevenue = products.reduce((sum, product) => sum + Math.max(0, Number(product.revenue || 0)), 0);
  let cumulativeRevenue = 0;
  const abcById = new Map([...products].sort((a, b) => Number(b.revenue || 0) - Number(a.revenue || 0)).map(product => {
    const revenue = Math.max(0, Number(product.revenue || 0));
    const shareBefore = totalPositiveRevenue ? cumulativeRevenue / totalPositiveRevenue : 1;
    cumulativeRevenue += revenue;
    return [product.product_id, revenue <= 0 ? 'C' : shareBefore < 0.8 ? 'A' : shareBefore < 0.95 ? 'B' : 'C'];
  }));
  const enrichedProducts = products.map(product => {
    const soldQuantity = Number(product.sold_quantity || 0);
    const dailyVelocity = soldQuantity / days;
    return { ...product, abc_class: abcById.get(product.product_id) || 'C', inventory_cost_value: Number(product.stock_quantity || 0) * Number(product.purchase_price || 0), daily_velocity: dailyVelocity, stock_cover_days: dailyVelocity > 0 ? Number(product.stock_quantity || 0) / dailyVelocity : null };
  });
  const categoryMap = new Map();
  for (const product of enrichedProducts) {
    const category = product.category || 'Общая';
    const current = categoryMap.get(category) || { category, products_count: 0, sold_quantity: 0, revenue: 0, gross_profit: 0, inventory_cost_value: 0 };
    current.products_count += 1;
    current.sold_quantity += Number(product.sold_quantity || 0);
    current.revenue += Number(product.revenue || 0);
    current.gross_profit += Number(product.gross_profit || 0);
    current.inventory_cost_value += Number(product.inventory_cost_value || 0);
    categoryMap.set(category, current);
  }
  const categorySummary = [...categoryMap.values()].map(category => ({
    ...category,
    gross_margin: category.revenue > 0 ? category.gross_profit / category.revenue : 0
  })).sort((a, b) => b.gross_profit - a.gross_profit);
  const recommendations = [];
  for (const product of products) {
    const qty = Number(product.sold_quantity || 0); const stock = Number(product.stock_quantity || 0);
    const dailyVelocity = qty / days;
    const margin = Number(product.gross_margin || 0);
    if (qty > 0 && dailyVelocity > 0 && stock / dailyVelocity <= 5) {
      recommendations.push({ kind: 'restock', severity: 'high', product_id: product.product_id, product_name: product.name,
        title: 'Риск скорого отсутствия', message: `Остатка хватит примерно на ${(stock / dailyVelocity).toFixed(1)} дня.`,
        suggested_quantity: Math.max(0, Math.ceil(dailyVelocity * 14 - stock)), unit: product.unit, metric: 'stock_cover_days', value: stock / dailyVelocity });
    }
    if (Number(product.purchase_price) > 0 && margin < 0.2 && Number(product.retail_price) > 0) {
      const suggested = Math.ceil(Number(product.purchase_price) / 0.8);
      if (suggested > Number(product.retail_price)) recommendations.push({ kind: 'price', severity: 'medium', product_id: product.product_id, product_name: product.name,
        title: 'Низкая валовая маржа', message: `Текущая маржа ${(margin * 100).toFixed(1)}%. Для целевой маржи 20% проверьте цену.`,
        current_price: Number(product.retail_price), suggested_price: suggested, metric: 'gross_margin', value: margin });
    }
    if (qty === 0 && stock > 0 && new Date(product.created_at).getTime() < new Date(from).getTime()) {
      recommendations.push({ kind: 'slow_mover', severity: 'low', product_id: product.product_id, product_name: product.name,
        title: 'Нет продаж за период', message: 'Есть остаток, но за выбранный период продаж не было. Проверьте актуальность карточки и спрос; скидку стоит оценивать по данным о похожих товарах.',
        metric: 'sold_quantity', value: 0 });
    }
  }
  recommendations.sort((a, b) => ({ high: 0, medium: 1, low: 2 }[a.severity] - ({ high: 0, medium: 1, low: 2 }[b.severity])));
  return { period: { date_from: startCivil, date_to: endCivil, time_zone: appTimeZone, days }, filters: { ...filters }, summary, series, products: enrichedProducts, category_summary: categorySummary, recommendations: recommendations.slice(0, 30), categories: categories.map(row => row.category), cashiers };
}

app.get('/api/reports/analytics', auth, roles('admin'), asyncRoute(async (req, res) => {
  const parsed = analyticsQuery.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: 'Некорректные фильтры аналитики.', details: parsed.error.flatten() });
  if (parsed.data.date_from && (!validateReportDate(parsed.data.date_from) || !validateReportDate(parsed.data.date_to))) return res.status(400).json({ error: 'Указана некорректная дата.' });
  res.json(await buildAnalytics(parsed.data));
}));

const chatRate = new Map();
let providerQuotaUnavailableUntil = 0;
const analyticsMoney = value => `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(Number(value || 0))} ₸`;
function localAnalyticsAnswer(question, analytics) {
  const normalized = question.toLowerCase();
  const summary = analytics.summary;
  const intro = `AI-сервис сейчас недоступен из-за лимита API. Ниже сводка по данным POS за ${analytics.period.date_from} — ${analytics.period.date_to}: ${summary.sales_count} чеков, выручка ${analyticsMoney(summary.revenue)}, валовая прибыль ${analyticsMoney(summary.gross_profit)}.`;
  const recommendations = analytics.recommendations.slice(0, 5).map(item => `• ${item.product_name}: ${item.title.toLowerCase()} — ${item.message}`).join('\n');
  const top = [...analytics.products].filter(item => Number(item.sold_quantity) > 0).sort((a, b) => Number(b.gross_profit) - Number(a.gross_profit)).slice(0, 5)
    .map((item, index) => `${index + 1}. ${item.name}: прибыль ${analyticsMoney(item.gross_profit)}, выручка ${analyticsMoney(item.revenue)}, продано ${Number(item.sold_quantity)} ${item.unit === 'm' ? 'м' : 'шт.'}`).join('\n');
  const price = analytics.recommendations.filter(item => item.kind === 'price').slice(0, 5)
    .map(item => `• ${item.product_name}: цена сейчас ${analyticsMoney(item.current_price)}, ориентир для проверки ${analyticsMoney(item.suggested_price)}. ${item.message}`).join('\n');
  if (/цен|марж|прибыл/.test(normalized) && price) return `${intro}\n\nЦены, которые стоит проверить вручную:\n${price}\n\nЭто расчёт по себестоимости и целевой марже, он не прогнозирует реакцию покупателей.`;
  if (/внимани|запас|пополн|заказ|остат/.test(normalized) && recommendations) return `${intro}\n\nПодсказки по запасам и ассортименту:\n${recommendations}`;
  if (/лучш|лидер|топ|прода|товар/.test(normalized) && top) return `${intro}\n\nТовары с наибольшей валовой прибылью за период:\n${top}`;
  return `${intro}${top ? `\n\nЛидеры по валовой прибыли:\n${top}` : '\n\nЗа этот период в выборке нет продаж.'}${recommendations ? `\n\nТребуют внимания:\n${recommendations}` : ''}`;
}
const chatInput = z.object({
  messages: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().trim().min(1).max(1500) }).strict()).min(1).max(12),
  filters: analyticsQueryShape.partial().optional()
}).strict();
app.get('/api/analytics/chat/status', auth, roles('admin'), (req, res) => res.json({ configured: Boolean(process.env.OPENAI_API_KEY), model: process.env.OPENAI_MODEL || 'gpt-5-mini' }));
app.post('/api/analytics/chat', auth, roles('admin'), asyncRoute(async (req, res) => {
  const parsed = chatInput.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Проверьте вопрос и историю чата.', details: parsed.error.flatten() });
  if (!process.env.OPENAI_API_KEY) return res.status(503).json({ error: 'AI-чат не настроен: задайте OPENAI_API_KEY в .env и перезапустите сервер.' });
  const now = Date.now(); const history = (chatRate.get(req.user.sub) || []).filter(time => now - time < 60000);
  if (history.length >= 15) return res.status(429).json({ error: 'Слишком много запросов. Подождите минуту и повторите.' });
  history.push(now); chatRate.set(req.user.sub, history);
  const filters = analyticsQueryShape.partial().safeParse(parsed.data.filters || {});
  if (!filters.success) return res.status(400).json({ error: 'Фильтры чата имеют неверный формат.' });
  const analytics = await buildAnalytics({ stock_status: 'all', ...filters.data });
  const context = {
    period: analytics.period, summary: analytics.summary,
    top_products: [...analytics.products].sort((a, b) => b.revenue - a.revenue).slice(0, 12),
    low_products: [...analytics.products].filter(product => product.sold_quantity > 0).sort((a, b) => a.gross_profit - b.gross_profit).slice(0, 8),
    categories: analytics.category_summary.slice(0, 8),
    stock_cover_risks: analytics.products.filter(product => product.stock_cover_days !== null && product.stock_cover_days <= 14)
      .sort((a, b) => a.stock_cover_days - b.stock_cover_days).slice(0, 10)
      .map(product => ({ name: product.name, stock_quantity: product.stock_quantity, unit: product.unit, daily_velocity: product.daily_velocity, stock_cover_days: product.stock_cover_days })),
    recommendations: analytics.recommendations.slice(0, 12)
  };
  const fallbackResponse = () => res.json({ answer: localAnalyticsAnswer(parsed.data.messages.at(-1).content, analytics), model: 'local-analytics', mode: 'local_fallback', period: analytics.period });
  if (providerQuotaUnavailableUntil > Date.now()) return fallbackResponse();
  const instructions = 'Ты Oracle — помощник по аналитике POS-магазина. Отвечай по-русски, кратко и по делу. Используй только переданные агрегированные данные; если данных не хватает, прямо скажи об этом. Объясняй рекомендации и расчёты, не выдавай предположения за факты. Не раскрывай персональные данные, не проси пароль/API-ключи, не генерируй SQL и не обещай гарантированное изменение спроса после смены цены. Цены — только предложения для ручного решения администратора.';
  try {
    const response = await fetch(process.env.OPENAI_API_URL || 'https://api.openai.com/v1/responses', {
      method: 'POST', headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: process.env.OPENAI_MODEL || 'gpt-5-mini', instructions,
        input: [{ role: 'user', content: `Сводные данные POS в JSON:\n${JSON.stringify(context)}` }, ...parsed.data.messages],
        max_output_tokens: 900, store: false }),
      signal: AbortSignal.timeout(30000)
    });
    const body = await response.json();
    if (!response.ok) {
      const providerError = body.error?.code || body.error?.type;
      console.error('AI provider returned an error:', providerError || response.status);
      if (['insufficient_quota', 'credit_balance_exhausted', 'billing_hard_limit_reached'].includes(providerError)) {
        providerQuotaUnavailableUntil = Date.now() + 5 * 60 * 1000;
        return fallbackResponse();
      }
      return res.status(502).json({ error: 'AI-сервис временно не смог ответить. Проверьте настройки модели и повторите позже.' });
    }
    const answer = body.output_text || (body.output || []).flatMap(item => item.content || []).filter(item => item.type === 'output_text').map(item => item.text).join('\n');
    if (!answer) return res.status(502).json({ error: 'AI-сервис вернул пустой ответ. Попробуйте задать вопрос иначе.' });
    res.json({ answer, model: body.model || process.env.OPENAI_MODEL || 'gpt-5-mini', period: analytics.period });
  } catch (error) {
    if (error.name === 'TimeoutError' || error.name === 'AbortError') return res.status(504).json({ error: 'AI-сервис не ответил за отведённое время.' });
    throw error;
  }
}));

app.use((req, res) => res.status(404).json({ error: 'Маршрут не найден.' }));
app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  if (error.message === 'Origin is not allowed by CORS') return res.status(403).json({ error: 'Источник запроса не разрешён.' });
  if (isUnique(error)) return res.status(409).json({ error: 'Запись с такими данными уже существует.' });
  console.error(error);
  res.status(error.status || 500).json({ error: error.status ? error.message : 'Внутренняя ошибка сервера.' });
});

let server;
async function start() {
  try {
    await db.initialize();
    server = app.listen(port, () => console.log(`POS API connected to Oracle Database and listening on http://localhost:${port}`));
  } catch (error) {
    console.error(`Could not start POS API: ${error.message}`);
    console.error('Start the local Oracle Database, configure ORACLE_USER, ORACLE_PASSWORD and ORACLE_CONNECT_STRING, then run npm run db:migrate.');
    process.exitCode = 1;
  }
}
async function shutdown() {
  if (server) await new Promise(resolve => server.close(resolve));
  await db.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
start();
