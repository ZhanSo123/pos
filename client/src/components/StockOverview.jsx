import { useCallback, useEffect, useState } from 'react';
import api, { getErrorMessage } from '../api';

export default function StockOverview({ notify }) {
  const [products, setProducts] = useState([]);
  const [search, setSearch] = useState('');
  const [stockFilter, setStockFilter] = useState('all');
  const [loading, setLoading] = useState(true);

  const loadProducts = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (search.trim()) params.search = search.trim();
      if (stockFilter === 'available') params.in_stock = 'true';
      if (stockFilter === 'empty') params.in_stock = 'false';
      const { data } = await api.get('/products', { params });
      setProducts(data.products || []);
    } catch (error) { notify(getErrorMessage(error, 'Не удалось загрузить остатки.'), 'error'); }
    finally { setLoading(false); }
  }, [notify, search, stockFilter]);

  useEffect(() => {
    const timer = window.setTimeout(loadProducts, 250);
    return () => window.clearTimeout(timer);
  }, [loadProducts]);

  return <div className="space-y-6">
    <header><p className="text-sm font-semibold text-blue-600">Склад</p><h1 className="mt-1 text-3xl font-bold tracking-tight">Остатки товаров</h1><p className="mt-2 text-sm text-slate-500">Просмотр текущего наличия на складе.</p></header>
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 p-5"><div><h2 className="font-bold">Товарные остатки</h2><p className="mt-1 text-sm text-slate-500">{products.length} позиций</p></div><div className="grid w-full gap-2 sm:w-auto sm:grid-cols-[minmax(220px,1fr)_180px]"><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Поиск по названию или SKU" className="rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm outline-none focus:border-blue-400 focus:bg-white"/><select value={stockFilter} onChange={event => setStockFilter(event.target.value)} className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-blue-400"><option value="all">Любой остаток</option><option value="available">В наличии</option><option value="empty">Нет в наличии</option></select></div></div>
      <div className="overflow-x-auto"><table className="w-full min-w-[620px] text-left text-sm"><thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-5 py-3.5 font-semibold">Название</th><th className="px-5 py-3.5 font-semibold">SKU</th><th className="px-5 py-3.5 font-semibold">Размер</th><th className="px-5 py-3.5 font-semibold">Текущий остаток</th></tr></thead><tbody className="divide-y divide-slate-100">{!loading && products.map(product => { const isLow = Number(product.stock_quantity) <= Number(product.low_stock_threshold ?? 5); return <tr key={product.id} className="hover:bg-slate-50/70"><td className="px-5 py-4 font-semibold">{product.name}</td><td className="px-5 py-4 text-slate-500">{product.sku || '—'}</td><td className="px-5 py-4 text-slate-500">{product.size || '—'}</td><td className="px-5 py-4"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${product.stock_quantity < 1 ? 'bg-rose-50 text-rose-600' : isLow ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'}`}>{product.stock_quantity} {product.unit === 'm' ? 'м' : 'шт.'}{isLow && product.stock_quantity > 0 ? ' · мало' : ''}</span></td></tr>; })}</tbody></table></div>
      {loading ? <div className="px-5 py-14 text-center text-sm text-slate-400">Загружаем остатки…</div> : products.length === 0 ? <div className="px-5 py-14 text-center text-sm text-slate-400">По заданным условиям товары не найдены.</div> : null}
    </section>
  </div>;
}
