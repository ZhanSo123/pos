export const APP_TIME_ZONE = import.meta.env.VITE_APP_TIME_ZONE || 'Asia/Aqtau';

export const formatMoney = value => `${new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(Number(value) || 0)} ₸`;
export const localDate = date => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(date).filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
};
export const today = () => localDate(new Date());
export const thisMonth = () => today().slice(0, 7);
export const formatDateTime = value => {
  if (!value) return '—';
  return new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'medium', timeStyle: 'short', timeZone: APP_TIME_ZONE
  }).format(new Date(value));
};
export const pluralize = (value, one, few, many) => {
  const n = Math.abs(value) % 100;
  if (n >= 11 && n <= 19) return many;
  const digit = n % 10;
  return digit === 1 ? one : digit >= 2 && digit <= 4 ? few : many;
};
