import { useCallback, useEffect, useState } from 'react';
import api, { getErrorMessage } from '../api';
import { formatMoney, thisMonth, today } from '../utils';
import Analytics from './Analytics';

const tabs = [
  { id: 'analytics', label: 'Аналитика и Oracle' },
  { id: 'daily', label: 'Дневной отчёт' },
  { id: 'monthly', label: 'Месячный отчёт' },
  { id: 'top', label: 'Топ товаров' }
];
const unitLabel = unit => unit === 'm' ? 'м' : unit === 'pcs' ? 'шт.' : '—';
const quantityFormat = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 3 });

function Metric({ label, value, accent = false, hint }) {
  return <article className={`rounded-2xl border p-5 shadow-card ${accent ? 'border-transparent bg-gradient-to-br from-blue-600 to-indigo-700 text-white' : 'border-slate-200 bg-white'}`}>
    <p className={`text-sm font-medium ${accent ? 'text-blue-100' : 'text-slate-500'}`}>{label}</p>
    <p className="mt-3 text-3xl font-extrabold tracking-tight">{formatMoney(value)}</p>
    <p className={`mt-2 text-xs ${accent ? 'text-blue-100' : 'text-slate-400'}`}>{hint}</p>
  </article>;
}

function SummaryReport({ report, tab }) {
  const rows = [
    ['Наличные получено', report.revenue_cash, 'bg-blue-500'],
    ['Картой получено', report.revenue_card, 'bg-indigo-500'],
    ['Продано в долг', report.revenue_debt || 0, 'bg-violet-500']
  ];
  return <>
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
      <Metric accent label="Продажи" value={report.total_revenue} hint={report.period?.date || report.period?.month}/>
      <Metric label="Наличные получено" value={report.revenue_cash} hint="Включая погашение долгов"/>
      <Metric label="Картой получено" value={report.revenue_card} hint="Включая погашение долгов"/>
      <Metric label="Продано в долг" value={report.revenue_debt || 0} hint="Сумма чеков с отсрочкой"/>
      <Metric label="Валовая прибыль" value={report.net_profit} hint="После скидок и себестоимости"/>
    </div>
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h2 className="font-bold">Сводка {tab === 'daily' ? 'за день' : 'за месяц'}</h2><p className="mt-1 text-sm text-slate-500">Поступления, продажи с отсрочкой и прибыль</p></div>
        <span className="rounded-full bg-slate-100 px-3 py-1.5 text-sm font-semibold text-slate-600">{report.sales_count} {report.sales_count === 1 ? 'продажа' : 'продаж'}</span>
      </div>
      <div className="mt-5 space-y-4">{rows.map(([label, value, color]) => {
        const percent = report.total_revenue > 0 ? Math.min(100, (value / report.total_revenue) * 100) : 0;
        return <div key={label}><div className="mb-2 flex justify-between text-sm"><span className="font-medium text-slate-600">{label}</span><span className="font-semibold">{formatMoney(value)}</span></div><div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full ${color}`} style={{ width: `${percent}%` }}/></div></div>;
      })}</div>
    </section>
  </>;
}

export default function Reports({ notify }) {
  const [tab, setTab] = useState('analytics');
  const [date, setDate] = useState(today());
  const [month, setMonth] = useState(thisMonth());
  const [daily, setDaily] = useState(null);
  const [monthly, setMonthly] = useState(null);
  const [loading, setLoading] = useState(false);
  const [topProducts, setTopProducts] = useState([]);
  const [topLoading, setTopLoading] = useState(false);
  const [period, setPeriod] = useState('month');
  const [dateFrom, setDateFrom] = useState(today());
  const [dateTo, setDateTo] = useState(today());
  const [sort, setSort] = useState('revenue');
  const [limit, setLimit] = useState('10');

  const loadDaily = useCallback(async () => {
    setLoading(true);
    try { const { data } = await api.get('/reports/daily', { params: { date } }); setDaily(data); }
    catch (error) { setDaily(null); notify(getErrorMessage(error, 'Не удалось загрузить дневной отчёт.'), 'error'); }
    finally { setLoading(false); }
  }, [date, notify]);
  const loadMonthly = useCallback(async () => {
    setLoading(true);
    try { const { data } = await api.get('/reports/monthly', { params: { month } }); setMonthly(data); }
    catch (error) { setMonthly(null); notify(getErrorMessage(error, 'Не удалось загрузить месячный отчёт.'), 'error'); }
    finally { setLoading(false); }
  }, [month, notify]);
  const loadTopProducts = useCallback(async () => {
    if (period === 'range' && (!dateFrom || !dateTo)) return;
    setTopLoading(true);
    try {
      const params = { sort, limit: Number(limit) || 10 };
      if (period === 'range') { params.date_from = dateFrom; params.date_to = dateTo; }
      else params.period = period;
      const { data } = await api.get('/reports/top-products', { params });
      setTopProducts(data.products || []);
    } catch (error) { setTopProducts([]); notify(getErrorMessage(error, 'Не удалось загрузить топ товаров.'), 'error'); }
    finally { setTopLoading(false); }
  }, [dateFrom, dateTo, limit, notify, period, sort]);

  useEffect(() => { if (tab === 'daily') loadDaily(); else if (tab === 'monthly') loadMonthly(); else if (tab === 'top') loadTopProducts(); }, [tab, loadDaily, loadMonthly, loadTopProducts]);
  const report = tab === 'daily' ? daily : monthly;
  const sortLabel = sort === 'revenue' ? 'выручке' : sort === 'profit' ? 'прибыли' : 'количеству';

  return <div className="space-y-6">
    <div><p className="text-sm font-semibold text-blue-600">Продажи и показатели</p><h1 className="mt-1 text-3xl font-bold tracking-tight">Отчёты</h1><p className="mt-2 text-sm text-slate-500">Выручка, способы оплаты, прибыль и товары-лидеры.</p></div>

    <section className="rounded-2xl border border-slate-200 bg-white p-2 shadow-card"><div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">{tabs.map(item => <button key={item.id} onClick={() => setTab(item.id)} className={`rounded-xl px-4 py-3 text-sm font-bold ${tab === item.id ? 'bg-blue-600 text-white' : 'text-slate-500 hover:bg-slate-50'}`}>{item.label}</button>)}</div></section>

    {tab === 'analytics' ? <Analytics notify={notify}/> : tab !== 'top' ? <>
      <section className="flex flex-wrap items-end justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-card">
        <div><label htmlFor={tab === 'daily' ? 'report-date' : 'report-month'} className="mb-2 block text-sm font-semibold">{tab === 'daily' ? 'Дата отчёта' : 'Месяц отчёта'}</label><input id={tab === 'daily' ? 'report-date' : 'report-month'} type={tab === 'daily' ? 'date' : 'month'} value={tab === 'daily' ? date : month} onChange={event => tab === 'daily' ? setDate(event.target.value) : setMonth(event.target.value)} className="rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-50"/></div>
        <button onClick={tab === 'daily' ? loadDaily : loadMonthly} disabled={loading} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-bold hover:bg-slate-50 disabled:opacity-50">{loading ? 'Обновляем…' : 'Обновить отчёт'}</button>
      </section>
      {loading && !report ? <div className="rounded-2xl border border-slate-200 bg-white py-16 text-center text-sm text-slate-400">Загружаем отчёт…</div> : !report ? <div className="rounded-2xl border border-slate-200 bg-white py-16 text-center text-sm text-slate-500">Нет данных для отображения.</div> : <SummaryReport report={report} tab={tab}/>}
    </> : <>
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-card">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div><label htmlFor="top-period" className="mb-2 block text-sm font-semibold">Период продаж</label><select id="top-period" value={period} onChange={event => setPeriod(event.target.value)} className="w-48 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm outline-none focus:border-blue-400"><option value="day">Сегодня</option><option value="month">Этот месяц</option><option value="all">За всё время</option><option value="range">Диапазон дат</option></select></div>
          {period === 'range' && <><div><label htmlFor="top-date-from" className="mb-2 block text-sm font-semibold">С даты</label><input id="top-date-from" type="date" value={dateFrom} onChange={event => setDateFrom(event.target.value)} className="rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm outline-none focus:border-blue-400"/></div><div><label htmlFor="top-date-to" className="mb-2 block text-sm font-semibold">По дату</label><input id="top-date-to" type="date" min={dateFrom} value={dateTo} onChange={event => setDateTo(event.target.value)} className="rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm outline-none focus:border-blue-400"/></div></>}
          <div><label htmlFor="top-sort" className="mb-2 block text-sm font-semibold">Сортировать по</label><select id="top-sort" value={sort} onChange={event => setSort(event.target.value)} className="w-48 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm outline-none focus:border-blue-400"><option value="revenue">Выручке</option><option value="profit">Прибыли</option><option value="quantity">Количеству</option></select></div>
          <div><label htmlFor="top-limit" className="mb-2 block text-sm font-semibold">Показать товаров</label><select id="top-limit" value={limit} onChange={event => setLimit(event.target.value)} className="w-32 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm outline-none focus:border-blue-400"><option value="5">Топ 5</option><option value="10">Топ 10</option><option value="20">Топ 20</option><option value="50">Топ 50</option></select></div>
        </div>
      </section>
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-5"><div><h2 className="font-bold">Самые продаваемые и прибыльные товары</h2><p className="mt-1 text-sm text-slate-500">Сортировка по {sortLabel}; прибыль учитывает скидки по чекам.</p></div><button onClick={loadTopProducts} disabled={topLoading} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-bold hover:bg-slate-50 disabled:opacity-50">{topLoading ? 'Обновляем…' : 'Обновить'}</button></div>
        {topLoading && topProducts.length === 0 ? <div className="py-16 text-center text-sm text-slate-400">Считаем продажи по товарам…</div> : topProducts.length === 0 ? <div className="py-16 text-center text-sm text-slate-500">За выбранный период продаж нет.</div> : <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-5 py-3.5 font-semibold">№</th><th className="px-5 py-3.5 font-semibold">Товар</th><th className="px-5 py-3.5 font-semibold">Категория</th><th className="px-5 py-3.5 text-right font-semibold">Продано</th><th className="px-5 py-3.5 text-right font-semibold">Выручка</th><th className="px-5 py-3.5 text-right font-semibold">Прибыль</th></tr></thead><tbody className="divide-y divide-slate-100">{topProducts.map((product, index) => <tr key={`${product.product_id ?? product.name}-${index}`} className="hover:bg-slate-50/70"><td className="px-5 py-4"><span className={`flex h-8 w-8 items-center justify-center rounded-lg text-xs font-extrabold ${index === 0 ? 'bg-amber-100 text-amber-800' : index < 3 ? 'bg-blue-50 text-blue-700' : 'bg-slate-100 text-slate-500'}`}>{index + 1}</span></td><td className="px-5 py-4 font-semibold">{product.name}</td><td className="px-5 py-4 text-slate-500">{product.category}</td><td className="px-5 py-4 text-right font-semibold">{quantityFormat.format(Number(product.sold_quantity))} {unitLabel(product.unit)}</td><td className="px-5 py-4 text-right font-semibold">{formatMoney(product.revenue)}</td><td className="px-5 py-4 text-right font-bold text-emerald-700">{formatMoney(product.gross_profit)}</td></tr>)}</tbody></table></div>}
      </section>
    </>}
  </div>;
}
