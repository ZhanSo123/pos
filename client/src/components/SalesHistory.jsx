import { useCallback, useEffect, useState } from 'react';
import api, { getErrorMessage } from '../api';
import { formatDateTime, formatMoney } from '../utils';

const paymentLabels = { cash: 'Наличные', card: 'Карта', debt: 'В долг' };
const quantityFormat = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 3 });

function formatDate(value) {
  return formatDateTime(value);
}

function paymentStyle(type) {
  if (type === 'cash') return 'bg-emerald-50 text-emerald-700';
  if (type === 'card') return 'bg-blue-50 text-blue-700';
  return 'bg-violet-50 text-violet-700';
}

function ReceiptDetails({ sale, onClose }) {
  useEffect(() => {
    const onKeyDown = event => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/50 p-0 backdrop-blur-sm sm:items-center sm:p-5" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section role="dialog" aria-modal="true" aria-labelledby="receipt-modal-title" className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-t-3xl bg-white p-5 shadow-2xl sm:rounded-3xl sm:p-7">
      <header className="flex items-start justify-between gap-4 border-b border-slate-100 pb-5">
        <div><p className="text-xs font-bold uppercase tracking-[0.16em] text-blue-600">Информация о продаже</p><h2 id="receipt-modal-title" className="mt-1 text-2xl font-extrabold">Чек №{sale.receipt_number || sale.id}</h2><p className="mt-1 text-sm text-slate-500">{formatDate(sale.created_at)}</p></div>
        <button type="button" onClick={onClose} aria-label="Закрыть" className="rounded-xl p-2 text-xl text-slate-400 hover:bg-slate-100 hover:text-slate-700">×</button>
      </header>

      <div className="grid gap-3 py-5 sm:grid-cols-2">
        <div className="rounded-2xl bg-slate-50 p-4"><p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Кассир</p><p className="mt-1 font-semibold text-slate-800">{sale.cashier_name || '—'}</p></div>
        <div className="rounded-2xl bg-slate-50 p-4"><p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Оплата</p><span className={`mt-1 inline-flex rounded-full px-2.5 py-1 text-sm font-semibold ${paymentStyle(sale.payment_type)}`}>{paymentLabels[sale.payment_type] || sale.payment_type}</span></div>
        {sale.customer_name && <div className="rounded-2xl bg-slate-50 p-4 sm:col-span-2"><p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Клиент</p><p className="mt-1 font-semibold text-slate-800">{sale.customer_name}</p></div>}
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200">
        <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-3 bg-slate-50 px-4 py-3 text-xs font-bold uppercase tracking-wide text-slate-500"><span>Товар</span><span className="text-right">Кол-во</span><span className="text-right">Сумма</span></div>
        <div className="divide-y divide-slate-100">
          {sale.items?.map((item, index) => <div key={`${item.product_id ?? 'removed'}-${index}`} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 px-4 py-3.5">
            <div className="min-w-0"><p className="truncate font-semibold text-slate-800">{item.name}</p><p className="mt-0.5 text-xs text-slate-500">{formatMoney(item.price_at_sale)} за {item.unit === 'm' ? 'м' : 'шт.'}</p></div>
            <span className="text-right text-sm text-slate-600">{quantityFormat.format(item.quantity)}{item.unit === 'm' ? ' м' : ' шт.'}</span>
            <span className="text-right text-sm font-bold text-slate-800">{formatMoney(item.line_total ?? item.price_at_sale * item.quantity)}</span>
          </div>)}
          {!sale.items?.length && <p className="px-4 py-8 text-center text-sm text-slate-500">В этом чеке нет позиций.</p>}
        </div>
      </div>

      <div className="mt-5 space-y-2 rounded-2xl bg-slate-50 p-4 text-sm">
        {sale.discount_amount > 0 && <><div className="flex justify-between text-slate-500"><span>До скидки</span><span>{formatMoney(sale.subtotal_amount)}</span></div><div className="flex justify-between text-rose-600"><span>Скидка{sale.discount_reason ? ` · ${sale.discount_reason}` : ''}</span><span>−{formatMoney(sale.discount_amount)}</span></div></>}
        <div className="flex items-center justify-between border-t border-slate-200 pt-3"><span className="font-semibold text-slate-600">Итого</span><span className="text-2xl font-extrabold tracking-tight text-slate-950">{formatMoney(sale.total_amount)}</span></div>
        {sale.payment_type !== 'debt' && <div className="flex justify-between text-slate-500"><span>Внесено</span><span>{formatMoney(sale.cash_received)}</span></div>}
        {sale.payment_type === 'cash' && <div className="flex justify-between font-semibold text-emerald-700"><span>Сдача</span><span>{formatMoney(sale.change_amount)}</span></div>}
      </div>
      <button type="button" onClick={onClose} className="mt-5 w-full rounded-xl bg-slate-900 px-4 py-3 font-bold text-white transition hover:bg-slate-700">Закрыть</button>
    </section>
  </div>;
}

export default function SalesHistory({ user, notify }) {
  const [filters, setFilters] = useState({ date_from: '', date_to: '', search: '', cashier_id: '' });
  const [appliedFilters, setAppliedFilters] = useState(filters);
  const [page, setPage] = useState(1);
  const [result, setResult] = useState({ sales: [], pagination: { page: 1, limit: 20, total: 0, pages: 0 } });
  const [loading, setLoading] = useState(true);
  const [selectedSale, setSelectedSale] = useState(null);
  const [detailLoadingId, setDetailLoadingId] = useState(null);

  const loadSales = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, limit: 20 };
      if (appliedFilters.date_from) params.date_from = appliedFilters.date_from;
      if (appliedFilters.date_to) params.date_to = appliedFilters.date_to;
      if (appliedFilters.search.trim()) params.search = appliedFilters.search.trim();
      if (user.role === 'admin' && appliedFilters.cashier_id) params.cashier_id = appliedFilters.cashier_id;
      const { data } = await api.get('/sales', { params });
      setResult(data);
    } catch (error) {
      setResult({ sales: [], pagination: { page, limit: 20, total: 0, pages: 0 } });
      notify(getErrorMessage(error, 'Не удалось загрузить историю продаж.'), 'error');
    } finally { setLoading(false); }
  }, [appliedFilters, page, user.role, notify]);

  useEffect(() => { loadSales(); }, [loadSales]);

  async function openSale(id) {
    setDetailLoadingId(id);
    try { const { data } = await api.get(`/sales/${id}`); setSelectedSale(data.sale); }
    catch (error) { notify(getErrorMessage(error, 'Не удалось загрузить данные чека.'), 'error'); }
    finally { setDetailLoadingId(null); }
  }

  function applyFilters(event) { event.preventDefault(); setPage(1); setAppliedFilters({ ...filters }); }
  function resetFilters() { const empty = { date_from: '', date_to: '', search: '', cashier_id: '' }; setFilters(empty); setPage(1); setAppliedFilters(empty); }

  const pagination = result.pagination || { page, limit: 20, total: 0, pages: 0 };
  const firstRow = pagination.total === 0 ? 0 : (pagination.page - 1) * pagination.limit + 1;
  const lastRow = Math.min(pagination.page * pagination.limit, pagination.total);

  return <div className="mx-auto max-w-7xl space-y-6">
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div><p className="text-sm font-semibold text-blue-600">Продажи и чеки</p><h1 className="mt-1 text-3xl font-extrabold tracking-tight text-slate-950">История продаж</h1><p className="mt-2 text-sm text-slate-500">Найдите чек и откройте его состав, способ оплаты и расчёт.</p></div>
      <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-card"><p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Чеков найдено</p><p className="mt-1 text-xl font-extrabold text-slate-900">{loading ? '…' : pagination.total}</p></div>
    </header>

    <form onSubmit={applyFilters} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-card sm:p-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <label className="text-sm font-semibold text-slate-600">С даты<input type="date" value={filters.date_from} onChange={event => setFilters(value => ({ ...value, date_from: event.target.value }))} className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 font-normal text-slate-800 outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-50"/></label>
        <label className="text-sm font-semibold text-slate-600">По дату<input type="date" value={filters.date_to} onChange={event => setFilters(value => ({ ...value, date_to: event.target.value }))} className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 font-normal text-slate-800 outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-50"/></label>
        <label className="text-sm font-semibold text-slate-600">Номер чека<input inputMode="numeric" value={filters.search} onChange={event => setFilters(value => ({ ...value, search: event.target.value.replace(/\D/g, '') }))} placeholder="Например, 104" className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 font-normal text-slate-800 outline-none placeholder:text-slate-400 focus:border-blue-400 focus:ring-4 focus:ring-blue-50"/></label>
        {user.role === 'admin' && <label className="text-sm font-semibold text-slate-600">ID кассира<input type="number" min="1" value={filters.cashier_id} onChange={event => setFilters(value => ({ ...value, cashier_id: event.target.value }))} placeholder="Все кассиры" className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 font-normal text-slate-800 outline-none placeholder:text-slate-400 focus:border-blue-400 focus:ring-4 focus:ring-blue-50"/></label>}
        <div className="flex items-end gap-2"><button type="submit" className="flex-1 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-blue-700">Применить</button><button type="button" onClick={resetFilters} className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-50">Сбросить</button></div>
      </div>
      {Boolean(filters.date_from) !== Boolean(filters.date_to) && <p className="mt-3 text-sm text-amber-700">Чтобы отфильтровать период, заполните обе даты.</p>}
    </form>

    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4"><div><h2 className="font-bold text-slate-900">Завершённые чеки</h2><p className="mt-0.5 text-sm text-slate-500">Нажмите «Подробнее», чтобы посмотреть позиции</p></div><span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">{firstRow}–{lastRow} из {pagination.total}</span></div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-5 py-3 font-bold">Дата</th><th className="px-5 py-3 font-bold">Чек</th><th className="px-5 py-3 font-bold">Кассир</th><th className="px-5 py-3 font-bold">Оплата</th><th className="px-5 py-3 text-right font-bold">Сумма</th><th className="px-5 py-3 text-right font-bold">Действие</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {loading && <tr><td colSpan="6" className="px-5 py-12 text-center text-slate-500"><span className="inline-flex items-center gap-2"><span className="h-4 w-4 animate-spin rounded-full border-2 border-blue-200 border-t-blue-600"/>Загружаем чеки…</span></td></tr>}
            {!loading && result.sales.map(sale => <tr key={sale.id} className="transition hover:bg-slate-50/80"><td className="whitespace-nowrap px-5 py-4 text-slate-600">{formatDate(sale.created_at)}</td><td className="px-5 py-4 font-bold text-slate-900">№{sale.receipt_number || sale.id}</td><td className="px-5 py-4 text-slate-700">{sale.cashier_name || '—'}</td><td className="px-5 py-4"><span className={`rounded-full px-2.5 py-1 text-xs font-bold ${paymentStyle(sale.payment_type)}`}>{paymentLabels[sale.payment_type] || sale.payment_type}</span></td><td className="px-5 py-4 text-right font-extrabold text-slate-900">{formatMoney(sale.total_amount)}</td><td className="px-5 py-4 text-right"><button type="button" disabled={detailLoadingId === sale.id} onClick={() => openSale(sale.id)} className="rounded-lg border border-blue-100 px-3 py-2 text-xs font-bold text-blue-700 transition hover:border-blue-200 hover:bg-blue-50 disabled:opacity-50">{detailLoadingId === sale.id ? 'Загрузка…' : 'Подробнее'}</button></td></tr>)}
            {!loading && result.sales.length === 0 && <tr><td colSpan="6" className="px-5 py-14 text-center"><div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-xl">⌕</div><p className="mt-3 font-semibold text-slate-700">Чеки не найдены</p><p className="mt-1 text-sm text-slate-500">Измените фильтры или проверьте выбранный период.</p></td></tr>}
          </tbody>
        </table>
      </div>
      <footer className="flex items-center justify-between border-t border-slate-100 px-5 py-4"><p className="text-sm text-slate-500">Страница {pagination.page || 1} из {Math.max(1, pagination.pages || 0)}</p><div className="flex gap-2"><button type="button" disabled={page <= 1 || loading} onClick={() => setPage(value => value - 1)} className="rounded-xl border border-slate-200 px-3.5 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40">Назад</button><button type="button" disabled={page >= (pagination.pages || 0) || loading} onClick={() => setPage(value => value + 1)} className="rounded-xl border border-slate-200 px-3.5 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40">Далее</button></div></footer>
    </section>
    {selectedSale && <ReceiptDetails sale={selectedSale} onClose={() => setSelectedSale(null)}/>}
  </div>;
}
