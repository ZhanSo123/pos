import { useCallback, useEffect, useState } from 'react';
import api, { getErrorMessage } from '../api';
import { formatDateTime, formatMoney } from '../utils';

const makeLine = () => ({ product_id: '', quantity: '1', purchase_price: '', retail_price: '' });

export default function WarehouseDocuments({ notify }) {
  const [documents, setDocuments] = useState([]);
  const [products, setProducts] = useState([]);
  const [statusFilter, setStatusFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [supplierName, setSupplierName] = useState('');
  const [comment, setComment] = useState('');
  const [items, setItems] = useState([makeLine()]);
  const [formError, setFormError] = useState('');

  const loadDocuments = useCallback(async () => {
    setLoading(true);
    try {
      const params = { limit: 100, type: 'purchase' };
      if (statusFilter !== 'all') params.status = statusFilter;
      const { data } = await api.get('/warehouse/documents', { params });
      setDocuments(data.documents || []);
    } catch (error) { notify(getErrorMessage(error, 'Не удалось загрузить документы.'), 'error'); }
    finally { setLoading(false); }
  }, [notify, statusFilter]);

  useEffect(() => { loadDocuments(); }, [loadDocuments]);
  useEffect(() => {
    let active = true;
    api.get('/products').then(({ data }) => { if (active) setProducts(data.products || []); })
      .catch(error => { if (active) notify(getErrorMessage(error, 'Не удалось загрузить каталог товаров.'), 'error'); });
    return () => { active = false; };
  }, [notify]);

  function changeItem(index, key, value) {
    setItems(current => current.map((item, itemIndex) => {
      if (index !== itemIndex) return item;
      if (key === 'product_id') {
        const product = products.find(entry => String(entry.id) === value);
        return { ...item, product_id: value, purchase_price: product ? String(product.purchase_price) : '', retail_price: product ? String(product.retail_price) : '' };
      }
      return { ...item, [key]: value };
    }));
  }

  async function createDocument(event) {
    event.preventDefault(); setFormError('');
    const payloadItems = items.map(item => ({ product_id: Number(item.product_id), quantity: Number(item.quantity), purchase_price: Number(item.purchase_price), retail_price: Number(item.retail_price) }));
    if (payloadItems.some(item => {
      const product = products.find(entry => entry.id === item.product_id);
      return !Number.isInteger(item.product_id) || item.product_id < 1 || !Number.isFinite(item.quantity) || item.quantity <= 0 || (product?.unit === 'pcs' && !Number.isInteger(item.quantity)) || !Number.isFinite(item.purchase_price) || item.purchase_price < 0 || !Number.isFinite(item.retail_price) || item.retail_price < 0;
    })) {
      setFormError('Выберите товар, введите корректное количество (для штук целое) и цены для каждой строки.'); return;
    }
    if (new Set(payloadItems.map(item => item.product_id)).size !== payloadItems.length) { setFormError('Один и тот же товар нельзя добавлять в накладную несколькими строками.'); return; }
    setSaving(true);
    try {
      await api.post('/warehouse/documents', { supplier_name: supplierName.trim() || null, comment: comment.trim() || null, items: payloadItems });
      setSupplierName(''); setComment(''); setItems([makeLine()]); notify('Черновик приходной накладной создан. Проведите его после проверки.'); await loadDocuments();
    } catch (error) { setFormError(getErrorMessage(error, 'Не удалось создать накладную.')); }
    finally { setSaving(false); }
  }

  async function completeDocument(document) {
    if (!window.confirm(`Провести приходную накладную №${document.id}? Остатки и цены товаров будут обновлены.`)) return;
    setSaving(true);
    try { await api.post(`/warehouse/documents/${document.id}/complete`); notify(`Накладная №${document.id} проведена.`); await loadDocuments(); }
    catch (error) { notify(getErrorMessage(error, 'Не удалось провести накладную.'), 'error'); }
    finally { setSaving(false); }
  }

  return <div className="space-y-6">
    <header><p className="text-sm font-semibold text-blue-600">Складской учёт</p><h1 className="mt-1 text-3xl font-bold tracking-tight">Приходные накладные</h1><p className="mt-2 text-sm text-slate-500">Создавайте черновики поставок, затем проводите их для обновления остатков и цен.</p></header>
    <div className="grid items-start gap-6 xl:grid-cols-[minmax(360px,.8fr)_minmax(0,1.2fr)]">
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-card sm:p-6"><div className="mb-5"><h2 className="text-lg font-bold">Новая накладная</h2><p className="mt-1 text-sm text-slate-500">Приход будет создан в статусе «Черновик».</p></div>
        <form onSubmit={createDocument} className="space-y-4"><div><label htmlFor="supplier-name" className="mb-1.5 block text-sm font-semibold">Поставщик</label><input id="supplier-name" maxLength="200" value={supplierName} onChange={event => setSupplierName(event.target.value)} placeholder="Название поставщика" className="w-full rounded-xl border border-slate-200 px-3.5 py-3 text-sm outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-50"/></div><div><label htmlFor="purchase-comment" className="mb-1.5 block text-sm font-semibold">Комментарий</label><textarea id="purchase-comment" rows="2" maxLength="2000" value={comment} onChange={event => setComment(event.target.value)} placeholder="Номер накладной или примечание" className="w-full resize-y rounded-xl border border-slate-200 px-3.5 py-3 text-sm outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-50"/></div>
          <div className="flex items-center justify-between"><h3 className="text-sm font-bold">Строки поставки</h3><button type="button" onClick={() => setItems(current => [...current, makeLine()])} className="rounded-lg bg-blue-50 px-3 py-2 text-xs font-bold text-blue-700 hover:bg-blue-100">＋ Добавить строку</button></div>
          <div className="space-y-3">{items.map((item, index) => { const selectedProduct = products.find(product => String(product.id) === String(item.product_id)); return <div key={index} className="rounded-xl border border-slate-200 bg-slate-50/60 p-3"><div className="mb-3 flex items-center justify-between"><span className="text-xs font-bold uppercase tracking-wide text-slate-400">Товар {index + 1}</span>{items.length > 1 && <button type="button" onClick={() => setItems(current => current.filter((_, itemIndex) => itemIndex !== index))} className="text-xs font-semibold text-rose-600 hover:text-rose-700">Удалить</button>}</div><select value={item.product_id} onChange={event => changeItem(index, 'product_id', event.target.value)} required className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-blue-400"><option value="">Выберите товар</option>{products.filter(product => !items.some((other, otherIndex) => otherIndex !== index && String(other.product_id) === String(product.id))).map(product => <option key={product.id} value={product.id}>{product.name} · остаток {product.stock_quantity} {product.unit === 'm' ? 'м' : 'шт.'}</option>)}</select><div className="mt-3 grid grid-cols-3 gap-2"><label className="text-xs font-medium text-slate-500">Количество, {selectedProduct?.unit === 'm' ? 'м' : 'шт.'}<input type="number" min="0.01" step={selectedProduct?.unit === 'm' ? '0.01' : '1'} value={item.quantity} onChange={event => changeItem(index, 'quantity', event.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm text-slate-800 outline-none focus:border-blue-400"/></label><label className="text-xs font-medium text-slate-500">Закупка, ₸<input type="number" min="0" step="0.01" value={item.purchase_price} onChange={event => changeItem(index, 'purchase_price', event.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm text-slate-800 outline-none focus:border-blue-400"/></label><label className="text-xs font-medium text-slate-500">Розница, ₸<input type="number" min="0" step="0.01" value={item.retail_price} onChange={event => changeItem(index, 'retail_price', event.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm text-slate-800 outline-none focus:border-blue-400"/></label></div></div>; })}</div>
          {formError && <p role="alert" className="rounded-xl bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">{formError}</p>}<button disabled={saving || !products.length} className="w-full rounded-xl bg-blue-600 px-4 py-3 text-sm font-bold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50">{saving ? 'Сохраняем…' : 'Создать черновик'}</button>
        </form>
      </section>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-card"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-5"><div><h2 className="font-bold">Документы</h2><p className="mt-1 text-sm text-slate-500">{documents.length} накладных</p></div><select aria-label="Фильтр статуса" value={statusFilter} onChange={event => setStatusFilter(event.target.value)} className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-blue-400"><option value="all">Все статусы</option><option value="draft">Черновики</option><option value="completed">Проведённые</option></select></div>
        {loading ? <div className="px-5 py-14 text-center text-sm text-slate-400">Загружаем документы…</div> : documents.length === 0 ? <div className="px-5 py-14 text-center text-sm text-slate-400">Накладных с таким статусом пока нет.</div> : <div className="divide-y divide-slate-100">{documents.map(document => <article key={document.id} className="p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex flex-wrap items-center gap-2"><h3 className="font-bold">Приход №{document.id}</h3><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${document.status === 'completed' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>{document.status === 'completed' ? 'Проведён' : 'Черновик'}</span></div><p className="mt-1 text-sm text-slate-500">{document.supplier_name || 'Поставщик не указан'} · {formatDateTime(document.created_at)}</p></div>{document.status === 'draft' && <button disabled={saving} onClick={() => completeDocument(document)} className="rounded-xl bg-emerald-600 px-3.5 py-2.5 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50">Провести накладную</button>}</div>{document.comment && <p className="mt-3 text-sm text-slate-500">{document.comment}</p>}<div className="mt-4 space-y-2 rounded-xl bg-slate-50 p-3">{document.items.map(item => <div key={item.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-sm"><span className="font-medium text-slate-700">{item.product_name} <span className="text-slate-400">× {item.actual_quantity}</span></span><span className="text-xs text-slate-500">Закупка {formatMoney(item.purchase_price)} · Розница {formatMoney(item.retail_price)}</span></div>)}</div><div className="mt-3 text-xs text-slate-400">Создал: {document.created_by_username || '—'}{document.completed_at ? ` · Проведён ${formatDateTime(document.completed_at)}` : ''}</div></article>)}</div>}
      </section>
    </div>
  </div>;
}
