// 測試用的假 Realtime Database（在線統計、即時監控）：寫入只記下來，讀取回傳空資料
const S = (window.__rtdb = window.__rtdb || { writes: [] });
export function getDatabase() { return {}; }
export function ref(_db, path = '') { return { path }; }
export async function set(r, v) { S.writes.push(['set', r.path, v]); }
export async function update(r, v) { S.writes.push(['update', r.path, v]); }
export async function remove(r) { S.writes.push(['remove', r.path]); }
export function onDisconnect() { return { set: async () => {}, remove: async () => {}, cancel: async () => {}, update: async () => {} }; }
export function onValue(r, cb) { setTimeout(() => cb({ val: () => (r.path === '.info/connected' ? true : r.path === '.info/serverTimeOffset' ? 0 : null), exists: () => false }), 0); return () => {}; }
export function serverTimestamp() { return Date.now(); }
export function increment(n) { return n; }
export function goOffline() {}
export function goOnline() {}
