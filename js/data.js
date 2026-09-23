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

// 老師在後台匯入過的單元，改讀試算表裡的內容；讀不到時退回網站內建的 JSON
export async function loadUnit(id, config) {
  const imported = config && config.content && config.content[id];
  if (imported && SCRIPT_URL) {
    const url = `${SCRIPT_URL}${SCRIPT_URL.includes('?') ? '&' : '?'}action=content&unit=${encodeURIComponent(id)}&v=${encodeURIComponent(imported.updated || '')}`;
    try {
      const res = await getJSON(url);
      if (res && res.ok && res.data) return res.data;
    } catch { /* fall back */ }
  }
  return getJSON(`data/lessons/${encodeURIComponent(id)}.json`);
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
