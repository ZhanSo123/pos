import { NavLink } from 'react-router-dom';

const cashierLinks = [{ to: '/', label: 'Касса', icon: '▣', end: true }, { to: '/stock', label: 'Остатки', icon: '▤' }, { to: '/sales', label: 'История чеков', icon: '▧' }, { to: '/debts', label: 'Долги клиентов', icon: '₸' }];
const adminLinks = [cashierLinks[0], { to: '/warehouse', label: 'Товары', icon: '▤' }, { to: '/warehouse/documents', label: 'Приходы', icon: '⇩' }, { to: '/warehouse/inventory', label: 'Инвентаризация', icon: '☷' }, { to: '/sales', label: 'История чеков', icon: '▧' }, { to: '/debts', label: 'Долги клиентов', icon: '₸' }, { to: '/reports', label: 'Отчёты', icon: '▥' }];

export default function Navbar({ user, onLogout }) {
  const links = user.role === 'admin' ? adminLinks : cashierLinks;
  return <aside className="bg-slate-950 text-white lg:sticky lg:top-0 lg:flex lg:h-screen lg:w-64 lg:flex-col">
    <div className="flex items-center justify-between gap-3 px-5 py-5 lg:justify-start lg:py-7"><div className="flex items-center gap-3"><div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-blue-500 text-xl font-black">К</div><div><p className="font-bold tracking-wide">Касса</p><p className="text-xs text-slate-400">POS • рабочее место</p></div></div><button onClick={onLogout} className="rounded-lg px-2 py-1 text-xs font-semibold text-slate-400 hover:bg-slate-900 hover:text-white lg:hidden">Выйти</button></div>
    <nav aria-label="Основная навигация" className="flex gap-2 overflow-x-auto px-3 pb-3 lg:flex-col lg:px-4">{links.map(link => <NavLink key={link.to} to={link.to} end={link.end} className={({ isActive }) => `flex shrink-0 items-center gap-3 rounded-xl px-4 py-3 text-sm font-semibold transition ${isActive ? 'bg-blue-600 text-white shadow-lg shadow-blue-950/20' : 'text-slate-400 hover:bg-slate-900 hover:text-white'}`}><span aria-hidden="true">{link.icon}</span>{link.label}</NavLink>)}</nav>
    <div className="mt-auto hidden p-4 lg:block"><div className="rounded-2xl border border-slate-800 bg-slate-900 p-4"><p className="text-xs font-medium uppercase tracking-wider text-slate-500">Пользователь</p><p className="mt-2 truncate text-sm font-semibold">{user.username}</p><p className="mt-1 text-xs text-slate-400">{user.role === 'admin' ? 'Администратор' : 'Кассир'}</p><button onClick={onLogout} className="mt-4 w-full rounded-lg border border-slate-700 px-3 py-2 text-sm font-semibold text-slate-300 hover:bg-slate-800">Выйти из аккаунта</button></div></div>
  </aside>;
}
