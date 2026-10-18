// Firestore / Firebase Auth
//   vault/{key}                         學生帳本：key = SHA-256(班級|座號|姓名)，老師匯入名單時建立
//   vault/{key}/attempts/{attemptId}    該生每次測驗紀錄（學生登入後讀回，確認做過哪些單元）
//   classes/{cls}/seats/{seat}/units/{unit}/attempts/{attemptId}   老師在主控台依班級瀏覽用
//   admins/{email}                      老師／管理員名單（在 Firebase 主控台手動新增）
// 名單上沒有的班級/座號/姓名組合算不出存在的 key，所以進不去；規則也不允許列出 vault。
import { SCRIPT_URL, APP_CHECK_SITE_KEY } from './config.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js';
import {
  initializeFirestore, doc, getDoc, onSnapshot, getDocs, setDoc, collection, writeBatch, serverTimestamp,
  persistentLocalCache, persistentMultipleTabManager, collectionGroup, increment, query, where, orderBy, limit, Timestamp,
} from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js';

const app = initializeApp({
  apiKey: 'AIzaSyC0HFF3YjrsONdvYwTrofihkqNGiQjjdyc',
  authDomain: 'eng-3385e.firebaseapp.com',
  projectId: 'eng-3385e',
  storageBucket: 'eng-3385e.firebasestorage.app',
  messagingSenderId: '396514115433',
  appId: '1:396514115433:web:2bbe5d62c272bb69fa87f8',
});
// App Check：要在 Firestore、Realtime Database 第一次連線前啟用，之後的請求才會自動帶上憑證。
// 載入失敗（例如網路擋掉 reCAPTCHA）不影響網站：主控台還沒「強制執行」前，沒有憑證的請求照樣放行
if (APP_CHECK_SITE_KEY) {
  try {
    const ac = await import('https://www.gstatic.com/firebasejs/10.13.2/firebase-app-check.js');
    ac.initializeAppCheck(app, { provider: new ac.ReCaptchaEnterpriseProvider(APP_CHECK_SITE_KEY), isTokenAutoRefreshEnabled: true });
  } catch (e) { console.warn('App Check 無法啟用', e); }
}
// 學校網路（代理伺服器、防火牆）有時會擋掉即時連線：自動偵測，擋掉時改用長輪詢，即時同步才不會斷
// 寫入先存在裝置上（IndexedDB）：沒網路、重新整理、關掉再開都還在，連上網自動補送；不支援時 SDK 自動改用記憶體
const db = initializeFirestore(app, {
  experimentalAutoDetectLongPolling: true,
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});
// 即時在線統計（js/presence.js）與監控頁共用同一個 Firebase app
export const firebaseApp = app;

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
    correct: clean(x.correct, x.open ? 800 : 200),
    yours: clean(x.yours, x.open ? 3000 : 200),
    ok: !!x.ok,
    open: !!x.open,
    points: Number(x.points) || 0,
    hints: Number(x.hints) || 0,
    word: clean(x.word, 80),
    err: clean(x.err, 20),
    exampleEn: clean(x.exampleEn, 200),
    exampleZh: clean(x.exampleZh, 200),
    // 單字例句選字題：當時的選項、考第幾句、課外選項（逐題檢討重跑解題步驟要用；換裝置讀回來也要有）
    ...(Array.isArray(x.options) ? { options: x.options.slice(0, 6).map((o) => clean(o, 200)) } : {}),
    ...(Number.isInteger(x.exIdx) ? { exIdx: x.exIdx } : {}),
    ...(Array.isArray(x.extras) ? { extras: x.extras.slice(0, 3).map((e) => ({ form: clean(e.form, 60), word: clean(e.word, 60), zh: clean(e.zh, 60), pos: clean(e.pos, 20) })) } : {}),
  }));
}
// 課文理解的文章劃記（不計分）：{ p 第幾段, f 起, t 迄（第幾個字）, k 工具, n 便利貼文字 }，最多 300 個
function cleanMarks(list) {
  if (!Array.isArray(list)) return null;
  const tools = ['hl-yellow', 'hl-green', 'hl-pink', 'ul', 'circ', 'note'];
  return list.slice(0, 300).map((m) => ({ p: Math.max(0, Math.floor(Number(m.p) || 0)), f: Math.max(0, Math.floor(Number(m.f) || 0)), t: Math.max(0, Math.floor(Number(m.t) || 0)), k: tools.includes(m.k) ? m.k : 'hl-yellow', ...(m.n ? { n: clean(m.n, 200) } : {}), ...(Number.isInteger(m.q) && m.q >= 0 && m.q < 50 ? { q: m.q } : {}) }));
}

