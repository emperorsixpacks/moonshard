import { apiFetch } from './api.js';

let view = 'ranked';
export const getBoardView = () => view;
export const setBoardView = (v) => { view = v === 'open' ? 'open' : 'ranked'; };

export function todaySeedString() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

export const fetchDailyBoard = () => apiFetch(`/leaderboard/daily?view=${view}`);
export const fetchAllTimeBoard = () => apiFetch(`/leaderboard/alltime?view=${view}`);
export const fetchConfig = () => apiFetch('/config');
