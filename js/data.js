const cache = new Map();

async function getJSON(url) {
  if (cache.has(url)) return cache.get(url);
  const p = fetch(url, { cache: 'no-cache' }).then((r) => {
    if (!r.ok) throw new Error(`${url}: ${r.status}`);
    return r.json();
  });
  cache.set(url, p);
  p.catch(() => cache.delete(url));
  return p;
}

import { SCRIPT_URL } from './config.js';
import { firestoreDoc } from './remote-config.js';

// 單元清單幾乎不會變（單元都是老師在後台新增的）：index.html 已經先發出請求，這裡直接接手
export const loadIndex = () => {
  const early = window.__early && window.__early.index;
  if (early) {
    window.__early.index = null;
    const p = early.then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json(); });
    p.catch(() => {});
    cache.set('data/lessons/index.json', p);
    return p.catch(() => { cache.delete('data/lessons/index.json'); return getJSON('data/lessons/index.json'); });
  }
  return getJSON('data/lessons/index.json');
};

// 老師在後台匯入過的單元，改讀試算表裡的內容；讀不到時退回網站內建的 JSON。
// 匯入內容依「更新時間」存在裝置上：老師沒改過就不用再等 Apps Script，改過會自動抓新版。
export async function loadUnit(id, config) {
  const imported = config && config.content && config.content[id];
  if (imported && SCRIPT_URL) {
    const key = `b5p:content:${id}`;
    const version = String(imported.updated || '');
    try {
      const saved = JSON.parse(localStorage.getItem(key) || 'null');
      if (saved && saved.v === version && saved.data) return saved.data;
    } catch { /* ignore */ }
    try {
      const d = await firestoreDoc(`content_${id}`);
      if (d && String(d.v) === version && d.data) {
        try { localStorage.setItem(key, JSON.stringify({ v: version, data: d.data })); } catch { /* ignore */ }
        return d.data;
      }
    } catch { /* 改問 Apps Script */ }
    const url = `${SCRIPT_URL}${SCRIPT_URL.includes('?') ? '&' : '?'}action=content&unit=${encodeURIComponent(id)}&v=${encodeURIComponent(version)}`;
    try {
      const res = await getJSON(url);
      if (res && res.ok && res.data) {
        try { localStorage.setItem(key, JSON.stringify({ v: version, data: res.data })); } catch { /* 空間不足時就不存 */ }
        return res.data;
      }
    } catch { /* fall back */ }
  }
  // 網站沒有內建題目了：老師還沒匯入的單元沒有題目
  throw new Error('老師還沒有放入這個單元的題目');
}

// 把老師後台「新增單元」建立的全新課次併進單元清單（網站原本沒有的 id）
export function addCustomUnits(index, config) {
  const list = (config && config.customUnits) || [];
  list.forEach((u) => {
    if (index.units.some((x) => x.id === u.id)) return;
    index.units.push({
      id: u.id, lesson: u.lesson || 1, type: ['reading', 'pattern', 'exam'].includes(u.type) ? u.type : 'vocab',
      title: u.title || u.id, topic: u.topic || '', count: 0, sample: false,
    });
  });
}

// 把匯入內容的題數、主題套到單元清單上，並拿掉「範例」標記
export function applyImported(index, config) {
  const content = (config && config.content) || {};
  index.units.forEach((u) => {
    const c = content[u.id];
    if (!c) return;
    if (c.count) u.count = c.count;
    if (c.topic) u.topic = c.topic;
    u.sample = false;
  });
}