// 同時寫進學生帳本（讓學生讀回）與班級路徑（老師瀏覽）。attemptId 當文件 ID，重複送出不會多一筆。
export async function saveScoreToFirestore(payload, key) {
  const cls = clean(payload.cls, 8);
  const seat = clean(payload.seat, 4);
  const unit = clean(payload.unit, 60);
  const attemptId = clean(payload.attemptId, 64);
  if (!cls || !seat || !unit || !attemptId || !key) return 'nokey'; // 沒登入（沒有帳本 key）的成績規則不收，只送老師試算表
  const record = {
    cls, seat, unit, attemptId, key,
    name: clean(payload.name, 40),
    unitTitle: clean(payload.unitTitle, 80),
    level: clean(payload.level, 40),
    mode: clean(payload.mode, 30),
    review: !!payload.review,
    score: Number(payload.score) || 0,
    total: Number(payload.total) || 0,
    pct: Math.min(100, Math.max(0, Number(payload.pct) || 0)),
    basic: clean(payload.basic, 12),
    advanced: clean(payload.advanced, 12),
    mastery: clean(payload.mastery, 12),
    wrong: Array.isArray(payload.wrong) ? payload.wrong.slice(0, 60).map((w) => clean(w, 60)) : [],
    durationSec: Number(payload.durationSec) || 0,
    clientTs: clean(payload.clientTs, 30),
    details: cleanDetails(payload.details),
    createdAt: serverTimestamp(),
  };
  // 作答誠信紀錄（js/integrity.js）：離開畫面次數與秒數、偵測到翻譯、貼上、複製的次數
  const ig = payload.integrity;
  if (ig && typeof ig === 'object') {
    const n = (v) => Math.max(0, Math.min(100000, Math.floor(Number(v) || 0)));
    record.integrity = { away: n(ig.away), awaySec: n(ig.awaySec), translate: n(ig.translate), paste: n(ig.paste), copy: n(ig.copy) };
  }
  const marks = cleanMarks(payload.marks);
  if (marks && marks.length) record.marks = marks;
  // 兩份一起寫（要嘛都成功、要嘛都失敗）。Promise 在伺服器確認後才完成；離線時先存在裝置上，連上網再送
  const classRef = doc(db, 'classes', cls, 'seats', seat, 'units', unit, 'attempts', attemptId);
  const batch = writeBatch(db);
  batch.set(classRef, record);
  batch.set(doc(db, 'vault', key, 'attempts', attemptId), record);
  // 交卷次數計數器：規則要求每一筆成績都要把它加 1，而且有上限（防止有人繞過網站大量灌假紀錄）。
  // 用 increment：離線時排隊的好幾筆會依序累加，不會互相衝突
  batch.set(doc(db, 'vault', key, 'meta', 'quota'), { n: increment(1) }, { merge: true });
  try {
    await batch.commit();
    return 'ok';
  } catch (err) {
    // 規則只允許新增：同一筆再寫一次會被拒，確認已經存在就當成功
    if (err && err.code === 'permission-denied') {
      try { if ((await getDoc(classRef)).exists()) return 'ok'; } catch { /* 讀不到就當失敗 */ }
      console.warn('Firestore 拒絕這筆成績', err);
      return 'denied';
    }
    console.warn('Firestore 成績寫入失敗', err);
    return 'error';
  }
}

// 老師後台「成績」：最近 days 天的成績（可指定班級），新的在前。只取 classes 底下那一份（vault 底下是同一筆）
export async function listAttempts({ cls = '', days = 14, max = 500 } = {}) {
  const cons = [where('createdAt', '>=', Timestamp.fromMillis(Date.now() - days * 86400000)), orderBy('createdAt', 'desc'), limit(max * 2)];
  if (cls) cons.unshift(where('cls', '==', String(cls)));
  const snap = await getDocs(query(collectionGroup(db, 'attempts'), ...cons));
  return snap.docs.filter((d) => d.ref.path.startsWith('classes/')).slice(0, max).map((d) => {
    const x = d.data();
    return { ...x, at: x.createdAt && x.createdAt.toMillis ? x.createdAt.toMillis() : Date.parse(x.clientTs) || 0 };
  });
}

/* ---------------- 老師 ---------------- */

// 老師後台直接讀 Firestore 的公開文件（設定 config、題目 content_<單元>）：約 0.1 秒，不用等 Apps Script 的 1～3 秒。沒有這份文件回傳 null
export async function readPublic(id) {
  const snap = await getDoc(doc(db, 'public', id));
  if (!snap.exists()) return null;
  return JSON.parse(snap.data().json);
}

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
