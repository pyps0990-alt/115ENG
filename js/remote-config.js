// 讀取老師在後台（Google 試算表）設定的顯示控制。
// 回傳格式：{ units: { "l1-voc": { visible, disabled: ["match"], examOpen, examCount, examFrom, examTo } } }
import { SCRIPT_URL } from './config.js';

async function fetchTimeout(url, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { signal: ctrl.signal, cache: 'no-store' });
  } finally {
    clearTimeout(t);
  }
}

export async function getConfig() {
  if (SCRIPT_URL) {
    try {
      const r = await fetchTimeout(`${SCRIPT_URL}${SCRIPT_URL.includes('?') ? '&' : '?'}action=config`, 7000);
      if (r.ok) {
        const j = await r.json();
        if (j && j.units) return { ...j, source: 'remote' };
      }
    } catch { /* fall back */ }
  }
  try {
    const r = await fetch('data/config.default.json', { cache: 'no-cache' });
    return { ...(await r.json()), source: 'default' };
  } catch {
    return { units: {}, source: 'none' };
  }
}

const unitCfg = (c, id) => (c && c.units && c.units[id]) || {};

export const unitVisible = (c, id) => unitCfg(c, id).visible !== false;

export const modeOn = (c, id, mode) => !(unitCfg(c, id).disabled || []).includes(mode);

function parseDay(s, end) {
  const m = String(s || '').match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (!m) return null;
  return end ? new Date(+m[1], m[2] - 1, +m[3], 23, 59, 59, 999) : new Date(+m[1], m[2] - 1, +m[3]);
}

export function examState(c, id) {
  const u = unitCfg(c, id);
  const count = Number(u.examCount) > 0 ? Number(u.examCount) : 20;
  if (u.examOpen === false) return { open: false, reason: '老師目前尚未開放這個單元的正式測驗。', count };
  const now = new Date();
  const from = parseDay(u.examFrom, false);
  const to = parseDay(u.examTo, true);
  if (from && now < from) return { open: false, reason: `正式測驗將於 ${u.examFrom} 開放。`, count };
  if (to && now > to) return { open: false, reason: `正式測驗已於 ${u.examTo} 截止。`, count };
  return { open: true, count, until: u.examTo || '' };
}
