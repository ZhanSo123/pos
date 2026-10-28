import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import api, { getErrorMessage } from '../api';
import { APP_TIME_ZONE, formatMoney, pluralize } from '../utils';

function readShiftFlag(userId) { return localStorage.getItem(`pos_shift_open_${userId}`) === 'true'; }
const unitName = product => product.unit === 'm' ? 'м' : 'шт.';
const quantityText = (quantity, product) => `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 3 }).format(quantity)} ${unitName(product)}`;

export default function POSCheckout({ user, notify, shiftOpen, setShiftOpen }) {
  const [products, setProducts] = useState([]);
  const [cart, setCart] = useState({});
  const [quantityDrafts, setQuantityDrafts] = useState({});
  const [search, setSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const searchInputRef = useRef(null);
  const [discountPercent, setDiscountPercent] = useState('0');
  const [discountReason, setDiscountReason] = useState('');
  const [lastSale, setLastSale] = useState(null);
  const [stockFilter, setStockFilter] = useState('all');
  const [selectedCategory, setSelectedCategory] = useState('Все товары');
  const [loading, setLoading] = useState(true);
  const [shiftLoading, setShiftLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [receiptTab, setReceiptTab] = useState('check');
  const [customers, setCustomers] = useState([]);
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [customerModal, setCustomerModal] = useState(false);
  const [customerSearch, setCustomerSearch] = useState('');
  const [newCustomer, setNewCustomer] = useState({ name: '', phone: '' });
  const [debtPayOpen, setDebtPayOpen] = useState(false);
  const [debtPayAmount, setDebtPayAmount] = useState('');
  const [debtPayReceived, setDebtPayReceived] = useState('');
  const [debtPayType, setDebtPayType] = useState('cash');
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paymentType, setPaymentType] = useState('cash');
  const [cashReceived, setCashReceived] = useState('');
  const [quantityProduct, setQuantityProduct] = useState(null);
  const [quantityValue, setQuantityValue] = useState('1');
  const [closeSummary, setCloseSummary] = useState(null);

  const loadProducts = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/products');
      setProducts(data.products || []);
    } catch (error) { notify(getErrorMessage(error, 'Не удалось загрузить каталог.'), 'error'); }
    finally { setLoading(false); }
  }, [notify]);
  useEffect(() => { loadProducts(); }, [loadProducts]);

  useEffect(() => {
    let active = true;
    api.get('/shifts/current').then(({ data }) => {
      if (!active) return;
      const isOpen = Boolean(data.shift);
      setShiftOpen(isOpen);
      if (isOpen) localStorage.setItem(`pos_shift_open_${user.id}`, 'true');
      else localStorage.removeItem(`pos_shift_open_${user.id}`);
    }).catch(error => {
      if (!active) return;
      setShiftOpen(false);
      localStorage.removeItem(`pos_shift_open_${user.id}`);
      notify(getErrorMessage(error, 'Не удалось проверить состояние смены.'), 'error');
    }).finally(() => { if (active) setShiftLoading(false); });
    return () => { active = false; };
  }, [notify, setShiftOpen, user.id]);

  const loadCustomers = useCallback(async () => {
    try { const { data } = await api.get('/customers'); setCustomers(data.customers || []); }
    catch (error) { notify(getErrorMessage(error, 'Не удалось загрузить клиентов.'), 'error'); }
  }, [notify]);
  useEffect(() => { loadCustomers(); }, [loadCustomers]);

  const categories = useMemo(() => ['Все товары', ...Array.from(new Set(products.map(product => product.category || 'Общая'))).sort((a, b) => a.localeCompare(b, 'ru'))], [products]);
  const visibleProducts = useMemo(() => products.filter(product => {
    const query = search.trim().toLowerCase();
    const matchesSearch = !query || `${product.name} ${product.sku || ''}`.toLowerCase().includes(query);
    const matchesCategory = selectedCategory === 'Все товары' || (product.category || 'Общая') === selectedCategory;
    const matchesStock = stockFilter === 'all' || (stockFilter === 'low' ? Number(product.stock_quantity) <= Number(product.low_stock_threshold ?? 5) : stockFilter === 'available' ? Number(product.stock_quantity) > 0 : Number(product.stock_quantity) <= 0);
    return matchesSearch && matchesCategory && matchesStock;
  }), [products, search, selectedCategory, stockFilter]);
  const lines = useMemo(() => Object.values(cart), [cart]);
  const subtotal = useMemo(() => Math.round(lines.reduce((sum, line) => sum + line.product.retail_price * line.quantity, 0) * 100) / 100, [lines]);
  const discount = user.role === 'admin' ? Math.min(subtotal, Math.round(subtotal * (Number(discountPercent) || 0)) / 100) : 0;
  const total = Math.round((subtotal - discount) * 100) / 100;
  const received = paymentType === 'cash' ? Number(cashReceived) || 0 : total;
  const change = Math.max(0, received - total);

  function addProduct(product, quantity = 1) {
    const current = cart[product.id]?.quantity || 0;
    const next = current + quantity;
    if (next > Number(product.stock_quantity)) { notify(`Недостаточно остатка: доступно ${quantityText(product.stock_quantity, product)}.`, 'error'); return; }
    if (product.unit === 'pcs' && !Number.isInteger(next)) { notify('Количество штучного товара должно быть целым.', 'error'); return; }
    setCart(currentCart => ({ ...currentCart, [product.id]: { product, quantity: next } }));
  }

  function selectProduct(product) {
    if (Number(product.stock_quantity) <= 0) return;
    if (product.unit === 'm') { setQuantityProduct(product); setQuantityValue('1'); return; }
    addProduct(product, 1);
  }

  function scanSku(value) {
    const code = value.trim().toLowerCase();
    if (!code) return;
    const product = products.find(item => (item.sku || '').trim().toLowerCase() === code);
    if (!product) { notify(`Штрихкод «${value.trim()}» не найден.`, 'error'); return; }
    selectProduct(product);
    setSearch('');
    setSearchOpen(false);
  }

  function confirmMeasuredQuantity(event) {
    event.preventDefault();
    const quantity = Number(quantityValue);
    if (!Number.isFinite(quantity) || quantity <= 0) { notify('Укажите количество больше нуля.', 'error'); return; }
    addProduct(quantityProduct, quantity);
    setQuantityProduct(null);
  }

  function changeCartQuantity(id, nextValue) {
    const line = cart[id]; if (!line) return;
    const quantity = Number(nextValue);
    if (!Number.isFinite(quantity) || quantity <= 0) { notify('Количество должно быть больше нуля.', 'error'); return; }
    if (line.product.unit === 'pcs' && !Number.isInteger(quantity)) { notify('Для штучного товара можно указать только целое количество.', 'error'); return; }
    if (quantity > Number(line.product.stock_quantity)) { notify(`На складе только ${quantityText(line.product.stock_quantity, line.product)}.`, 'error'); return; }
    setCart(current => ({ ...current, [id]: { ...current[id], quantity } }));
  }

  function adjustCartQuantity(id, direction) {
    const line = cart[id]; if (!line) return;
    const step = line.product.unit === 'm' ? 0.1 : 1;
    const quantity = Math.round((line.quantity + step * direction) * 1000) / 1000;
    if (quantity <= 0) { removeLine(id); return; }
    changeCartQuantity(id, quantity);
  }

  function removeLine(id) {
    setCart(current => { const next = { ...current }; delete next[id]; return next; });
    setQuantityDrafts(current => { const next = { ...current }; delete next[id]; return next; });
  }

  async function openShift() {
    setBusy(true);
    try {
      await api.post('/shifts/open'); localStorage.setItem(`pos_shift_open_${user.id}`, 'true');
      setShiftOpen(true); setCloseSummary(null); notify('Смена открыта.');
    } catch (error) {
      if (error.response?.status === 409) { localStorage.setItem(`pos_shift_open_${user.id}`, 'true'); setShiftOpen(true); notify('Смена уже открыта.'); }
      else notify(getErrorMessage(error, 'Не удалось открыть смену.'), 'error');
    } finally { setBusy(false); }
  }

  async function closeShift() {
    if (lines.length) {
      notify('Сначала завершите продажу или очистите текущий чек, затем закройте смену.', 'error');
      return;
    }
    setBusy(true);
    try {
      const { data } = await api.post('/shifts/close');
      setCloseSummary(data.shift); localStorage.removeItem(`pos_shift_open_${user.id}`); setShiftOpen(false);
      setCashReceived(''); setPaymentOpen(false); notify('Смена закрыта. Итоги сохранены.');
    } catch (error) { notify(getErrorMessage(error, 'Не удалось закрыть смену.'), 'error'); }
    finally { setBusy(false); }
  }

  async function submitPayment(event) {
    event.preventDefault();
    if (!lines.length) return;
    if (paymentType === 'cash' && received < total) { notify('Внесённой суммы недостаточно.', 'error'); return; }
    if (paymentType === 'debt' && !selectedCustomer) { notify('Для оплаты в долг выберите клиента.', 'error'); setReceiptTab('customer'); return; }
    if (user.role === 'admin' && Number(discountPercent) > 0 && !discountReason.trim()) { notify('Укажите причину скидки.', 'error'); return; }
    setBusy(true);
    try {
      const payload = { payment_type: paymentType, discount_percent: Number(discountPercent) || 0, discount_reason: discountReason.trim() || null, items: lines.map(line => ({ product_id: line.product.id, quantity: line.quantity })) };
      if (paymentType === 'cash') payload.cash_received = received;
      if (paymentType === 'debt') payload.customer_id = selectedCustomer.id;
      const { data } = await api.post('/sales', payload);
      setLastSale(data.sale);
      notify(`Продажа №${data.sale.id} проведена на ${formatMoney(data.sale.total_amount)}.`);
      setCart({}); setQuantityDrafts({}); setCashReceived(''); setPaymentOpen(false); setDiscountPercent('0'); setDiscountReason('');
      setReceiptTab('check'); await Promise.all([loadProducts(), loadCustomers()]);
    } catch (error) { notify(getErrorMessage(error, 'Не удалось провести продажу.'), 'error'); }
    finally { setBusy(false); }
  }

  async function createCustomer(event) {
    event.preventDefault();
    if (!newCustomer.name.trim()) return;
    setBusy(true);
    try {
      const { data } = await api.post('/customers', { name: newCustomer.name.trim(), phone: newCustomer.phone.trim() || null });
      setCustomers(current => [...current, data.customer].sort((a, b) => a.name.localeCompare(b.name, 'ru')));
      setSelectedCustomer(data.customer); setNewCustomer({ name: '', phone: '' }); setCustomerModal(false); notify('Клиент добавлен.');
    } catch (error) { notify(getErrorMessage(error, 'Не удалось создать клиента.'), 'error'); }
    finally { setBusy(false); }
  }

  async function submitDebtPayment(event) {
    event.preventDefault();
    if (!selectedCustomer || Number(debtPayAmount) <= 0) return;
    setBusy(true);
    try {
      const payload = { payment_type: debtPayType, amount: Number(debtPayAmount) };
      if (debtPayType === 'cash') payload.cash_received = Number(debtPayReceived) || 0;
      const { data } = await api.post(`/customers/${selectedCustomer.id}/pay-debt`, payload);
      setSelectedCustomer(data.payment.customer);
      setDebtPayOpen(false); setDebtPayAmount(''); setDebtPayReceived('');
      notify(`Принята оплата долга ${formatMoney(data.payment.amount)}. Сдача: ${formatMoney(data.payment.change_amount)}.`);
      await loadCustomers();
    } catch (error) { notify(getErrorMessage(error, 'Не удалось принять оплату долга.'), 'error'); }
    finally { setBusy(false); }
  }

  function printLastReceipt() {
    if (!lastSale) return;
    window.print();
  }

  return <div className="space-y-4">
    <div className={`flex flex-wrap items-center justify-between gap-3 rounded-2xl border px-4 py-3 ${shiftOpen ? 'border-emerald-200 bg-emerald-50/80' : 'border-amber-200 bg-amber-50/80'}`}><div className="flex items-center gap-2.5"><span className={`h-2.5 w-2.5 rounded-full ${shiftLoading ? 'animate-pulse bg-blue-400' : shiftOpen ? 'bg-emerald-500' : 'bg-amber-500'}`}/><span className="text-sm font-bold">{shiftLoading ? 'Проверяем смену…' : shiftOpen ? 'Смена открыта' : 'Смена не открыта'}</span><span className="hidden text-sm text-slate-500 sm:inline">{shiftOpen ? 'Продажи доступны' : 'Откройте смену перед продажей'}</span></div>{shiftOpen ? <button disabled={busy || shiftLoading} onClick={closeShift} className="rounded-lg border border-rose-200 bg-white px-3 py-2 text-xs font-bold text-rose-700 hover:bg-rose-50 disabled:opacity-50">{busy ? 'Подождите…' : 'Закрыть смену'}</button> : <button disabled={busy || shiftLoading} onClick={openShift} className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-bold text-white hover:bg-blue-700 disabled:opacity-50">{shiftLoading ? 'Проверяем…' : busy ? 'Подождите…' : 'Открыть смену'}</button>}</div>
    {lastSale && <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm"><span className="font-bold text-emerald-950">Чек №{lastSale.id} готов · {formatMoney(lastSale.total_amount)}</span><button onClick={printLastReceipt} className="rounded-lg bg-emerald-700 px-3 py-2 text-xs font-bold text-white hover:bg-emerald-800">Распечатать чек</button></div>}
    {closeSummary && <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm"><span className="font-bold text-blue-950">Смена закрыта · Выручка {formatMoney(closeSummary.total_revenue)} · Прибыль {formatMoney(closeSummary.net_profit)}</span><button onClick={() => setCloseSummary(null)} className="text-blue-700">Скрыть</button></div>}

    <div className="grid min-h-[calc(100vh-190px)] gap-4 2xl:grid-cols-[minmax(500px,1.02fr)_minmax(480px,.98fr)]">
      <section className="flex min-h-[650px] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-card">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4"><div><p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Текущий чек</p><h1 className="mt-1 text-xl font-extrabold">Новый чек</h1><p className="mt-1 text-sm text-slate-500">{selectedCustomer ? `Клиент: ${selectedCustomer.name}` : "Гость"}</p></div><button onClick={() => { setCart({}); setQuantityDrafts({}); }} disabled={!lines.length} className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-500 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-40">Очистить чек</button></div>
        <div className="flex border-b border-slate-100 px-4"><button onClick={() => setReceiptTab('check')} className={`border-b-2 px-4 py-3 text-sm font-bold ${receiptTab === 'check' ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-400 hover:text-slate-700'}`}>Чек <span className="ml-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs">{lines.length}</span></button><button onClick={() => setReceiptTab('customer')} className={`border-b-2 px-4 py-3 text-sm font-bold ${receiptTab === 'customer' ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-400 hover:text-slate-700'}`}>Клиент</button></div>

        {receiptTab === 'check' ? <div className="flex-1 overflow-auto"><table className="w-full min-w-[650px] text-left text-sm"><thead className="sticky top-0 bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-3 font-semibold">Наименование</th><th className="px-3 py-3 text-center font-semibold">Кол-во</th><th className="px-3 py-3 text-right font-semibold">Цена</th><th className="px-4 py-3 text-right font-semibold">Итого</th><th className="w-8"/></tr></thead><tbody className="divide-y divide-slate-100">{lines.map(({ product, quantity }) => <tr key={product.id} className="align-middle"><td className="max-w-56 px-4 py-3.5"><p className="truncate font-semibold" title={product.name}>{product.name}</p><p className="mt-0.5 text-xs text-slate-400">{product.sku || (product.unit === 'm' ? 'Мерный товар' : 'Штучный товар')}</p></td><td className="px-2 py-3"><div className="flex items-center justify-center gap-1"><button onClick={() => adjustCartQuantity(product.id, -1)} aria-label="Уменьшить количество" className="flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 text-slate-500 hover:bg-slate-50">−</button><input aria-label={`Количество ${product.name}`} type="number" min={product.unit === 'm' ? '0.01' : '1'} max={product.stock_quantity} step={product.unit === 'm' ? '0.01' : '1'} value={quantityDrafts[product.id] ?? quantity} onChange={event => setQuantityDrafts(current => ({ ...current, [product.id]: event.target.value }))} onBlur={event => { if (event.target.value !== '') changeCartQuantity(product.id, event.target.value); setQuantityDrafts(current => { const next = { ...current }; delete next[product.id]; return next; }); }} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }} className="w-[76px] rounded-lg border border-slate-200 px-1 py-1.5 text-center text-sm font-semibold outline-none focus:border-blue-400"/><button onClick={() => adjustCartQuantity(product.id, 1)} aria-label="Увеличить количество" className="flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 text-slate-500 hover:bg-slate-50">+</button><span className="w-6 text-xs text-slate-400">{unitName(product)}</span></div></td><td className="whitespace-nowrap px-3 py-3.5 text-right text-slate-600">{formatMoney(product.retail_price)}</td><td className="whitespace-nowrap px-4 py-3.5 text-right font-bold">{formatMoney(product.retail_price * quantity)}</td><td className="pr-3"><button aria-label={`Удалить ${product.name}`} onClick={() => removeLine(product.id)} className="rounded-md px-2 py-1 text-lg text-slate-300 hover:bg-rose-50 hover:text-rose-600">×</button></td></tr>)}</tbody></table>{lines.length === 0 && <div className="flex h-64 flex-col items-center justify-center px-6 text-center"><div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-2xl text-slate-400">▤</div><p className="mt-4 font-semibold text-slate-700">Чек пока пуст</p><p className="mt-1 text-sm text-slate-400">Выберите товар в каталоге справа</p></div>}</div> : <div className="flex-1 overflow-auto p-5"><div className="max-w-xl rounded-2xl border border-slate-200 bg-slate-50 p-5"><div className="flex items-center justify-between"><div><h2 className="font-bold">Клиент чека</h2><p className="mt-1 text-sm text-slate-500">Выберите клиента для продажи в долг или добавьте нового.</p></div><button onClick={() => setCustomerModal(true)} className="rounded-xl bg-blue-600 px-3 py-2 text-xs font-bold text-white hover:bg-blue-700">＋ Новый клиент</button></div><input value={customerSearch} onChange={event => setCustomerSearch(event.target.value)} placeholder="Поиск по имени или телефону" className="mt-4 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-3 text-sm outline-none focus:border-blue-400"/><div className="mt-3 max-h-72 space-y-2 overflow-auto">{customers.filter(customer => `${customer.name} ${customer.phone || ''}`.toLowerCase().includes(customerSearch.toLowerCase())).map(customer => <button key={customer.id} onClick={() => setSelectedCustomer(customer)} className={`flex w-full items-center justify-between rounded-xl border p-3 text-left ${selectedCustomer?.id === customer.id ? 'border-blue-300 bg-blue-50 ring-2 ring-blue-100' : 'border-slate-200 bg-white hover:border-slate-300'}`}><span><span className="block font-semibold">{customer.name}</span><span className="mt-0.5 block text-xs text-slate-400">{customer.phone || 'Телефон не указан'}</span></span><span className="text-right"><span className="block text-xs text-slate-400">Долг</span><span className={`font-bold ${customer.debt_amount > 0 ? 'text-rose-600' : 'text-emerald-700'}`}>{formatMoney(customer.debt_amount)}</span></span></button>)}{customers.length === 0 && <p className="py-8 text-center text-sm text-slate-400">Клиентов пока нет. Добавьте первого клиента.</p>}</div>{selectedCustomer && <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-white p-3"><span className="text-sm text-slate-500">Выбран клиент: <strong className="text-slate-900">{selectedCustomer.name}</strong> · долг <strong className="text-rose-600">{formatMoney(selectedCustomer.debt_amount)}</strong></span><div className="flex items-center gap-2">{selectedCustomer.debt_amount > 0 && <button onClick={() => { setDebtPayAmount(String(selectedCustomer.debt_amount)); setDebtPayReceived(String(selectedCustomer.debt_amount)); setDebtPayOpen(true); }} className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white hover:bg-emerald-700">Погасить долг</button>}<button onClick={() => setSelectedCustomer(null)} className="text-xs font-semibold text-rose-600">Снять выбор</button></div></div>}</div></div>}

        <div className="border-t border-slate-100 bg-slate-50/80 p-5">{user.role === 'admin' && <div className="mb-4 grid gap-2 sm:grid-cols-[130px_1fr]"><label className="text-xs font-semibold text-slate-500">Скидка, %<input type="number" min="0" max="100" step="1" value={discountPercent} onChange={event => setDiscountPercent(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-bold outline-none focus:border-blue-400"/></label><label className="text-xs font-semibold text-slate-500">Причина скидки<input maxLength="200" value={discountReason} onChange={event => setDiscountReason(event.target.value)} placeholder="Например, акция или решение менеджера" disabled={Number(discountPercent) <= 0} className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-400 disabled:bg-slate-100"/></label></div>}<div className="mb-4 flex items-end justify-between"><div><p className="text-sm text-slate-500">{lines.length} {pluralize(lines.length, 'позиция', 'позиции', 'позиций')} в чеке</p><p className="mt-1 font-semibold text-slate-700">{discount > 0 ? <>Сумма {formatMoney(subtotal)} · скидка −{formatMoney(discount)}</> : 'Итого к оплате'}</p></div><p className="text-4xl font-black tracking-tight text-slate-950">{formatMoney(total)}</p></div><button onClick={() => { setPaymentType('cash'); setCashReceived(''); setPaymentOpen(true); }} disabled={!lines.length || !shiftOpen || shiftLoading || busy} className="flex w-full items-center justify-center gap-3 rounded-2xl bg-emerald-600 px-5 py-4 text-lg font-extrabold text-white shadow-lg shadow-emerald-600/20 transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:shadow-none"><span>Оплатить</span><span className="text-emerald-100">{formatMoney(total)} →</span></button>{!shiftOpen && <p className="mt-2 text-center text-xs text-amber-700">Сначала откройте смену</p>}</div>
      </section>

      <section className="flex min-h-[650px] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-card"><div className="border-b border-slate-100 p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Каталог</p><div className="mt-1 flex items-center gap-2 text-lg font-extrabold"><button onClick={() => setSelectedCategory('Все товары')} className={selectedCategory === 'Все товары' ? 'text-slate-950' : 'text-blue-600 hover:underline'}>Все товары</button>{selectedCategory !== 'Все товары' && <><span className="text-slate-300">›</span><span>{selectedCategory}</span></>}</div></div><div className="flex items-center gap-2"><button onClick={() => { setSearchOpen(value => !value); setSearch(''); }} aria-label="Быстрый поиск" className={`flex h-10 w-10 items-center justify-center rounded-xl border ${searchOpen ? 'border-blue-200 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}>⌕</button><div className="relative"><button onClick={() => setStockFilter(value => value === 'all' ? 'low' : value === 'low' ? 'available' : value === 'available' ? 'empty' : 'all')} className="flex h-10 items-center gap-2 rounded-xl border border-slate-200 px-3 text-xs font-semibold text-slate-600 hover:bg-slate-50"><span>☷</span><span>{stockFilter === 'all' ? 'Все остатки' : stockFilter === 'low' ? 'Заканчиваются' : stockFilter === 'available' ? 'В наличии' : 'Нет в наличии'}</span></button></div></div></div>{searchOpen && <input ref={searchInputRef} autoFocus value={search} onChange={event => setSearch(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); scanSku(event.currentTarget.value); } }} placeholder="Найти товар или отсканируйте штрихкод → Enter" className="mt-4 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none focus:border-blue-400 focus:bg-white focus:ring-4 focus:ring-blue-50"/>}
        <div className="mt-4 flex gap-2 overflow-x-auto pb-1">{categories.map(category => <button key={category} onClick={() => setSelectedCategory(category)} className={`shrink-0 rounded-full px-3.5 py-2 text-xs font-bold transition ${selectedCategory === category ? 'bg-slate-950 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>{category}</button>)}</div></div>
        {loading ? <div className="flex flex-1 items-center justify-center text-sm text-slate-400">Загружаем каталог…</div> : visibleProducts.length === 0 ? <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-slate-400">В этой категории товары не найдены.</div> : <div className="grid flex-1 content-start grid-cols-2 gap-3 overflow-y-auto p-4 sm:grid-cols-3 xl:grid-cols-3 2xl:grid-cols-4">{visibleProducts.map((product, index) => <button key={product.id} onClick={() => selectProduct(product)} disabled={Number(product.stock_quantity) <= 0} className="group relative flex min-h-36 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white p-4 text-left transition hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-lg disabled:cursor-not-allowed disabled:opacity-50"><span className={`absolute inset-x-0 top-0 h-1 ${['bg-blue-400', 'bg-violet-400', 'bg-emerald-400', 'bg-amber-400'][index % 4]}`}/><span className="mt-1 flex h-16 w-full items-center justify-center overflow-hidden rounded-xl bg-slate-50 text-2xl text-slate-300">{product.image_url ? <img src={product.image_url} alt="" loading="lazy" className="h-full w-full object-cover" onError={event => { event.currentTarget.style.display = 'none'; }}/> : '▦'}</span><span className="line-clamp-2 min-h-10 pr-2 text-sm font-bold leading-5 text-slate-800">{product.name}</span><span className="mt-2 text-lg font-extrabold text-slate-950">{formatMoney(product.retail_price)}<span className="ml-1 text-xs font-medium text-slate-400">/ {unitName(product)}</span></span><span className={`mt-auto pt-3 text-xs font-semibold ${product.stock_quantity <= Number(product.low_stock_threshold ?? 5) ? 'text-amber-700' : 'text-slate-400'}`}>{product.stock_quantity <= Number(product.low_stock_threshold ?? 5) ? 'Низкий остаток · ' : 'Остаток · '}{quantityText(product.stock_quantity, product)}</span><span className="absolute bottom-3 right-3 flex h-7 w-7 items-center justify-center rounded-lg bg-blue-50 text-lg font-semibold text-blue-600 transition group-hover:bg-blue-600 group-hover:text-white">＋</span></button>)}</div>}
        <div className="flex items-center justify-between border-t border-slate-100 px-5 py-3 text-xs text-slate-400"><span>{visibleProducts.length} из {products.length} товаров</span><span>Категории каталога</span></div>
      </section>
    </div>

    {paymentOpen && <div role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !busy) setPaymentOpen(false); }} className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm"><section role="dialog" aria-modal="true" aria-labelledby="payment-title" className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl sm:p-8"><div className="flex items-start justify-between"><div><p className="text-sm font-semibold text-emerald-700">Завершение продажи</p><h2 id="payment-title" className="mt-1 text-2xl font-extrabold">К оплате {formatMoney(total)}</h2></div><button disabled={busy} onClick={() => setPaymentOpen(false)} aria-label="Закрыть оплату" className="rounded-lg px-2 py-1 text-xl text-slate-400 hover:bg-slate-100">×</button></div><form onSubmit={submitPayment} className="mt-6"><div className="grid grid-cols-3 gap-2"><button type="button" onClick={() => setPaymentType('cash')} className={`rounded-2xl border p-3 text-left transition ${paymentType === 'cash' ? 'border-emerald-300 bg-emerald-50 ring-2 ring-emerald-100' : 'border-slate-200 hover:bg-slate-50'}`}><span className="text-xl">▤</span><span className="mt-2 block text-sm font-bold">Наличные</span></button><button type="button" onClick={() => setPaymentType('card')} className={`rounded-2xl border p-3 text-left transition ${paymentType === 'card' ? 'border-blue-300 bg-blue-50 ring-2 ring-blue-100' : 'border-slate-200 hover:bg-slate-50'}`}><span className="text-xl">▰</span><span className="mt-2 block text-sm font-bold">Карта</span></button><button type="button" onClick={() => { setPaymentType('debt'); setCashReceived(''); }} className={`rounded-2xl border p-3 text-left transition ${paymentType === 'debt' ? 'border-violet-300 bg-violet-50 ring-2 ring-violet-100' : 'border-slate-200 hover:bg-slate-50'}`}><span className="text-xl">◷</span><span className="mt-2 block text-sm font-bold">В долг</span></button></div>{paymentType === 'cash' ? <><label htmlFor="payment-cash-received" className="mb-2 mt-5 block text-sm font-semibold">Внесено клиентом, ₸</label><input id="payment-cash-received" type="number" min="0" step="0.01" autoFocus value={cashReceived} onChange={event => setCashReceived(event.target.value)} placeholder="0" className="w-full rounded-xl border border-slate-200 px-4 py-3.5 text-xl font-bold outline-none focus:border-emerald-400 focus:ring-4 focus:ring-emerald-50"/><div className="mt-3 flex items-center justify-between rounded-xl bg-emerald-50 px-4 py-3.5"><span className="text-sm font-semibold text-emerald-900">Сдача</span><span className="text-lg font-extrabold text-emerald-700">{formatMoney(change)}</span></div></> : paymentType === 'card' ? <div className="mt-5 rounded-xl bg-slate-50 px-4 py-4 text-sm text-slate-600">Оплата банковской картой на сумму <strong>{formatMoney(total)}</strong>.</div> : <div className="mt-5 rounded-xl bg-violet-50 px-4 py-4 text-sm text-violet-900">{selectedCustomer ? <>Сумма <strong>{formatMoney(total)}</strong> будет добавлена к долгу клиента <strong>{selectedCustomer.name}</strong>.</> : <>Для продажи в долг выберите клиента во вкладке «Клиент».</>}</div>}<button type="submit" disabled={busy || !lines.length || (paymentType === 'cash' && received < total) || (paymentType === 'debt' && !selectedCustomer)} className="mt-6 w-full rounded-2xl bg-emerald-600 px-4 py-4 text-lg font-extrabold text-white shadow-lg shadow-emerald-600/20 hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:shadow-none">{busy ? 'Проводим оплату…' : 'Подтвердить оплату'}</button></form></section></div>}

    {debtPayOpen && selectedCustomer && <div role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !busy) setDebtPayOpen(false); }} className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-sm"><section role="dialog" aria-modal="true" aria-labelledby="debt-payment-title" className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"><div className="flex items-start justify-between"><div><h2 id="debt-payment-title" className="text-xl font-extrabold">Погашение долга</h2><p className="mt-1 text-sm text-slate-500">{selectedCustomer.name} · долг {formatMoney(selectedCustomer.debt_amount)}</p></div><button onClick={() => setDebtPayOpen(false)} className="text-xl text-slate-400">×</button></div><form onSubmit={submitDebtPayment} className="mt-5 space-y-4"><label className="block text-sm font-semibold">Сумма оплаты, ₸<input required type="number" min="0.01" max={selectedCustomer.debt_amount} step="0.01" value={debtPayAmount} onChange={event => { setDebtPayAmount(event.target.value); if (debtPayType === 'cash') setDebtPayReceived(event.target.value); }} className="mt-1.5 w-full rounded-xl border border-slate-200 px-3.5 py-3 outline-none focus:border-blue-400"/></label><div className="grid grid-cols-2 gap-2"><button type="button" onClick={() => { setDebtPayType('cash'); setDebtPayReceived(debtPayAmount); }} className={`rounded-xl border px-3 py-2.5 text-sm font-bold ${debtPayType === 'cash' ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : 'border-slate-200 text-slate-500'}`}>Наличные</button><button type="button" onClick={() => setDebtPayType('card')} className={`rounded-xl border px-3 py-2.5 text-sm font-bold ${debtPayType === 'card' ? 'border-blue-300 bg-blue-50 text-blue-800' : 'border-slate-200 text-slate-500'}`}>Карта</button></div>{debtPayType === 'cash' && <><label className="block text-sm font-semibold">Внесено клиентом, ₸<input required type="number" min={debtPayAmount || '0.01'} step="0.01" value={debtPayReceived} onChange={event => setDebtPayReceived(event.target.value)} className="mt-1.5 w-full rounded-xl border border-slate-200 px-3.5 py-3 outline-none focus:border-blue-400"/></label><p className="rounded-xl bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">Сдача: {formatMoney(Math.max(0, (Number(debtPayReceived) || 0) - (Number(debtPayAmount) || 0)))}</p></>}<button disabled={busy || Number(debtPayAmount) <= 0 || Number(debtPayAmount) > selectedCustomer.debt_amount || (debtPayType === 'cash' && Number(debtPayReceived) < Number(debtPayAmount))} className="w-full rounded-xl bg-emerald-600 px-4 py-3 font-bold text-white hover:bg-emerald-700 disabled:opacity-50">{busy ? 'Проводим оплату…' : 'Принять оплату'}</button></form></section></div>}

    {customerModal && <div role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !busy) setCustomerModal(false); }} className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-sm"><section role="dialog" aria-modal="true" aria-labelledby="new-customer-title" className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"><div className="flex items-start justify-between"><div><h2 id="new-customer-title" className="text-xl font-extrabold">Новый клиент</h2><p className="mt-1 text-sm text-slate-500">Клиент сохранится в общей базе.</p></div><button onClick={() => setCustomerModal(false)} className="text-xl text-slate-400">×</button></div><form onSubmit={createCustomer} className="mt-5 space-y-4"><label className="block text-sm font-semibold">Имя<input required maxLength="200" autoFocus value={newCustomer.name} onChange={event => setNewCustomer(current => ({ ...current, name: event.target.value }))} className="mt-1.5 w-full rounded-xl border border-slate-200 px-3.5 py-3 outline-none focus:border-blue-400"/></label><label className="block text-sm font-semibold">Телефон<input maxLength="50" value={newCustomer.phone} onChange={event => setNewCustomer(current => ({ ...current, phone: event.target.value }))} className="mt-1.5 w-full rounded-xl border border-slate-200 px-3.5 py-3 outline-none focus:border-blue-400"/></label><button disabled={busy} className="w-full rounded-xl bg-blue-600 px-4 py-3 font-bold text-white hover:bg-blue-700 disabled:opacity-50">{busy ? 'Сохраняем…' : 'Создать и выбрать'}</button></form></section></div>}

    {lastSale && <div id="pos-print-receipt" aria-hidden="true"><div className="receipt-paper"><h1>КАССОВЫЙ ЧЕК</h1><p>Чек №{lastSale.id}</p><p>{new Date(lastSale.created_at).toLocaleString('ru-RU', { timeZone: APP_TIME_ZONE })}</p>{lastSale.customer_name && <p>Клиент: {lastSale.customer_name}</p>}<hr/>{lastSale.items.map((item, index) => <div className="receipt-line" key={`${item.product_id}-${index}`}><span>{item.name} · {item.quantity} × {formatMoney(item.price_at_sale)}</span><strong>{formatMoney(item.quantity * item.price_at_sale)}</strong></div>)}<hr/>{lastSale.discount_amount > 0 && <p>Скидка: −{formatMoney(lastSale.discount_amount)}{lastSale.discount_reason ? ` (${lastSale.discount_reason})` : ''}</p>}<p className="receipt-total">ИТОГО: {formatMoney(lastSale.total_amount)}</p><p>Оплата: {{ cash: 'Наличные', card: 'Карта', debt: 'В долг' }[lastSale.payment_type]}</p>{lastSale.payment_type === 'cash' && <><p>Внесено: {formatMoney(lastSale.cash_received)}</p><p>Сдача: {formatMoney(lastSale.change_amount)}</p></>}<p className="receipt-thanks">Спасибо за покупку!</p></div></div>}

    {quantityProduct && <div role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setQuantityProduct(null); }} className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-sm"><section role="dialog" aria-modal="true" aria-labelledby="quantity-title" className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl"><div className="flex items-start justify-between"><div><h2 id="quantity-title" className="text-xl font-extrabold">Сколько отрезать?</h2><p className="mt-1 text-sm text-slate-500">{quantityProduct.name} · остаток {quantityText(quantityProduct.stock_quantity, quantityProduct)}</p></div><button onClick={() => setQuantityProduct(null)} aria-label="Закрыть" className="text-xl text-slate-400">×</button></div><form onSubmit={confirmMeasuredQuantity} className="mt-5"><label htmlFor="measured-quantity" className="mb-2 block text-sm font-semibold">Длина, метры</label><div className="relative"><input id="measured-quantity" autoFocus type="number" min="0.01" max={quantityProduct.stock_quantity} step="0.01" value={quantityValue} onChange={event => setQuantityValue(event.target.value)} className="w-full rounded-xl border border-slate-200 px-4 py-4 pr-12 text-2xl font-extrabold outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-50"/><span className="absolute right-4 top-5 font-semibold text-slate-400">м</span></div><p className="mt-3 text-sm text-slate-500">К оплате: <strong className="text-slate-900">{formatMoney(quantityProduct.retail_price * (Number(quantityValue) || 0))}</strong></p><button className="mt-5 w-full rounded-xl bg-blue-600 px-4 py-3 font-bold text-white hover:bg-blue-700">Добавить в чек</button></form></section></div>}
  </div>;
}

export function getInitialShiftState(userId) { return readShiftFlag(userId); }
