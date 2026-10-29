// 測試用的假 Firestore SDK：狀態放在 window.__fb，測試程式可以從外面推送資料
const S = (window.__fb = window.__fb || {});
S.docs = S.docs || {};
S.listeners = S.listeners || [];
S.log = S.log || [];
S.allowedKey = S.allowedKey || null;
S.studentName = S.studentName || '陳奕嘉';
S.push = (path, data) => {
  S.docs[path] = data;
  S.listeners.filter((l) => l.path === path).forEach((l) => l.cb({ exists: () => true, data: () => data }));
};
const snap = (v) => ({ exists: () => v !== undefined, data: () => v, id: 'x' });
export function initializeFirestore(app, opts) { S.log.push(['initializeFirestore', JSON.stringify(opts)]); return { app, opts }; }
export function doc(_db, ...path) { return { path: path.join('/') }; }
export function collection(_db, ...path) { return { path: path.join('/') }; }
export async function getDoc(ref) {
  await new Promise((r) => setTimeout(r, 20));
  if (ref.path.startsWith('vault/')) return snap(S.allowedKey === null || ref.path === `vault/${S.allowedKey}` ? { name: S.studentName } : undefined);
  if (ref.path.startsWith('admins/')) return snap(S.staff && S.staff.includes(ref.path.slice(7)) ? { role: 'teacher' } : undefined);
  return snap(S.docs[ref.path]);
}
export function onSnapshot(ref, cb) {
  S.listeners.push({ path: ref.path, cb });
  S.log.push(['onSnapshot', ref.path]);
  return () => { S.listeners = S.listeners.filter((l) => l.cb !== cb); };
}
export async function getDocs(col) {
  S.log.push(['getDocs', col.path]);
  // 測試可以事先在 window.__fb.attempts / reviews 放這位學生的紀錄
  if (col.path === 'acks') return { docs: Object.keys(S.docs).filter((k) => k.startsWith('acks/')).map((k) => ({ id: k.slice(5), ref: { path: k }, data: () => S.docs[k] })) };
  const list = col.path.endsWith('/attempts') ? (S.attempts || []) : col.path.endsWith('/reviews') ? (S.reviews || []) : [];
  return { docs: list.map((d) => ({ id: d.id || 'x', ref: { path: `classes/${d.cls || 'x'}/attempts/${d.id || 'x'}` }, data: () => d })) };
}
export async function setDoc(ref, data) { S.log.push(['setDoc', ref.path]); S.docs[ref.path] = data; }
export function writeBatch() {
  const ops = [];
  return { set: (ref, d) => ops.push([ref.path, d]), delete: (ref) => ops.push([ref.path, undefined]), commit: async () => { ops.forEach(([p, d]) => { if (d === undefined) delete S.docs[p]; else S.docs[p] = d; }); S.log.push(['batch', String(ops.length)]); } };
}
export function serverTimestamp() { return { ts: Date.now() }; }
// 後台成績查詢、離線快取用到的 API（假的：查詢條件只記下來，不真的篩選）
export function persistentLocalCache(o) { return { kind: 'persistent', ...o }; }
export function persistentMultipleTabManager() { return { kind: 'multi-tab' }; }
export function collectionGroup(_db, id) { return { path: `**/${id}` }; }
export function query(ref, ...cons) { return { path: ref.path, cons }; }
export function where(f, op, v) { return { where: [f, op, v] }; }
export function orderBy(f, dir) { return { orderBy: [f, dir] }; }
export function limit(n) { return { limit: n }; }
export const Timestamp = { fromMillis: (ms) => ({ toMillis: () => ms }), now: () => ({ toMillis: () => Date.now() }) };
