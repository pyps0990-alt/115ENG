// Firestore / Firebase Auth
//   vault/{key}                         學生帳本：key = SHA-256(班級|座號|姓名)，老師匯入名單時建立
//   vault/{key}/attempts/{attemptId}    該生每次測驗紀錄（學生登入後讀回，確認做過哪些單元）
//   classes/{cls}/seats/{seat}/units/{unit}/attempts/{attemptId}   老師在主控台依班級瀏覽用
//   admins/{email}                      老師／管理員名單（在 Firebase 主控台手動新增）
// 名單上沒有的班級/座號/姓名組合算不出存在的 key，所以進不去；規則也不允許列出 vault。
import { SCRIPT_URL } from './config.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js';
import {
  initializeFirestore, doc, getDoc, onSnapshot, getDocs, setDoc, collection, writeBatch, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js';

const app = initializeApp({
  apiKey: 'AIzaSyC0HFF3YjrsONdvYwTrofihkqNGiQjjdyc',
  authDomain: 'eng-3385e.firebaseapp.com',
  projectId: 'eng-3385e',
  storageBucket: 'eng-3385e.firebasestorage.app',
  messagingSenderId: '396514115433',
  appId: '1:396514115433:web:2bbe5d62c272bb69fa87f8',
});
// 學校網路（代理伺服器、防火牆）有時會擋掉即時連線：自動偵測，擋掉時改用長輪詢，即時同步才不會斷
const db = initializeFirestore(app, { experimentalAutoDetectLongPolling: true });

// 登入元件只有老師需要：學生打開網站時不載入，首頁快很多
const AUTH_URL = 'https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js';
let authKitP = null;
export function authKit() {
  if (!authKitP) authKitP = import(AUTH_URL).then((m) => ({ m, auth: m.getAuth(app) }));
  authKitP.catch(() => { authKitP = null; });
  return authKitP;
}

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

// 回傳 { attempts: [...], reviews: [已檢討完的單元 id] }
export async function loadHistory(key) {
  const [a, r] = await Promise.all([
    getDocs(collection(db, 'vault', key, 'attempts')),
    getDocs(collection(db, 'vault', key, 'reviews')),
  ]);
  const ms = (t) => (t && t.toMillis ? t.toMillis() : 0);
  return {
    attempts: a.docs.map((d) => ({ ...d.data(), at: ms(d.data().createdAt) || Date.parse(d.data().clientTs) || 0 })),
    reviews: r.docs.map((d) => ({ id: d.id, at: ms(d.data().at) })),
  };
}

export async function markReviewed(key, unit) {
  if (!key || !unit) return;
  await setDoc(doc(db, 'vault', key, 'reviews', clean(unit, 60)), { unit: clean(unit, 60), at: serverTimestamp() });
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
    word: clean(x.word, 80),
    err: clean(x.err, 20),
    exampleEn: clean(x.exampleEn, 200),
    exampleZh: clean(x.exampleZh, 200),
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
  let unsub = () => {};
  let dead = false;
  authKit().then(({ m, auth }) => {
    if (dead) return;
    unsub = m.onAuthStateChanged(auth, async (user) => {
      if (!user) { cb(null); return; }
      const email = String(user.email || '').toLowerCase();
      let role = null;
      let reason = '';
      try {
        const snap = await getDoc(doc(db, 'admins', email));
        if (snap.exists()) role = snap.data().role === 'admin' ? 'admin' : 'teacher';
        else reason = `Firestore 的 admins 裡沒有文件 ID「${email}」`;
      } catch (e) {
        reason = `讀取 Firestore 老師名單失敗（${e.code || e.message}）`;
      }
      // 備援：網站自己讀不到時，請 Apps Script 確認（試算表 teachers 或 Firestore admins 任一份有就算）
      if (!role) {
        try {
          const idToken = await user.getIdToken();
          const r = await fetch(SCRIPT_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ api: 'whoami', idToken }), credentials: 'omit', cache: 'no-store' });
          const j = JSON.parse(await r.text());
          if (j.ok) role = 'teacher';
          else reason += `；後台確認：${j.error || '不在老師名單'}`;
        } catch (e) {
          reason += `；後台確認失敗（${e.message}）`;
        }
      }
      cb({ email, role, reason });
    });
  }).catch((e) => { cb({ email: '', role: null, reason: `無法載入登入元件（${e.message}）` }); });
  return () => { dead = true; unsub(); };
}

// 要在按鈕的點擊事件裡直接呼叫：登入元件事先用 authKit() 載入好，瀏覽器才不會擋掉彈出視窗
export const staffSignIn = async () => {
  const { m, auth } = await authKit();
  return m.signInWithPopup(auth, new m.GoogleAuthProvider());
};
export const staffSignOut = async () => { const { m, auth } = await authKit(); return m.signOut(auth); };
// 老師後台呼叫 Apps Script 時附上的登入憑證（伺服器端會再驗證一次身分）
export const staffIdToken = async () => {
  const { auth } = await authKit();
  if (!auth.currentUser) throw new Error('請先登入');
  return auth.currentUser.getIdToken();
};

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

/* ---------------- 老師設定即時同步 ---------------- */
// public/config 由 Apps Script 在老師儲存時寫入；有變動時 Firestore 會立即推給正在使用的學生
export function watchPublicConfig(cb) {
  return onSnapshot(doc(db, 'public', 'config'), (snap) => {
    if (!snap.exists()) return;
    try { cb(JSON.parse(snap.data().json)); } catch { /* ignore */ }
  }, (e) => console.warn('即時同步失敗', e));
}

// 老師後台儲存時，瀏覽器直接把設定／題目寫進 Firestore（不用等 Apps Script 開機與寫試算表），
// 學生端幾乎同時就收到。docs: { config: {...}, content_l1: { v, data } }，一個請求寫完，要嘛全成功要嘛全不寫。
// 用 REST 而不是 SDK 的寫入：可以設逾時、斷線時不會把舊的修改排在佇列裡，之後才突然蓋掉新的設定。
export async function publishPublic(docs, ms = 8000) {
  const idToken = await staffIdToken();
  const root = 'projects/eng-3385e/databases/(default)/documents';
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(`https://firestore.googleapis.com/v1/${root}:commit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
      body: JSON.stringify({
        writes: Object.entries(docs).map(([id, obj]) => ({
          update: { name: `${root}/public/${id}`, fields: { json: { stringValue: JSON.stringify(obj) } } },
        })),
      }),
      signal: ctrl.signal,
    });
    if (!r.ok) {
      let status = '';
      try { status = (await r.json()).error.status || ''; } catch { /* ignore */ }
      const err = new Error(`Firestore ${r.status} ${status}`);
      err.code = status || String(r.status);
      throw err;
    }
  } catch (e) {
    if (e.name === 'AbortError') { const err = new Error('連線逾時'); err.code = 'timeout'; throw err; }
    throw e;
  } finally { clearTimeout(timer); }
}
