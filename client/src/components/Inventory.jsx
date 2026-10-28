import { useCallback, useEffect, useMemo, useState } from 'react';
import api, { getErrorMessage } from '../api';

export default function Inventory({ notify }) {
  const [products, setProducts] = useState([]);
  const [actual, setActual] = useState({});
  const [comment, setComment] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const loadProducts = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/products');
      const list = data.products || [];
      setProducts(list);
      setActual(Object.fromEntries(list.map(product => [product.id, String(product.stock_quantity)])));
    } catch (error) { notify(getErrorMessage(error, 'Не удалось загрузить товары.'), 'error'); }
    finally { setLoading(false); }
  }, [notify]);
  useEffect(() => { loadProducts(); }, [loadProducts]);

  const visibleProducts = useMemo(() => {
    const query = search.trim().toLowerCase();
    return query ? products.filter(product => `${product.name} ${product.sku || ''}`.toLowerCase().includes(query)) : products;
  }, [products, search]);
  const changedCount = products.filter(product => Number(actual[product.id]) !== product.stock_quantity).length;

  async function submitInventory(event) {
    event.preventDefault();
    const items = products.map(product => ({ product_id: product.id, actual_quantity: Number(actual[product.id]) }));
    if (items.some(item => String(actual[item.product_id] ?? '').trim() === '' || !Number.isFinite(item.actual_quantity) || item.actual_quantity < 0 || (products.find(product => product.id === item.product_id)?.unit === 'pcs' && !Number.isInteger(item.actual_quantity)))) { notify('Заполните фактическое наличие: для штук укажите целое число, для метров допустима дробь.', 'error'); return; }
    if (!items.length) { notify('Нет товаров для инвентаризации.', 'error'); return; }
    if (!window.confirm(`Провести инвентаризацию по ${items.length} товарам? Будут сохранены текущие значения и применены все расхождения.`)) return;
    setSaving(true);
    try {
      const { data } = await api.post('/warehouse/inventory', { comment: comment.trim() || null, items });
      const changes = data.document.items.filter(item => item.expected_quantity !== item.actual_quantity).length;
      notify(`Инвентаризация №${data.document.id} проведена. Скорректировано товаров: ${changes}.`);
      setComment(''); await loadProducts();
    } catch (error) { notify(getErrorMessage(error, 'Не удалось провести инвентаризацию.'), 'error'); }
    finally { setSaving(false); }
  }

  return <div className="space-y-6"><header><p className="text-sm font-semibold text-blue-600">Складской учёт</p><h1 className="mt-1 text-3xl font-bold tracking-tight">Инвентаризация</h1><p className="mt-2 text-sm text-slate-500">Введите фактическое наличие. Сервис зафиксирует расхождения и обновит склад.</p></header>
    <form onSubmit={submitInventory} className="space-y-5"><section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-card"><div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 p-5"><div><h2 className="font-bold">Сверка остатков</h2><p className="mt-1 text-sm text-slate-500">Изменено строк: {changedCount} из {products.length}</p></div><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Найти товар или SKU" className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm outline-none focus:border-blue-400 focus:bg-white sm:w-64"/></div>
      <div className="overflow-x-auto"><table className="w-full min-w-[720px] text-left text-sm"><thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-5 py-3.5 font-semibold">Товар</th><th className="px-5 py-3.5 font-semibold">SKU</th><th className="px-5 py-3.5 font-semibold">Размер</th><th className="px-5 py-3.5 font-semibold">Система</th><th className="px-5 py-3.5 font-semibold">Фактически</th><th className="px-5 py-3.5 font-semibold">Разница</th></tr></thead><tbody className="divide-y divide-slate-100">{!loading && visibleProducts.map(product => { const delta = Number(actual[product.id]) - product.stock_quantity; const unitLabel = product.unit === 'm' ? 'м' : 'шт.'; return <tr key={product.id} className={delta !== 0 ? 'bg-amber-50/40' : ''}><td className="px-5 py-3.5 font-semibold">{product.name}</td><td className="px-5 py-3.5 text-slate-500">{product.sku || '—'}</td><td className="px-5 py-3.5 text-slate-500">{product.size || '—'}</td><td className="px-5 py-3.5">{product.stock_quantity} {unitLabel}</td><td className="px-5 py-2.5"><div className="flex items-center gap-2"><input required aria-label={`Фактический остаток: ${product.name}`} type="number" min="0" step={product.unit === 'm' ? '0.01' : '1'} value={actual[product.id] ?? ''} onChange={event => setActual(current => ({ ...current, [product.id]: event.target.value }))} className="w-32 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-50"/><span className="text-xs text-slate-400">{unitLabel}</span></div></td><td className="px-5 py-3.5"><span className={`font-semibold ${delta > 0 ? 'text-emerald-700' : delta < 0 ? 'text-rose-700' : 'text-slate-400'}`}>{delta > 0 ? `+${delta}` : delta} {unitLabel}</span></td></tr>; })}</tbody></table></div>
      {loading ? <div className="px-5 py-14 text-center text-sm text-slate-400">Загружаем каталог…</div> : products.length === 0 ? <div className="px-5 py-14 text-center text-sm text-slate-400">Нет товаров для сверки.</div> : visibleProducts.length === 0 ? <div className="px-5 py-10 text-center text-sm text-slate-400">Нет товаров по этому запросу.</div> : null}
    </section>
    <section className="flex flex-wrap items-end justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-card"><div className="min-w-[min(100%,420px)] flex-1"><label htmlFor="inventory-comment" className="mb-2 block text-sm font-semibold">Комментарий к акту</label><input id="inventory-comment" maxLength="2000" value={comment} onChange={event => setComment(event.target.value)} placeholder="Причина или примечание" className="w-full rounded-xl border border-slate-200 px-3.5 py-3 text-sm outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-50"/></div><button disabled={loading || saving || products.length === 0} className="rounded-xl bg-blue-600 px-5 py-3 text-sm font-bold text-white shadow-lg shadow-blue-600/15 hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50">{saving ? 'Проводим…' : 'Провести инвентаризацию'}</button></section></form>
  </div>;
}
