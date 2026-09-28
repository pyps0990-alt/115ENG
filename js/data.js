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

export const loadIndex = () => getJSON('data/lessons/index.json');

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
    const url = `${SCRIPT_URL}${SCRIPT_URL.includes('?') ? '&' : '?'}action=content&unit=${encodeURIComponent(id)}&v=${encodeURIComponent(version)}`;
    try {
      const res = await getJSON(url);
      if (res && res.ok && res.data) {
        try { localStorage.setItem(key, JSON.stringify({ v: version, data: res.data })); } catch { /* 空間不足時就不存 */ }
        return res.data;
      }
    } catch { /* fall back */ }
  }
  return getJSON(`data/lessons/${encodeURIComponent(id)}.json`);
}

// 把老師後台「新增單元」建立的全新課次併進單元清單（網站原本沒有的 id）
export function addCustomUnits(index, config) {
  const list = (config && config.customUnits) || [];
  list.forEach((u) => {
    if (index.units.some((x) => x.id === u.id)) return;
    index.units.push({
      id: u.id, lesson: u.lesson || 1, type: u.type === 'reading' ? 'reading' : 'vocab',
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
