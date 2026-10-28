import { useEffect } from 'react';

export default function Toast({ toast, onDismiss }) {
  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(onDismiss, 3600);
    return () => window.clearTimeout(timer);
  }, [toast, onDismiss]);
  if (!toast) return null;
  const styles = toast.type === 'error' ? 'border-rose-200 bg-rose-50 text-rose-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800';
  return <div role="status" className={`fixed bottom-5 right-5 z-[60] flex max-w-sm items-start gap-3 rounded-xl border px-4 py-3 text-sm font-semibold shadow-xl ${styles}`}><span className="mt-0.5">{toast.type === 'error' ? '!' : '✓'}</span><p className="flex-1">{toast.message}</p><button onClick={onDismiss} aria-label="Закрыть уведомление" className="opacity-60 hover:opacity-100">×</button></div>;
}
