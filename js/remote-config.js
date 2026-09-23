// 讀取老師在後台（Google 試算表）設定的顯示控制。
// 回傳格式：{ units: { "l1-voc": { visible, disabled: ["mastery"], questionCount } } }
// disabled 可放的值：basic / advanced / mastery（單字片語）、reading（課文理解）
import { SCRIPT_URL } from './config.js';

const DEFAULT_COUNT = 10;

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

export function questionCount(c, id) {
  const n = Number(unitCfg(c, id).questionCount);
  return n > 0 ? Math.min(n, 100) : DEFAULT_COUNT;
}
