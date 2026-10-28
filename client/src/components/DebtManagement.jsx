import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import api, { getErrorMessage } from '../api';
import { formatDateTime, formatMoney } from '../utils';

const paymentLabel = type => type === 'cash' ? 'Наличные' : type === 'card' ? 'Карта' : 'Продажа в долг';

function PaymentModal({ customer, busy, onClose, onSubmit }) {
  const [type, setType] = useState('cash');
  const [amount, setAmount] = useState(String(customer.debt_amount));
  const [received, setReceived] = useState(String(customer.debt_amount));
  const paymentAmount = Number(amount) || 0;
  const tendered = type === 'cash' ? Number(received) || 0 : paymentAmount;
  const change = Math.max(0, tendered - paymentAmount);

  useEffect(() => {
    const handleKey = event => { if (event.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [busy, onClose]);

  function submit(event) {
    event.preventDefault();
    onSubmit({ payment_type: type, amount: paymentAmount, cash_received: type === 'cash' ? tendered : undefined });
  }

  return <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/50 p-0 backdrop-blur-sm sm:items-center sm:p-4" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <section role="dialog" aria-modal="true" aria-labelledby="debt-payment-title" className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-white p-5 shadow-2xl sm:rounded-3xl sm:p-7">
      <header className="flex items-start justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-wider text-emerald-700">Погашение задолженности</p><h2 id="debt-payment-title" className="mt-1 text-2xl font-extrabold">{customer.name}</h2><p className="mt-1 text-sm text-slate-500">Текущий долг: {formatMoney(customer.debt_amount)}</p></div><button type="button" disabled={busy} onClick={onClose} aria-label="Закрыть" className="rounded-lg px-2 py-1 text-xl text-slate-400 hover:bg-slate-100 disabled:opacity-50">×</button></header>
      <form onSubmit={submit} className="mt-6 space-y-4">
        <div className="grid grid-cols-2 gap-2"><button type="button" onClick={() => { setType('cash'); setReceived(amount); }} className={`rounded-xl border px-3 py-3 text-sm font-bold ${type === 'cash' ? 'border-emerald-300 bg-emerald-50 text-emerald-800 ring-2 ring-emerald-100' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}>Наличные</button><button type="button" onClick={() => setType('card')} className={`rounded-xl border px-3 py-3 text-sm font-bold ${type === 'card' ? 'border-blue-300 bg-blue-50 text-blue-800 ring-2 ring-blue-100' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}>Карта</button></div>
        <label className="block text-sm font-semibold text-slate-700">Сумма погашения, ₸<input autoFocus required type="number" min="0.01" max={customer.debt_amount} step="0.01" value={amount} onChange={event => { setAmount(event.target.value); if (type === 'cash') setReceived(event.target.value); }} className="mt-1.5 w-full rounded-xl border border-slate-200 px-4 py-3 text-lg font-bold outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-50"/></label>
        {type === 'cash' && <><label className="block text-sm font-semibold text-slate-700">Получено наличными, ₸<input required type="number" min={amount || '0.01'} step="0.01" value={received} onChange={event => setReceived(event.target.value)} className="mt-1.5 w-full rounded-xl border border-slate-200 px-4 py-3 text-lg font-bold outline-none focus:border-emerald-400 focus:ring-4 focus:ring-emerald-50"/></label><div className="flex items-center justify-between rounded-xl bg-emerald-50 px-4 py-3 text-sm"><span className="font-semibold text-emerald-900">Сдача</span><span className="font-extrabold text-emerald-700">{formatMoney(change)}</span></div></>}
        <div className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-600">Остаток после оплаты: <strong className="text-slate-900">{formatMoney(Math.max(0, customer.debt_amount - paymentAmount))}</strong></div>
        <button type="submit" disabled={busy || paymentAmount <= 0 || paymentAmount > customer.debt_amount || (type === 'cash' && tendered < paymentAmount)} className="w-full rounded-xl bg-emerald-600 px-4 py-3.5 font-bold text-white shadow-lg shadow-emerald-600/15 hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:shadow-none">{busy ? 'Сохраняем оплату…' : `Принять ${formatMoney(paymentAmount)}`}</button>
      </form>
    </section>
  </div>;
}

function DebtHistoryModal({ customer, transactions, loading, onClose }) {
  useEffect(() => {
    const handleKey = event => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  return <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/50 p-0 backdrop-blur-sm sm:items-center sm:p-4" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section role="dialog" aria-modal="true" aria-labelledby="debt-history-title" className="max-h-[90vh] w-full max-w-2xl overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:rounded-3xl">
      <header className="flex items-start justify-between border-b border-slate-100 p-5 sm:p-6"><div><p className="text-xs font-bold uppercase tracking-wider text-blue-600">Движение по долгу</p><h2 id="debt-history-title" className="mt-1 text-xl font-extrabold">{customer.name}</h2><p className="mt-1 text-sm text-slate-500">Текущий остаток: {formatMoney(customer.debt_amount)}</p></div><button type="button" onClick={onClose} aria-label="Закрыть историю" className="rounded-lg px-2 py-1 text-xl text-slate-400 hover:bg-slate-100">×</button></header>
      <div className="max-h-[calc(90vh-100px)] overflow-auto">
        {loading ? <div className="p-12 text-center text-sm text-slate-500">Загружаем историю…</div> : transactions.length === 0 ? <div className="p-12 text-center"><p className="font-semibold text-slate-700">Движений по долгу пока нет</p><p className="mt-1 text-sm text-slate-500">Здесь появятся продажи в долг и их погашения.</p></div> : <table className="w-full min-w-[600px] text-left text-sm"><thead className="sticky top-0 bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-5 py-3 font-bold">Дата</th><th className="px-5 py-3 font-bold">Операция</th><th className="px-5 py-3 font-bold">Кассир</th><th className="px-5 py-3 text-right font-bold">Изменение долга</th></tr></thead><tbody className="divide-y divide-slate-100">{transactions.map(transaction => { const debtAdded = transaction.type === 'debt'; return <tr key={`${transaction.type}-${transaction.id}`}><td className="whitespace-nowrap px-5 py-4 text-slate-600">{formatDateTime(transaction.created_at)}</td><td className="px-5 py-4"><span className={`font-semibold ${debtAdded ? 'text-rose-700' : 'text-slate-700'}`}>{debtAdded ? 'Покупка в долг' : `Погашение · ${paymentLabel(transaction.payment_type)}`}</span>{transaction.receipt_id && <span className="mt-0.5 block text-xs text-slate-400">Чек №{transaction.receipt_id}</span>}{transaction.type === 'payment' && transaction.change_amount > 0 && <span className="mt-0.5 block text-xs text-slate-400">Сдача {formatMoney(transaction.change_amount)}</span>}</td><td className="px-5 py-4 text-slate-600">{transaction.cashier_name || '—'}</td><td className={`px-5 py-4 text-right font-bold ${debtAdded ? 'text-rose-700' : 'text-emerald-700'}`}>{debtAdded ? '+' : '−'}{formatMoney(transaction.amount)}</td></tr>; })}</tbody></table>}
      </div>
    </section>
  </div>;
}

export default function DebtManagement({ notify }) {
  const [customers, setCustomers] = useState([]);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('debtors');
  const [loading, setLoading] = useState(true);
  const [shiftOpen, setShiftOpen] = useState(false);
  const [paymentCustomer, setPaymentCustomer] = useState(null);
  const [historyCustomer, setHistoryCustomer] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadCustomers = useCallback(async () => {
    setLoading(true);
    try {
      const [{ data: customerData }, { data: shiftData }] = await Promise.all([api.get('/customers'), api.get('/shifts/current')]);
      setCustomers(customerData.customers || []);
      setShiftOpen(Boolean(shiftData.shift));
    } catch (error) { notify(getErrorMessage(error, 'Не удалось загрузить список долгов.'), 'error'); }
    finally { setLoading(false); }
  }, [notify]);

  useEffect(() => { loadCustomers(); }, [loadCustomers]);

  const debtors = useMemo(() => customers.filter(customer => Number(customer.debt_amount) > 0), [customers]);
  const totalDebt = useMemo(() => debtors.reduce((sum, customer) => sum + Number(customer.debt_amount), 0), [debtors]);
  const filteredCustomers = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('ru');
    return customers.filter(customer => {
      const hasDebt = Number(customer.debt_amount) > 0;
      const matchesFilter = filter === 'all' || (filter === 'debtors' ? hasDebt : !hasDebt);
      const matchesSearch = !query || `${customer.name} ${customer.phone || ''}`.toLocaleLowerCase('ru').includes(query);
      return matchesFilter && matchesSearch;
    });
  }, [customers, filter, search]);

  async function collectPayment(payload) {
    if (!paymentCustomer) return;
    setSaving(true);
    try {
      const { data } = await api.post(`/customers/${paymentCustomer.id}/pay-debt`, payload);
      notify(`Долг клиента ${paymentCustomer.name} уменьшен на ${formatMoney(data.payment.amount)}.`);
      setPaymentCustomer(null);
      await loadCustomers();
      if (historyCustomer?.id === paymentCustomer.id) {
        setHistoryCustomer(data.payment.customer);
        await loadPaymentHistory(data.payment.customer);
      }
    } catch (error) { notify(getErrorMessage(error, 'Не удалось принять оплату долга.'), 'error'); }
    finally { setSaving(false); }
  }

  async function openPaymentHistory(customer) {
    setHistoryCustomer(customer);
    await loadPaymentHistory(customer);
  }

  async function loadPaymentHistory(customer) {
    setHistoryLoading(true);
    try { const { data } = await api.get(`/customers/${customer.id}/debt-history`); setTransactions(data.transactions || []); }
    catch (error) { setTransactions([]); notify(getErrorMessage(error, 'Не удалось загрузить историю долга.'), 'error'); }
    finally { setHistoryLoading(false); }
  }

  return <div className="mx-auto max-w-7xl space-y-6">
    <header className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-sm font-semibold text-blue-600">Клиенты и расчёты</p><h1 className="mt-1 text-3xl font-extrabold tracking-tight text-slate-950">Долги клиентов</h1><p className="mt-2 text-sm text-slate-500">Текущие задолженности и поступившие погашения.</p></div><Link to="/" className="rounded-xl bg-blue-600 px-4 py-3 text-sm font-bold text-white shadow-lg shadow-blue-600/15 transition hover:bg-blue-700">Перейти в кассу</Link></header>

    <div className="grid gap-4 sm:grid-cols-2"><article className="rounded-2xl border border-rose-100 bg-gradient-to-br from-rose-600 to-orange-600 p-5 text-white shadow-card"><p className="text-sm font-semibold text-rose-100">Общая сумма долга</p><p className="mt-3 text-3xl font-extrabold tracking-tight">{loading ? '…' : formatMoney(totalDebt)}</p><p className="mt-2 text-xs text-rose-100">Сумма непогашенных задолженностей клиентов</p></article><article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-card"><p className="text-sm font-semibold text-slate-500">Клиентов с долгом</p><p className="mt-3 text-3xl font-extrabold tracking-tight text-slate-950">{loading ? '…' : debtors.length}</p><p className="mt-2 text-xs text-slate-400">Из {customers.length} клиентов в базе</p></article></div>

    {!shiftOpen && <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3"><p className="text-sm text-amber-900">Чтобы принять оплату долга, сначала откройте свою смену.</p><Link to="/" className="rounded-lg bg-amber-600 px-3 py-2 text-xs font-bold text-white hover:bg-amber-700">Открыть кассу</Link></div>}

    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-card"><div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 p-5"><div><h2 className="font-bold text-slate-900">Список клиентов</h2><p className="mt-1 text-sm text-slate-500">Погашайте долг полностью или частями</p></div><div className="grid w-full gap-2 sm:w-auto sm:grid-cols-[minmax(220px,1fr)_180px]"><input aria-label="Поиск клиента" value={search} onChange={event => setSearch(event.target.value)} placeholder="Имя или телефон" className="rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm outline-none focus:border-blue-400 focus:bg-white"/><select aria-label="Фильтр клиентов по долгу" value={filter} onChange={event => setFilter(event.target.value)} className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-blue-400"><option value="debtors">Только с долгом</option><option value="all">Все клиенты</option><option value="paid">Без долга</option></select></div></div>
      <div className="overflow-x-auto"><table className="w-full min-w-[720px] text-left text-sm"><thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-5 py-3.5 font-bold">Клиент</th><th className="px-5 py-3.5 font-bold">Телефон</th><th className="px-5 py-3.5 font-bold">Статус</th><th className="px-5 py-3.5 text-right font-bold">Задолженность</th><th className="px-5 py-3.5 text-right font-bold">Действия</th></tr></thead><tbody className="divide-y divide-slate-100">
        {loading && <tr><td colSpan="5" className="px-5 py-12 text-center text-slate-500">Загружаем клиентов…</td></tr>}
        {!loading && filteredCustomers.map(customer => { const hasDebt = Number(customer.debt_amount) > 0; return <tr key={customer.id} className="hover:bg-slate-50/70"><td className="px-5 py-4"><p className="font-bold text-slate-900">{customer.name}</p><p className="mt-0.5 text-xs text-slate-400">Клиент №{customer.id}</p></td><td className="px-5 py-4 text-slate-600">{customer.phone || 'Не указан'}</td><td className="px-5 py-4"><span className={`rounded-full px-2.5 py-1 text-xs font-bold ${hasDebt ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700'}`}>{hasDebt ? 'Есть долг' : 'Нет долга'}</span></td><td className={`whitespace-nowrap px-5 py-4 text-right font-extrabold ${hasDebt ? 'text-rose-700' : 'text-slate-400'}`}>{formatMoney(customer.debt_amount)}</td><td className="px-5 py-4"><div className="flex justify-end gap-2">{hasDebt && <button type="button" disabled={!shiftOpen} onClick={() => setPaymentCustomer(customer)} className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-300">Принять оплату</button>}<button type="button" onClick={() => openPaymentHistory(customer)} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50">История</button></div></td></tr>; })}
        {!loading && filteredCustomers.length === 0 && <tr><td colSpan="5" className="px-5 py-14 text-center"><p className="font-semibold text-slate-700">{search ? 'Клиенты не найдены' : filter === 'debtors' ? 'Должников нет' : 'Клиентов нет'}</p><p className="mt-1 text-sm text-slate-500">{filter === 'debtors' && !search ? 'Новые задолженности появятся после продажи в долг.' : 'Измените поиск или фильтр.'}</p></td></tr>}
      </tbody></table></div><footer className="border-t border-slate-100 px-5 py-3 text-xs text-slate-400">Показано клиентов: {filteredCustomers.length}</footer></section>
    {paymentCustomer && <PaymentModal customer={paymentCustomer} busy={saving} onClose={() => setPaymentCustomer(null)} onSubmit={collectPayment}/>}
    {historyCustomer && <DebtHistoryModal customer={historyCustomer} transactions={transactions} loading={historyLoading} onClose={() => setHistoryCustomer(null)}/>}
  </div>;
}
