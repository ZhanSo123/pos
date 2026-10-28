import { useCallback, useEffect, useMemo, useState } from 'react';
import api, { getErrorMessage } from '../api';
import { formatMoney, today } from '../utils';
import AnalyticsChat from './AnalyticsChat';

const qtyFormat = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });
const percentFormat = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });
const shiftDate = (value, days) => { const date = new Date(`${value}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10); };
const unitLabel = unit => unit === 'm' ? 'м' : 'шт.';
const deltaLabel = value => value === null || value === undefined ? 'Нет базы для сравнения' : `${Number(value) >= 0 ? '↑' : '↓'} ${percentFormat.format(Math.abs(Number(value)))}% к предыдущему периоду`;

function MetricCard({ title, value, note, tone = 'blue' }) {
  const styles = { blue: 'bg-blue-600 text-white', green: 'bg-emerald-600 text-white', violet: 'bg-violet-600 text-white', white: 'border border-slate-200 bg-white text-slate-900' };
  const sub = tone === 'white' ? 'text-slate-500' : 'text-white/75';
  return <article className={`rounded-2xl p-5 shadow-card ${styles[tone]}`}><p className={`text-sm font-semibold ${sub}`}>{title}</p><p className="mt-3 text-2xl font-extrabold tracking-tight">{value}</p><p className={`mt-2 text-xs ${sub}`}>{note}</p></article>;
}

function TrendChart({ points }) {
  const width = 800; const height = 250; const pad = { left: 12, right: 12, top: 16, bottom: 36 };
  const values = points.flatMap(point => [Number(point.revenue || 0), Number(point.gross_profit || 0)]);
  const max = Math.max(1, ...values);
  const min = Math.min(0, ...values);
  const step = points.length > 1 ? (width - pad.left - pad.right) / points.length : width - pad.left - pad.right;
  const barWidth = Math.max(1, Math.min(10, step * 0.28));
  const plotHeight = height - pad.top - pad.bottom;
  const span = Math.max(1, max - min);
  const scaleY = value => pad.top + ((max - Number(value || 0)) / span) * plotHeight;
  const baseline = scaleY(0);
  const labels = points.length ? [...new Set([0, Math.floor((points.length - 1) / 2), points.length - 1])] : [];
  return <div className="overflow-x-auto"><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="График дневной выручки и валовой прибыли" className="h-64 min-w-[560px] w-full">
    {[0, 0.5, 1].map(ratio => { const value = max - span * ratio; const y = scaleY(value); return <line key={ratio} x1={pad.left} x2={width - pad.right} y1={y} y2={y} stroke={Math.abs(value) < 0.0001 ? '#94a3b8' : '#e2e8f0'} strokeDasharray={Math.abs(value) < 0.0001 ? undefined : '4 5'}/>; })}
    {points.map((point, index) => { const center = pad.left + step * index + step / 2; const revenueY = scaleY(point.revenue); const profitY = scaleY(point.gross_profit); return <g key={point.day}>
      <rect x={center - barWidth - 1} y={Math.min(revenueY, baseline)} width={barWidth} height={Math.max(1, Math.abs(baseline - revenueY))} rx="2" fill="#3b82f6"><title>{point.day}: выручка {formatMoney(point.revenue)}</title></rect>
      <rect x={center + 1} y={Math.min(profitY, baseline)} width={barWidth} height={Math.max(1, Math.abs(baseline - profitY))} rx="2" fill={Number(point.gross_profit) < 0 ? '#f43f5e' : '#10b981'}><title>{point.day}: валовая прибыль {formatMoney(point.gross_profit)}</title></rect>
    </g>; })}
    {labels.map(index => <text key={index} x={pad.left + step * index + step / 2} y={height - 10} textAnchor="middle" fill="#64748b" fontSize="11">{points[index]?.day?.slice(5)}</text>)}
  </svg><div className="mt-1 flex gap-5 text-xs font-medium text-slate-500"><span className="flex items-center gap-2"><i className="h-2.5 w-2.5 rounded-sm bg-blue-500"/>Выручка</span><span className="flex items-center gap-2"><i className="h-2.5 w-2.5 rounded-sm bg-emerald-500"/>Валовая прибыль</span></div></div>;
}

function Recommendation({ item }) {
  const tint = item.severity === 'high' ? 'border-rose-200 bg-rose-50' : item.severity === 'medium' ? 'border-amber-200 bg-amber-50' : 'border-slate-200 bg-slate-50';
  return <article className={`rounded-xl border p-4 ${tint}`}><div className="flex flex-wrap items-start justify-between gap-2"><div><p className="text-sm font-bold text-slate-900">{item.title}</p><p className="mt-1 text-xs font-semibold text-slate-600">{item.product_name}</p></div><span className="rounded-full bg-white/80 px-2.5 py-1 text-[11px] font-bold uppercase text-slate-500">{item.kind === 'price' ? 'Цена' : item.kind === 'restock' ? 'Запас' : 'Спрос'}</span></div><p className="mt-2 text-sm leading-5 text-slate-600">{item.message}</p>{item.suggested_price !== undefined && <p className="mt-3 rounded-lg bg-white/70 px-3 py-2 text-sm"><span className="text-slate-500">Цена для проверки:</span> <strong>{formatMoney(item.current_price)}</strong> <span className="px-1 text-slate-400">→</span> <strong className="text-violet-700">{formatMoney(item.suggested_price)}</strong></p>}{item.suggested_quantity > 0 && <p className="mt-3 rounded-lg bg-white/70 px-3 py-2 text-sm"><span className="text-slate-500">Ориентир пополнения:</span> <strong>{qtyFormat.format(item.suggested_quantity)} {unitLabel(item.unit)}</strong></p>}</article>;
}

export default function Analytics({ notify }) {
  const currentDay = today();
  const [filters, setFilters] = useState({ date_from: shiftDate(currentDay, -29), date_to: currentDay, category: '', unit: '', cashier_id: '', payment_type: '', stock_status: 'all' });
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [ranking, setRanking] = useState('best');
  const [rankingMetric, setRankingMetric] = useState('gross_profit');

  const load = useCallback(async () => {
    if (!filters.date_from || !filters.date_to) return;
    if (filters.date_from > filters.date_to) { notify('Дата начала не может быть позже даты окончания.', 'error'); return; }
    const span = Math.round((new Date(`${filters.date_to}T12:00:00Z`) - new Date(`${filters.date_from}T12:00:00Z`)) / 86400000) + 1;
    if (span > 366) { notify('Для первой версии выберите период не более одного года.', 'error'); return; }
    setLoading(true);
    try {
      const params = Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== ''));
      const { data } = await api.get('/reports/analytics', { params });
      setReport(data);
      setLoadError('');
    } catch (error) {
      setReport(null);
      if (error.response?.status === 404) {
        setLoadError('На localhost:3000 запущена старая версия API: в ней нет маршрута аналитики. Перезапустите сервер из этого проекта. Новому серверу также нужны запущенная Oracle Database и переменные ORACLE_USER, ORACLE_PASSWORD и ORACLE_CONNECT_STRING в .env.');
      } else {
        const message = getErrorMessage(error, 'Не удалось загрузить аналитику.');
        setLoadError(message);
        notify(message, 'error');
      }
    }
    finally { setLoading(false); }
  }, [filters, notify]);

  useEffect(() => { load(); }, [load]);

  const filteredProducts = report?.products || [];
  const maxCategoryRevenue = Math.max(1, ...(report?.category_summary || []).map(item => Number(item.revenue || 0)));
  const rankedProducts = useMemo(() => {
    const products = [...filteredProducts];
    const direction = ranking === 'best' ? -1 : 1;
    products.sort((a, b) => direction * (Number(a[rankingMetric] || 0) - Number(b[rankingMetric] || 0)) || Number(b.revenue || 0) - Number(a.revenue || 0));
    return products.slice(0, 8);
  }, [filteredProducts, ranking, rankingMetric]);
  const chatFilters = useMemo(() => Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== '')), [filters]);

  function setFilter(field, value) { setFilters(current => ({ ...current, [field]: value })); }

  function exportProducts() {
    const escape = value => {
      const text = String(value ?? '');
      const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
      return `"${safe.replaceAll('"', '""')}"`;
    };
    const exportList = [...filteredProducts].sort((a, b) => (ranking === 'best' ? -1 : 1) * (Number(a[rankingMetric] || 0) - Number(b[rankingMetric] || 0)) || Number(b.revenue || 0) - Number(a.revenue || 0));
    const rows = [
      ['Товар', 'Категория', 'Единица', 'Продано', 'Остаток', 'Дней запаса (оценка)', 'Выручка, ₸', 'Валовая прибыль, ₸', 'Маржа, %'],
      ...exportList.map(product => [product.name, product.category, unitLabel(product.unit), product.sold_quantity, product.stock_quantity, product.stock_cover_days ?? '', product.revenue, product.gross_profit, Number(product.gross_margin || 0) * 100])
    ];
    const csv = `\uFEFF${rows.map(row => row.map(escape).join(';')).join('\r\n')}`;
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `pos-analytics-${filters.date_from}-${filters.date_to}.csv`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return <div className="space-y-5">
    <div><p className="text-sm font-semibold text-violet-700">Продажи, спрос и цены</p><h2 className="mt-1 text-2xl font-extrabold tracking-tight text-slate-900">Аналитика магазина</h2><p className="mt-2 max-w-3xl text-sm text-slate-500">Сводка по товарам, трендам и запасам. Рекомендации по цене — ориентир для проверки администратором, не автоматическое изменение.</p></div>

    <section className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-card sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-7">
      <label className="text-xs font-bold text-slate-500">С даты<input type="date" value={filters.date_from} max={filters.date_to} onChange={event => setFilter('date_from', event.target.value)} className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-medium text-slate-800 outline-none focus:border-blue-400"/></label>
      <label className="text-xs font-bold text-slate-500">По дату<input type="date" value={filters.date_to} min={filters.date_from} onChange={event => setFilter('date_to', event.target.value)} className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-medium text-slate-800 outline-none focus:border-blue-400"/></label>
      <label className="text-xs font-bold text-slate-500">Категория<select value={filters.category} onChange={event => setFilter('category', event.target.value)} className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-medium text-slate-800"><option value="">Все категории</option>{(report?.categories || []).map(category => <option key={category} value={category}>{category}</option>)}</select></label>
      <label className="text-xs font-bold text-slate-500">Кассир<select value={filters.cashier_id} onChange={event => setFilter('cashier_id', event.target.value)} className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-medium text-slate-800"><option value="">Все кассиры</option>{(report?.cashiers || []).map(cashier => <option key={cashier.id} value={cashier.id}>{cashier.username}</option>)}</select></label>
      <label className="text-xs font-bold text-slate-500">Оплата<select value={filters.payment_type} onChange={event => setFilter('payment_type', event.target.value)} className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-medium text-slate-800"><option value="">Все способы</option><option value="cash">Наличные</option><option value="card">Карта</option><option value="debt">В долг</option></select></label>
      <label className="text-xs font-bold text-slate-500">Единица<select value={filters.unit} onChange={event => setFilter('unit', event.target.value)} className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-medium text-slate-800"><option value="">Все единицы</option><option value="pcs">Штуки</option><option value="m">Метры</option></select></label>
      <label className="text-xs font-bold text-slate-500">Остаток<select value={filters.stock_status} onChange={event => setFilter('stock_status', event.target.value)} className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-medium text-slate-800"><option value="all">Любой</option><option value="in_stock">Есть на складе</option><option value="low_stock">Ниже порога</option><option value="out_of_stock">Нет в наличии</option></select></label>
    </section>

    {loading && !report ? <div className="rounded-2xl border border-slate-200 bg-white py-16 text-center text-sm text-slate-500">Собираем сводку из Oracle Database…</div> : report && <>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <MetricCard title="Выручка товаров" value={formatMoney(report.summary.revenue)} note={`${deltaLabel(report.summary.comparison?.revenue_change_percent)} · Актау`} tone="blue"/>
        <MetricCard title="Валовая прибыль" value={formatMoney(report.summary.gross_profit)} note={`${deltaLabel(report.summary.comparison?.gross_profit_change_percent)} · после скидок`} tone="green"/>
        <MetricCard title="Проданное количество" value={qtyFormat.format(report.summary.sold_quantity)} note="С учётом дробных метров" tone="violet"/>
        <MetricCard title="Чеков в выборке" value={qtyFormat.format(report.summary.sales_count)} note={`Средний чек ${formatMoney(report.summary.average_check)}`} tone="white"/>
        <MetricCard title="Товаров в фильтре" value={qtyFormat.format(report.summary.products_count)} note={`Валовая маржа ${percentFormat.format(report.summary.revenue ? report.summary.gross_profit / report.summary.revenue * 100 : 0)}%`} tone="white"/>
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-card">
        <div className="mb-4"><h3 className="font-bold text-slate-900">Оплата по выбранным товарам</h3><p className="mt-1 text-xs text-slate-500">Распределение суммы чеков; долги показаны по дате продажи</p></div>
        <div className="grid gap-4 sm:grid-cols-3">{[
          { key: 'cash', label: 'Наличные', color: 'bg-emerald-500' },
          { key: 'card', label: 'Карта', color: 'bg-blue-500' },
          { key: 'debt', label: 'В долг', color: 'bg-amber-500' }
        ].map(method => {
          const amount = Number(report.summary.payment_mix?.[method.key] || 0);
          const share = report.summary.revenue ? amount / report.summary.revenue * 100 : 0;
          return <div key={method.key} className="rounded-xl bg-slate-50 p-4"><div className="flex items-center justify-between gap-3"><span className="text-sm font-semibold text-slate-700">{method.label}</span><strong className="text-sm text-slate-900">{formatMoney(amount)}</strong></div><div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-200"><div className={`h-full rounded-full ${method.color}`} style={{ width: `${Math.min(100, Math.max(0, share))}%` }}/></div><p className="mt-2 text-xs text-slate-500">{percentFormat.format(share)}% суммы выборки</p></div>;
        })}</div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-card"><div className="mb-3"><h3 className="font-bold text-slate-900">Динамика за период</h3><p className="mt-1 text-xs text-slate-500">Выручка и валовая прибыль, по времени Актау. Изменение сравнивается с предыдущими {report.period.days} днями ({report.summary.comparison?.date_from} — {report.summary.comparison?.date_to}).</p></div><TrendChart points={report.series}/></section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-card">
        <div className="mb-4"><h3 className="font-bold text-slate-900">Эффективность категорий</h3><p className="mt-1 text-xs text-slate-500">Нажмите категорию, чтобы применить фильтр. Остатки оценены по текущей себестоимости.</p></div>
        {!report.category_summary?.length ? <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">Нет категорий для выбранных фильтров.</p> : <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{report.category_summary.slice(0, 6).map(category => {
          const width = Math.max(0, Number(category.revenue || 0) / maxCategoryRevenue * 100);
          return <button key={category.category} type="button" onClick={() => setFilter('category', category.category)} className={`rounded-xl border p-4 text-left transition hover:border-blue-300 hover:bg-blue-50/40 ${filters.category === category.category ? 'border-blue-400 bg-blue-50/60' : 'border-slate-200 bg-slate-50/70'}`}>
            <div className="flex items-start justify-between gap-3"><div><p className="font-bold text-slate-900">{category.category}</p><p className="mt-1 text-xs text-slate-500">{category.products_count} товаров · продано {qtyFormat.format(category.sold_quantity)}</p></div><span className="rounded-full bg-white px-2 py-1 text-xs font-bold text-slate-600">Маржа {percentFormat.format(category.gross_margin * 100)}%</span></div>
            <div className="mt-3 flex items-center justify-between gap-2 text-xs"><span className="text-slate-500">Выручка {formatMoney(category.revenue)}</span><strong className={category.gross_profit < 0 ? 'text-rose-700' : 'text-emerald-700'}>{formatMoney(category.gross_profit)}</strong></div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-200"><div className="h-full rounded-full bg-blue-500" style={{ width: `${width}%` }}/></div>
            <p className="mt-2 text-[11px] text-slate-400">В закупочной стоимости остатков: {formatMoney(category.inventory_cost_value)}</p>
          </button>;
        })}</div>}
      </section>

      <div className="grid gap-5 xl:grid-cols-[1.2fr_0.8fr]">
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-card">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-5"><div><h3 className="font-bold">Рейтинг товаров</h3><p className="mt-1 text-xs text-slate-500">ABC-класс показывает долю товара в выручке периода</p></div><div className="flex flex-wrap items-center gap-2"><select aria-label="Метрика сортировки товаров" value={rankingMetric} onChange={event => setRankingMetric(event.target.value)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold"><option value="gross_profit">Валовая прибыль</option><option value="revenue">Выручка</option><option value="sold_quantity">Проданное количество</option><option value="gross_margin">Маржа</option></select><div className="flex rounded-xl bg-slate-100 p-1"><button onClick={() => setRanking('best')} className={`rounded-lg px-3 py-2 text-xs font-bold ${ranking === 'best' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500'}`}>Лучшие</button><button onClick={() => setRanking('worst')} className={`rounded-lg px-3 py-2 text-xs font-bold ${ranking === 'worst' ? 'bg-white text-rose-700 shadow-sm' : 'text-slate-500'}`}>Слабые</button></div></div></div>
          {rankedProducts.length === 0 ? <div className="p-10 text-center text-sm text-slate-500">Нет товаров, подходящих под фильтры.</div> : <div className="overflow-x-auto"><table className="w-full min-w-[820px] text-left text-sm"><thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="px-4 py-3">Товар</th><th className="px-4 py-3 text-center">ABC</th><th className="px-4 py-3 text-right">Продано</th><th className="px-4 py-3 text-right">Дней запаса*</th><th className="px-4 py-3 text-right">Выручка</th><th className="px-4 py-3 text-right">Валовая прибыль</th><th className="px-4 py-3 text-right">Маржа периода</th></tr></thead><tbody className="divide-y divide-slate-100">{rankedProducts.map(product => <tr key={product.product_id} className="hover:bg-slate-50"><td className="px-4 py-3.5"><p className="font-semibold text-slate-800">{product.name}</p><p className="mt-0.5 text-xs text-slate-400">{product.category} · остаток {qtyFormat.format(product.stock_quantity)} {unitLabel(product.unit)}</p></td><td className="px-4 py-3.5 text-center"><span title="ABC-класс рассчитан по накопленной доле выручки" className={`inline-flex h-7 w-7 items-center justify-center rounded-lg text-xs font-extrabold ${product.abc_class === 'A' ? 'bg-emerald-100 text-emerald-800' : product.abc_class === 'B' ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-600'}`}>{product.abc_class}</span></td><td className="px-4 py-3.5 text-right">{qtyFormat.format(product.sold_quantity)} {unitLabel(product.unit)}</td><td className="px-4 py-3.5 text-right">{product.stock_cover_days === null ? '—' : `${qtyFormat.format(product.stock_cover_days)} дн.`}</td><td className="px-4 py-3.5 text-right font-semibold">{formatMoney(product.revenue)}</td><td className={`px-4 py-3.5 text-right font-bold ${product.gross_profit < 0 ? 'text-rose-700' : 'text-emerald-700'}`}>{formatMoney(product.gross_profit)}</td><td className="px-4 py-3.5 text-right">{percentFormat.format(product.gross_margin * 100)}%</td></tr>)}</tbody></table><p className="px-4 py-3 text-xs text-slate-400">A — первые товары, формирующие около 80% выручки; B — следующие 15%; C — оставшиеся. Дни запаса рассчитаны по среднему темпу продаж периода и не учитывают периоды отсутствия товара.</p></div>}
        </section>
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-card"><div className="mb-4"><h3 className="font-bold text-slate-900">Подсказки по ассортименту</h3><p className="mt-1 text-xs text-slate-500">Правила на основе текущих остатков и продаж</p></div>{report.recommendations.length ? <div className="max-h-[540px] space-y-3 overflow-y-auto pr-1">{report.recommendations.map((item, index) => <Recommendation key={`${item.kind}-${item.product_id}-${index}`} item={item}/>)}</div> : <div className="rounded-xl bg-emerald-50 p-4 text-sm text-emerald-800">Срочных подсказок не найдено. Продолжайте следить за спросом и остатками.</div>}</section>
      </div>
      <AnalyticsChat filters={chatFilters} notify={notify}/>
      <p className="text-xs leading-5 text-slate-400">Маржа для товаров с продажами рассчитывается по фактическим ценам и себестоимости на момент продажи, с распределением скидки чека. Для товаров без продаж используется текущая цена и себестоимость. Валовая прибыль не вычитает аренду, зарплаты и прочие расходы. Ценовые подсказки требуют проверки администратором.</p>
    </>}
    {!loading && !report && <div role="alert" className={`rounded-2xl border px-6 py-10 text-center text-sm leading-6 ${loadError.includes('старая версия API') ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-slate-200 bg-white text-slate-500'}`}>{loadError || 'Не удалось загрузить отчёт. Проверьте подключение к Oracle Database и повторите запрос.'}</div>}
    <div className="flex justify-end gap-2"><button onClick={exportProducts} disabled={!report || !filteredProducts.length} className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50">Скачать CSV</button><button onClick={load} disabled={loading} className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50">{loading ? 'Обновляем…' : 'Обновить аналитику'}</button></div>
  </div>;
}
