import axios from 'axios';

const api = axios.create({ baseURL: import.meta.env.VITE_API_URL || 'http://localhost:3000/api', timeout: 15000, headers: { 'Content-Type': 'application/json' } });

api.interceptors.request.use(config => {
  const token = localStorage.getItem('pos_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(response => response, error => {
  if (error.response?.status === 401 && localStorage.getItem('pos_token')) {
    window.dispatchEvent(new CustomEvent('pos:unauthorized'));
  }
  return Promise.reject(error);
});

export function getErrorMessage(error, fallback = 'Не удалось выполнить запрос.') {
  return error?.response?.data?.error || error?.response?.data?.message || (error?.code === 'ECONNABORTED' ? 'Сервер не ответил вовремя.' : error?.message === 'Network Error' ? 'Не удалось подключиться к API. Проверьте сервер и настройки CORS.' : fallback);
}

export default api;
