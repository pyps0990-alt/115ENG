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
  // 測試可以事先在 window.__fb.attempts / reviews 放這位學生的紀錄
  const list = col.path.endsWith('/attempts') ? (S.attempts || []) : col.path.endsWith('/reviews') ? (S.reviews || []) : [];
  return { docs: list.map((d) => ({ id: d.id || 'x', data: () => d })) };
}
export async function setDoc(ref, data) { S.log.push(['setDoc', ref.path]); S.docs[ref.path] = data; }
export function writeBatch() {
  const ops = [];
  return { set: (ref, d) => ops.push([ref.path, d]), commit: async () => { ops.forEach(([p, d]) => { S.docs[p] = d; }); S.log.push(['batch', String(ops.length)]); } };
}
export function serverTimestamp() { return { ts: Date.now() }; }
