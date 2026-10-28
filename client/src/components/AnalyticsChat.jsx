import { useCallback, useEffect, useRef, useState } from 'react';
import api, { getErrorMessage } from '../api';

const suggestions = [
  'Какие товары сейчас требуют внимания?',
  'Предложи, на какие цены посмотреть в первую очередь.',
  'Объясни, почему у товаров низкая прибыль.'
];

export default function AnalyticsChat({ filters, notify }) {
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [configured, setConfigured] = useState(null);
  const [localMode, setLocalMode] = useState(false);
  const bottomRef = useRef(null);

  const loadStatus = useCallback(async () => {
    try {
      const { data } = await api.get('/analytics/chat/status');
      setConfigured(data.configured);
    } catch (error) {
      setConfigured(false);
      if (error.response?.status !== 404) notify(getErrorMessage(error, 'Не удалось проверить настройки Oracle-помощника.'), 'error');
    }
  }, [notify]);

  useEffect(() => { loadStatus(); }, [loadStatus]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [messages, busy]);

  async function sendMessage(value = draft) {
    const content = value.trim();
    if (!content || busy || !configured) return;
    const nextMessages = [...messages, { role: 'user', content }].slice(-10);
    setMessages(nextMessages);
    setDraft('');
    setBusy(true);
    try {
      const { data } = await api.post('/analytics/chat', { messages: nextMessages, filters });
      const usingLocalData = data.mode === 'local_fallback';
      setLocalMode(usingLocalData);
      setMessages(current => [...current, { role: 'assistant', content: data.answer, source: usingLocalData ? 'local' : 'ai' }].slice(-12));
    } catch (error) {
      notify(getErrorMessage(error, 'Oracle не смог ответить. Попробуйте ещё раз.'), 'error');
      setMessages(current => current.filter((message, index) => !(index === current.length - 1 && message.role === 'user' && message.content === content)));
      setDraft(content);
    } finally { setBusy(false); }
  }

  return <section className="overflow-hidden rounded-2xl border border-violet-200 bg-white shadow-card">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-violet-100 bg-gradient-to-r from-violet-50 to-blue-50 p-5">
      <div className="flex items-center gap-3"><div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-violet-600 text-sm font-black text-white shadow-lg shadow-violet-600/20">O</div><div><h2 className="font-bold text-slate-900">Oracle · аналитический помощник</h2><p className="mt-1 text-xs text-slate-500">Объясняет показатели и ценовые рекомендации по выбранному периоду</p></div></div>
      <span className={`rounded-full px-3 py-1.5 text-xs font-bold ${configured && !localMode ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>{configured === null ? 'Проверяем настройку…' : !configured ? 'Нужен API-ключ' : localMode ? 'Локальный режим · лимит AI' : 'API-ключ настроен'}</span>
    </div>
    <div className="max-h-[390px] min-h-40 space-y-3 overflow-y-auto p-4 sm:p-5" aria-live="polite">
      {messages.length === 0 && <div className="rounded-xl border border-dashed border-slate-200 p-4 text-sm text-slate-600"><p className="font-semibold text-slate-800">Спросите о продажах, запасах или ценах</p><p className="mt-1">Помощник получает сводные данные по текущим фильтрам. Персональные данные покупателей ему не передаются.</p><div className="mt-3 flex flex-wrap gap-2">{suggestions.map(question => <button key={question} type="button" disabled={!configured} onClick={() => sendMessage(question)} className="rounded-full border border-violet-200 bg-white px-3 py-2 text-left text-xs font-semibold text-violet-800 hover:bg-violet-50 disabled:cursor-not-allowed disabled:opacity-50">{question}</button>)}</div></div>}
      {messages.map((message, index) => <div key={`${message.role}-${index}`} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}><div className={`max-w-[90%] whitespace-pre-wrap rounded-2xl px-4 py-3 text-sm leading-6 ${message.role === 'user' ? 'rounded-br-md bg-blue-600 text-white' : 'rounded-bl-md bg-slate-100 text-slate-800'}`}>{message.source === 'local' && <span className="mb-2 block text-[11px] font-bold uppercase tracking-wide text-amber-700">Сводка по данным POS · AI API недоступен</span>}{message.content}</div></div>)}
      {busy && <div className="flex"><div className="rounded-2xl rounded-bl-md bg-slate-100 px-4 py-3 text-sm text-slate-500">Oracle анализирует сводку…</div></div>}
      <div ref={bottomRef}/>
    </div>
    {!configured && configured !== null && <p className="mx-4 mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 sm:mx-5">Добавьте <code className="font-bold">OPENAI_API_KEY</code> в серверный <code>.env</code> и перезапустите API, чтобы включить чат.</p>}
    <form onSubmit={event => { event.preventDefault(); sendMessage(); }} className="flex gap-2 border-t border-slate-100 p-4 sm:p-5">
      <label className="sr-only" htmlFor="oracle-question">Ваш вопрос аналитическому помощнику</label>
      <input id="oracle-question" value={draft} onChange={event => setDraft(event.target.value)} maxLength={1500} disabled={!configured || busy} placeholder={configured ? 'Например: почему упала прибыль?' : 'Сначала настройте AI-ключ на сервере'} className="min-w-0 flex-1 rounded-xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-violet-400 focus:ring-4 focus:ring-violet-50 disabled:bg-slate-50"/>
      <button type="submit" disabled={!configured || busy || !draft.trim()} className="rounded-xl bg-violet-600 px-4 py-3 text-sm font-bold text-white hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50">{busy ? '…' : 'Спросить'}</button>
    </form>
  </section>;
}
