// 即時在線人數與交卷健康度（給老師的 monitor.html 看）。
// 每個分頁一個隨機的匿名編號，只記「在哪個畫面、哪個單元、什麼裝置」；不記姓名、班級、座號。
// 用 Firebase Realtime Database：關掉分頁或斷網時，伺服器自動刪掉這一筆（onDisconnect）。
// 免費方案同時連線上限 100：閒置 2 分鐘（作答中 6 分鐘）或分頁切到背景 1 分鐘就主動斷線，不在用的人不佔名額，
// 一有操作再連回來。資料庫還沒建立、被學校網路擋掉都安靜失敗，不影響作答。
import { RTDB_URL } from './config.js';

const SDK = 'https://www.gstatic.com/firebasejs/10.13.2/firebase-database.js';
const IDLE_MS = 120000;
const QUIZ_IDLE_MS = 360000; // 作答時可能盯著題目很久沒按任何東西
const HIDDEN_MS = 60000;
const BEAT_MS = 90000; // 在線時每 90 秒更新一次時間，監控頁把超過 4 分鐘沒更新的當成已離開

let state = { v: 'home', u: '' };
let kitP = null;
let kit = null;
let me = null;
let online = false;
let started = false;
let lastAct = Date.now();
let hideTimer = null;
let sid = '';

function rand() {
  const a = new Uint8Array(12);
  crypto.getRandomValues(a);
  return [...a].map((b) => b.toString(16).padStart(2, '0')).join('');
}
function sessionId() {
  if (sid) return sid;
  try {
    sid = sessionStorage.getItem('b5p:sid') || rand();
    sessionStorage.setItem('b5p:sid', sid);
  } catch { sid = sid || rand(); }
  return sid;
}
function device() {
  const touch = window.matchMedia && matchMedia('(pointer: coarse)').matches;
  if (!touch) return 'desktop';
  return Math.min(screen.width, screen.height) >= 600 ? 'tablet' : 'mobile';
}
// 統計用的日期與小時（臺灣時間）：['2026-10-08', '14']
export function hourKey(t = Date.now()) {
  const d = new Date(t + 8 * 3600000).toISOString();
  return [d.slice(0, 10), d.slice(11, 13)];
}

function load() {
  if (!kitP) {
    kitP = (async () => {
      if (!RTDB_URL) return null;
      const [{ firebaseApp }, m] = await Promise.all([import('./firebase.js'), import(SDK)]);
      kit = { m, db: m.getDatabase(firebaseApp, RTDB_URL) };
      return kit;
    })().catch((e) => { console.warn('即時在線統計無法啟用（不影響作答）', e); return null; });
  }
  return kitP;
}

function write() {
  if (!online || !kit || !me) return;
  const { m } = kit;
  const rec = { v: state.v, d: device(), t: m.serverTimestamp() };
  if (state.u) rec.u = state.u;
  m.set(me, rec).catch(() => {});
}

async function goOnline() {
  if (online) return;
  online = true;
  const k = await load();
  if (!k) { online = false; return; }
  const { m, db } = k;
  m.goOnline(db);
  if (!me) {
    me = m.ref(db, `presence/${sessionId()}`);
    // 每次連上（含斷線後重新連上）都重新登記「斷線時刪掉我」，再寫入目前狀態
    m.onValue(m.ref(db, '.info/connected'), (snap) => {
      if (!snap.val()) return;
      m.onDisconnect(me).remove().then(write).catch(() => {});
    });
  }
  write();
  // 每小時第一次上線算一次「使用人次」
  const hk = hourKey().join('/');
  try {
    if (sessionStorage.getItem('b5p:sid-hour') !== hk) { sessionStorage.setItem('b5p:sid-hour', hk); track('sessions'); }
  } catch { /* ignore */ }
}

function goOffline() {
  if (!online || !kit) return;
  online = false;
  kit.m.goOffline(kit.db); // 連線一斷，伺服器就執行 onDisconnect 刪掉這一筆
}

function activity() {
  lastAct = Date.now();
  if (document.visibilityState === 'visible') goOnline();
}

// 目前在哪個畫面：home 首頁、login 輸入資料、unit 單元頁（開始、結果、檢討）、quiz-vocab／quiz-reading／quiz-pattern 作答中、me 我的成績、other 其他
export function setPresence(v, u = '') {
  if (state.v === v && state.u === u) return;
  state = { v: String(v).slice(0, 20), u: String(u || '').slice(0, 60) };
  if (started) activity();
  write();
}

export function startPresence() {
  if (started || !RTDB_URL) return;
  started = true;
  ['pointerdown', 'keydown', 'touchstart'].forEach((t) => window.addEventListener(t, activity, { passive: true, capture: true }));
  window.addEventListener('scroll', activity, { passive: true });
  document.addEventListener('visibilitychange', () => {
    clearTimeout(hideTimer);
    if (document.visibilityState === 'visible') activity();
    else hideTimer = setTimeout(goOffline, HIDDEN_MS);
  });
  setInterval(() => {
    if (!online) return;
    const idle = Date.now() - lastAct;
    if (idle > (state.v.startsWith('quiz') ? QUIZ_IDLE_MS : IDLE_MS)) goOffline();
    else write();
  }, BEAT_MS);
  activity();
}

// 交卷健康度：sessions 使用人次、sent 直接送出、queued 先排隊、late 排隊後送出、volatile 存不了只在記憶體、rejected 被拒收
const FIELDS = ['sessions', 'sent', 'queued', 'late', 'volatile', 'rejected'];
export async function track(field) {
  if (!FIELDS.includes(field)) return;
  const k = await load();
  if (!k) return;
  const [day, hour] = hourKey();
  const { m, db } = k;
  // 不在線時寫入會排隊，連上後自動送出
  m.set(m.ref(db, `stats/${day}/${hour}/${field}`), m.increment(1)).catch(() => {});
}
