// 讀取老師在後台（Google 試算表）設定的顯示控制。
// 回傳格式：{ units: { "l1-voc": { visible, disabled: ["mastery"], questionCount } } }
// disabled 可放的值：basic / advanced / mastery（單字片語）、reading（課文理解）
//
// Apps Script 回應要 1～3 秒：有上次存下的設定就先用它畫畫面，同時在背景抓最新的，
// 有變動時發出 config-updated 事件讓網站重畫（老師改的設定，學生重新整理或稍等一下就看到）。
import { SCRIPT_URL } from './config.js';
import { store } from './storage.js';

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

// iOS Safari 切回分頁、從背景回來時不會重新載入頁面：回到前景時再檢查一次設定（最多 5 秒一次）
let lastCheck = Date.now();
export function watchConfig(current) {
  let cur = current;
  window.addEventListener('config-updated', (e) => { cur = e.detail; });
  const check = () => {
    if (!SCRIPT_URL || document.visibilityState !== 'visible' || Date.now() - lastCheck < 5000) return;
    lastCheck = Date.now();
    fetchRemote().then((c) => {
      writeCache(c);
      if (!sameConfig(c, cur)) window.dispatchEvent(new CustomEvent('config-updated', { detail: c }));
    }).catch(() => { /* 離線：下次再試 */ });
  };
  // 即時同步：Firestore 一有新設定就推過來（網頁在背景載入 Firebase，不影響首頁速度）
  const live = () => import('./firebase.js').then((fb) => fb.watchPublicConfig((c) => {
    if (!c || !c.units) return;
    const next = { ...c, source: 'firestore' };
    writeCache(next);
    if (!sameConfig(next, cur)) window.dispatchEvent(new CustomEvent('config-updated', { detail: next }));
  })).catch(() => { /* 沒有即時同步也能用：回到前景時仍會檢查 */ });
  if (SCRIPT_URL) (window.requestIdleCallback || ((f) => setTimeout(f, 1500)))(live);
  document.addEventListener('visibilitychange', check);
  window.addEventListener('pageshow', (e) => { if (e.persisted) check(); });
  window.addEventListener('focus', check);
  // 保險：手機螢幕暗掉、切 App 或網路不穩時，即時連線會暫停而漏接更新；
  // 網頁在前景時每 30 秒再主動檢查一次（讀 Firestore 一份很小的文件），最慢 30 秒內一定會更新
  setInterval(check, 30000);
}

const unitCfg = (c, id) => (c && c.units && c.units[id]) || {};

export const unitVisible = (c, id) => unitCfg(c, id).visible !== false;

// 開放時段（老師後台設定，台灣時間）：before＝還沒開放、open＝開放中、after＝已截止
const twTime = (s) => (s ? Date.parse(`${s}:00+08:00`) : NaN);
export function unitWindow(c, id, now = Date.now()) {
  const u = unitCfg(c, id);
  const open = twTime(u.openAt);
  let close = twTime(u.closeAt);
  // 老師有開放補作給這位學生：截止時間延到補作時間
  const s = store.student();
  const ext = s && c && c.ext && c.ext[id] ? twTime(c.ext[id][`${s.cls}-${s.seat}`]) : NaN;
  const extended = !Number.isNaN(ext) && !(ext <= close);
  if (extended) close = ext;
  const state = open > now ? 'before' : close <= now ? 'after' : 'open';
  return { state, extended, openAt: Number.isNaN(open) ? null : open, closeAt: Number.isNaN(close) ? null : close };
}
export function fmtWhen(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export const modeOn = (c, id, mode) => !(unitCfg(c, id).disabled || []).includes(mode);

export function questionCount(c, id) {
  const n = Number(unitCfg(c, id).questionCount);
  return n > 0 ? Math.min(n, 100) : DEFAULT_COUNT;
}
