import { useState } from 'react';
import api, { getErrorMessage } from '../api';

export default function Login({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault(); setError(''); setBusy(true);
    try {
      const { data } = await api.post('/auth/login', { username: username.trim(), password });
      localStorage.setItem('pos_token', data.token);
      localStorage.setItem('pos_user', JSON.stringify(data.user));
      onLogin(data.user);
    } catch (requestError) { setError(getErrorMessage(requestError, 'Не удалось войти. Проверьте имя пользователя и пароль.')); }
    finally { setBusy(false); }
  }

  return <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10"><div className="grid w-full max-w-5xl overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-card md:grid-cols-[1fr_1fr]">
    <section className="relative hidden overflow-hidden bg-slate-950 p-10 text-white md:flex md:flex-col md:justify-between"><div className="absolute -right-20 -top-20 h-72 w-72 rounded-full bg-blue-500/30 blur-3xl"/><div className="relative"><div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-500 text-xl font-black">К</div><p className="mt-10 text-sm font-semibold uppercase tracking-[.2em] text-blue-300">POS система</p><h1 className="mt-3 max-w-sm text-4xl font-extrabold leading-tight">Быстрая и удобная касса</h1><p className="mt-4 max-w-sm leading-7 text-slate-400">Продажи, склад и отчёты в одном рабочем месте.</p></div><p className="relative text-xs text-slate-500">Безопасный вход для кассиров и администраторов</p></section>
    <section className="p-6 sm:p-10 lg:p-12"><div className="mb-8 md:hidden"><div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-blue-600 font-black text-white">К</div></div><p className="text-sm font-semibold text-blue-600">Добро пожаловать</p><h2 className="mt-2 text-3xl font-extrabold tracking-tight">Вход в систему</h2><p className="mt-2 text-sm text-slate-500">Введите свои данные для продолжения.</p>
      <form onSubmit={handleSubmit} className="mt-8 space-y-5"><div><label htmlFor="username" className="mb-2 block text-sm font-semibold">Имя пользователя</label><input id="username" autoComplete="username" autoFocus required value={username} onChange={event => setUsername(event.target.value)} placeholder="Например, cashier1" className="w-full rounded-xl border border-slate-200 px-4 py-3 outline-none transition placeholder:text-slate-400 focus:border-blue-400 focus:ring-4 focus:ring-blue-50"/></div><div><label htmlFor="password" className="mb-2 block text-sm font-semibold">Пароль</label><input id="password" type="password" autoComplete="current-password" required value={password} onChange={event => setPassword(event.target.value)} placeholder="Введите пароль" className="w-full rounded-xl border border-slate-200 px-4 py-3 outline-none transition placeholder:text-slate-400 focus:border-blue-400 focus:ring-4 focus:ring-blue-50"/></div>
        {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">{error}</p>}
        <button disabled={busy} className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-3.5 font-bold text-white shadow-lg shadow-blue-600/20 transition hover:bg-blue-700 disabled:cursor-wait disabled:opacity-60">{busy ? 'Выполняется вход…' : 'Войти'}{!busy && <span>→</span>}</button>
      </form><p className="mt-8 text-center text-xs leading-5 text-slate-400">Учетные записи создаются администратором сервера.</p>
    </section>
  </div></main>;
}
