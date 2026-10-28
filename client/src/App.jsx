import { useCallback, useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import Navbar from './components/Navbar';
import Login from './components/Login';
import POSCheckout, { getInitialShiftState } from './components/POSCheckout';
import Warehouse from './components/Warehouse';
import StockOverview from './components/StockOverview';
import WarehouseDocuments from './components/WarehouseDocuments';
import Inventory from './components/Inventory';
import Reports from './components/Reports';
import SalesHistory from './components/SalesHistory';
import DebtManagement from './components/DebtManagement';
import Toast from './components/Toast';
import api, { getErrorMessage } from './api';

function loadSavedUser() {
  try {
    const user = JSON.parse(localStorage.getItem('pos_user'));
    if (localStorage.getItem('pos_token') && user && [ 'admin', 'cashier' ].includes(user.role)) return user;
  } catch { /* повредённые данные сессии очищаются при следующем выходе */ }
  return null;
}

function AppContent() {
  const [user, setUser] = useState(loadSavedUser);
  const [shiftOpen, setShiftOpen] = useState(() => user ? getInitialShiftState(user.id) : false);
  const [toast, setToast] = useState(null);
  const notify = useCallback((message, type = 'success') => setToast({ message, type, id: Date.now() }), []);
  const dismissToast = useCallback(() => setToast(null), []);

  const logout = useCallback(() => {
    localStorage.removeItem('pos_token'); localStorage.removeItem('pos_user');
    setUser(null); setShiftOpen(false);
  }, []);

  useEffect(() => {
    const handleUnauthorized = () => { logout(); setToast({ message: 'Сессия завершилась. Войдите снова.', type: 'error', id: Date.now() }); };
    window.addEventListener('pos:unauthorized', handleUnauthorized);
    return () => window.removeEventListener('pos:unauthorized', handleUnauthorized);
  }, [logout]);

  useEffect(() => {
    if (!user) return undefined;
    let active = true;
    api.get('/auth/me').then(({ data }) => {
      if (!active) return;
      setUser(data.user);
      localStorage.setItem('pos_user', JSON.stringify(data.user));
    }).catch(error => {
      if (active && error.response?.status !== 401) notify(getErrorMessage(error, 'Не удалось обновить профиль пользователя.'), 'error');
    });
    return () => { active = false; };
  }, [user?.id, notify]);

  function onLogin(nextUser) { setUser(nextUser); setShiftOpen(getInitialShiftState(nextUser.id)); }
  if (!user) return <><Routes><Route path="/login" element={<Login onLogin={onLogin}/>}/><Route path="*" element={<Navigate to="/login" replace/>}/></Routes><Toast toast={toast} onDismiss={dismissToast}/></>;

  return <div className="min-h-screen lg:flex"><Navbar user={user} onLogout={logout}/><main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-10 lg:py-9"><Routes><Route path="/login" element={<Navigate to="/" replace/>}/><Route path="/" element={<POSCheckout user={user} notify={notify} shiftOpen={shiftOpen} setShiftOpen={setShiftOpen}/>}/><Route path="/sales" element={<SalesHistory user={user} notify={notify}/>}/><Route path="/debts" element={<DebtManagement notify={notify}/>}/>{user.role === 'admin' ? <><Route path="/warehouse" element={<Warehouse notify={notify}/>}/><Route path="/warehouse/documents" element={<WarehouseDocuments notify={notify}/>}/><Route path="/warehouse/inventory" element={<Inventory notify={notify}/>}/><Route path="/reports" element={<Reports notify={notify}/>}/></> : <Route path="/stock" element={<StockOverview notify={notify}/>}/>}<Route path="*" element={<Navigate to="/" replace/>}/></Routes><footer className="mt-8 text-center text-xs text-slate-400">POS • данные и операции обрабатываются сервером</footer></main><Toast toast={toast} onDismiss={dismissToast}/></div>;
}

export default function App() { return <BrowserRouter><AppContent/></BrowserRouter>; }
