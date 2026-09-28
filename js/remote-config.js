// 讀取老師在後台（Google 試算表）設定的顯示控制。
// 回傳格式：{ units: { "l1-voc": { visible, disabled: ["mastery"], questionCount } } }
// disabled 可放的值：basic / advanced / mastery（單字片語）、reading（課文理解）
//
// Apps Script 回應要 1～3 秒：有上次存下的設定就先用它畫畫面，同時在背景抓最新的，
// 有變動時發出 config-updated 事件讓網站重畫（老師改的設定，學生重新整理或稍等一下就看到）。
import { SCRIPT_URL } from './config.js';

const DEFAULT_COUNT = 10;
const CACHE_KEY = 'b5p:config';
const FIRESTORE = 'https://firestore.googleapis.com/v1/projects/eng-3385e/databases/(default)/documents/public/';

async function fetchTimeout(url, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { signal: ctrl.signal, cache: 'no-store' });
  } finally {
    clearTimeout(t);
  }
}

function readCache() {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY) || 'null'); } catch { return null; }
}
function writeCache(c) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(c)); } catch { /* ignore */ }
}

// 老師儲存時 Apps Script 會同步一份到 Firestore：直接讀它，約 0.2 秒（Apps Script 要 2～5 秒）
export async function firestoreDoc(id, ms = 4000) {
  const r = await fetchTimeout(`${FIRESTORE}${encodeURIComponent(id)}`, ms);
  if (!r.ok) throw new Error(String(r.status));
  const j = await r.json();
  return JSON.parse(j.fields.json.stringValue);
}

async function fetchRemote() {
  try {
    const c = await firestoreDoc('config');
    if (c && c.units) return { ...c, source: 'firestore' };
  } catch { /* 還沒同步過或讀取失敗：改問 Apps Script */ }
  return fetchGas();
}

async function fetchGas() {
  const r = await fetchTimeout(`${SCRIPT_URL}${SCRIPT_URL.includes('?') ? '&' : '?'}action=config`, 10000);
  if (!r.ok) throw new Error(String(r.status));
  const j = await r.json();
  if (!j || !j.units) throw new Error('bad config');
  return { ...j, source: 'remote' };
}

async function fetchDefault() {
  try {
    const r = await fetch('data/config.default.json', { cache: 'no-cache' });
    return { ...(await r.json()), source: 'default' };
  } catch {
    return { units: {}, source: 'none' };
  }
}

// 設定內容是否不同（忽略每次都會變的 updated 時間）
const sameConfig = (a, b) => JSON.stringify({ ...a, updated: 0, source: 0 }) === JSON.stringify({ ...b, updated: 0, source: 0 });

export async function getConfig() {
  if (!SCRIPT_URL) return fetchDefault();
  const cached = readCache();
  const fresh = fetchRemote().then((c) => { writeCache(c); return c; });
  if (cached) {
    fresh.then((c) => {
      if (!sameConfig(c, cached)) window.dispatchEvent(new CustomEvent('config-updated', { detail: c }));
    }).catch(() => { /* 離線：沿用上次的設定 */ });
    return { ...cached, source: 'cache' };
  }
  try { return await fresh; } catch { return fetchDefault(); }
}

const unitCfg = (c, id) => (c && c.units && c.units[id]) || {};

export const unitVisible = (c, id) => unitCfg(c, id).visible !== false;

export const modeOn = (c, id, mode) => !(unitCfg(c, id).disabled || []).includes(mode);

export function questionCount(c, id) {
  const n = Number(unitCfg(c, id).questionCount);
  return n > 0 ? Math.min(n, 100) : DEFAULT_COUNT;
}
