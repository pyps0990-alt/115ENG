// Firestore / Firebase Auth
//   vault/{key}                         學生帳本：key = SHA-256(班級|座號|姓名)，老師匯入名單時建立
//   vault/{key}/attempts/{attemptId}    該生每次測驗紀錄（學生登入後讀回，確認做過哪些單元）
//   classes/{cls}/seats/{seat}/units/{unit}/attempts/{attemptId}   老師在主控台依班級瀏覽用
//   admins/{email}                      老師／管理員名單（在 Firebase 主控台手動新增）
// 名單上沒有的班級/座號/姓名組合算不出存在的 key，所以進不去；規則也不允許列出 vault。
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js';
import {
  getFirestore, doc, getDoc, getDocs, setDoc, collection, writeBatch, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js';
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged,
} from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js';

const app = initializeApp({
  apiKey: 'AIzaSyC0HFF3YjrsONdvYwTrofihkqNGiQjjdyc',
  authDomain: 'eng-3385e.firebaseapp.com',
  projectId: 'eng-3385e',
  storageBucket: 'eng-3385e.firebasestorage.app',
  messagingSenderId: '396514115433',
  appId: '1:396514115433:web:2bbe5d62c272bb69fa87f8',
});
const db = getFirestore(app);
const auth = getAuth(app);

const clean = (s, max) => String(s == null ? '' : s).trim().slice(0, max);

const normName = (s) => clean(s, 40).replace(/\s+/g, '');

export async function studentKey(cls, seat, name) {
  const bytes = new TextEncoder().encode(`${clean(cls, 8)}|${clean(seat, 4)}|${normName(name)}`);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/* ---------------- 學生 ---------------- */

// 回傳 { ok: true, key, name } 或 { ok: false }
export async function verifyStudent({ cls, seat, name }) {
  const key = await studentKey(cls, seat, name);
  const snap = await getDoc(doc(db, 'vault', key));
  if (!snap.exists()) return { ok: false };
  return { ok: true, key, name: snap.data().name };
}

export async function loadHistory(key) {
  const snap = await getDocs(collection(db, 'vault', key, 'attempts'));
  return snap.docs.map((d) => d.data());
}

function cleanDetails(list) {
  if (!Array.isArray(list)) return [];
  return list.slice(0, 150).map((x) => ({
    stage: clean(x.stage, 20),
    kind: clean(x.kind, 20),
    n: Number(x.n) || 0,
    question: clean(x.q, 300),
    correct: clean(x.correct, 200),
    yours: clean(x.yours, 200),
    ok: !!x.ok,
    points: Number(x.points) || 0,
    hints: Number(x.hints) || 0,
  }));
}

// 同時寫進學生帳本（讓學生讀回）與班級路徑（老師瀏覽）。attemptId 當文件 ID，重複送出不會多一筆。
export async function saveScoreToFirestore(payload, key) {
  const cls = clean(payload.cls, 8);
  const seat = clean(payload.seat, 4);
  const unit = clean(payload.unit, 60);
  const attemptId = clean(payload.attemptId, 64);
  if (!cls || !seat || !unit || !attemptId) return;
  const record = {
    cls, seat, unit, attemptId,
    name: clean(payload.name, 40),
    unitTitle: clean(payload.unitTitle, 80),
    level: clean(payload.level, 40),
    mode: clean(payload.mode, 30),
    review: !!payload.review,
    score: Number(payload.score) || 0,
    total: Number(payload.total) || 0,
    pct: Number(payload.pct) || 0,
    basic: clean(payload.basic, 12),
    advanced: clean(payload.advanced, 12),
    mastery: clean(payload.mastery, 12),
    wrong: Array.isArray(payload.wrong) ? payload.wrong.slice(0, 60).map((w) => clean(w, 60)) : [],
    durationSec: Number(payload.durationSec) || 0,
    clientTs: clean(payload.clientTs, 30),
    details: cleanDetails(payload.details),
    createdAt: serverTimestamp(),
  };
  const writes = [setDoc(doc(db, 'classes', cls, 'seats', seat, 'units', unit, 'attempts', attemptId), record)];
  if (key) writes.push(setDoc(doc(db, 'vault', key, 'attempts', attemptId), record));
  const results = await Promise.allSettled(writes);
  results.forEach((r) => { if (r.status === 'rejected') console.warn('Firestore 成績寫入失敗（不影響送到老師試算表）', r.reason); });
}

/* ---------------- 老師 ---------------- */

// cb(null) 未登入；cb({ email, role }) 已登入，role 為 'teacher'、'admin' 或 null（不在名單）
export function watchStaff(cb) {
  return onAuthStateChanged(auth, async (user) => {
    if (!user) { cb(null); return; }
    const email = String(user.email || '').toLowerCase();
    let role = null;
    try {
      const snap = await getDoc(doc(db, 'admins', email));
      if (snap.exists()) role = snap.data().role === 'admin' ? 'admin' : 'teacher';
    } catch { /* 不在名單時規則會拒絕讀取 */ }
    cb({ email, role });
  });
}

export const staffSignIn = () => signInWithPopup(auth, new GoogleAuthProvider());
export const staffSignOut = () => signOut(auth);

// rows: [{ seat, name }]；只有 admins 名單內的帳號能寫入 vault
export async function importRoster(cls, rows) {
  const c = clean(cls, 8);
  const batch = writeBatch(db);
  for (const r of rows) {
    const seat = clean(r.seat, 4);
    const name = clean(r.name, 40);
    const key = await studentKey(c, seat, name);
    batch.set(doc(db, 'vault', key), { cls: c, seat, name, updatedAt: serverTimestamp() });
    batch.set(doc(db, 'classes', c, 'seats', seat), { cls: c, seat, name, updatedAt: serverTimestamp() }, { merge: true });
  }
  await batch.commit();
}
