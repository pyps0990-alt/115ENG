import { SCRIPT_URL } from './config.js';
import { PASS } from './types.js';
import { store } from './storage.js';

// 成績先放進這台裝置的等待清單，再送到 Apps Script；網路失敗時留在清單裡，
// 之後開站、恢復連線或下次送成績時自動補送。每筆有 attemptId，伺服器會去除重複。
const OUTBOX = 'b5p:outbox';
const MAX_QUEUE = 50;

function readBox() {
  try { return JSON.parse(localStorage.getItem(OUTBOX) || '[]'); } catch { return []; }
}
function writeBox(list) {
  try { localStorage.setItem(OUTBOX, JSON.stringify(list.slice(-MAX_QUEUE))); } catch { /* ignore */ }
}

export function newAttemptId() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// 用 text/plain 送出（Apps Script 不支援 CORS preflight），並讀回伺服器的回應：
// 伺服器確認寫入（或判定重複）才算送出；忙碌、網路失敗、回應異常都留在排隊清單稍後重送。
const TIMEOUT_MS = 45000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function fetchTimeout(url, opts, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(url, { ...opts, signal: ctrl.signal }); } finally { clearTimeout(t); }
}
// 伺服器有沒有收到這筆（用 GET 查，Safari 讀得到）
async function seenOnServer(id) {
  try {
    const r = await fetchTimeout(`${SCRIPT_URL}?action=check&id=${encodeURIComponent(id)}&t=${Date.now()}`, { cache: 'no-store', credentials: 'omit' }, 15000);
    return !!JSON.parse(await r.text()).seen;
  } catch { return false; }
}
async function post(payload) {
  const body = JSON.stringify(payload);
  let j = null;
  let readable = true;
  try {
    const r = await fetchTimeout(SCRIPT_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body, credentials: 'omit', cache: 'no-store' }, TIMEOUT_MS);
    try { j = JSON.parse(await r.text()); } catch { j = null; }
  } catch {
    // 讀不到回應（Safari 對跨網站轉址的回應常會這樣）：改用 no-cors 送出，再用 GET 確認伺服器有沒有收到
    readable = false;
    try { await fetch(SCRIPT_URL, { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body }); } catch { return 'retry'; }
  }
  if (j && (j.ok || j.duplicate)) return 'ok';
  if (j && j.busy) return 'retry';
  if (j && j.ok === false) {
    // 伺服器明確拒絕（例如資料不完整）：重送也不會成功，丟掉，免得卡住後面的成績
    console.warn('成績被伺服器拒絕，不再重送', j, payload);
    return 'drop';
  }
  // 回應異常或讀不到：確認伺服器是否其實已經寫入
  for (let i = 0; i < (readable ? 1 : 3); i++) {
    if (i) await sleep(3000);
    if (await seenOnServer(payload.attemptId)) return 'ok';
  }
  return 'retry';
}

// 排隊中的成績：每隔一段時間自動重送（約 8 秒起、每次加倍，最多 2 分鐘），恢復連線、重新開站時也會重送
let flushing = null;
let retryTimer = null;
const FIRST_RETRY_MS = 8000; // 伺服器收件很快（不到 1 秒），第一次重送不用等太久
let retryDelay = FIRST_RETRY_MS;
function scheduleRetry() {
  clearTimeout(retryTimer);
  if (!readBox().length) { retryDelay = FIRST_RETRY_MS; return; }
  // 加上隨機的偏移：全班同時交卷、伺服器忙的時候，大家不會在同一秒一起重送而再次塞車
  const wait = retryDelay * (0.6 + Math.random() * 0.8);
  retryTimer = setTimeout(() => { flushOutbox(); }, wait);
  retryDelay = Math.min(retryDelay * 2, 120000);
}

// 附上登入時算出的帳本 key，伺服器用它確認是名單上的學生（更新前排隊的舊成績也補上）
function withKey(item) {
  if (item.key) return item;
  const s = store.student() || {};
  return s.key && s.cls === item.cls && s.seat === item.seat ? { ...item, key: s.key } : item;
}

export function flushOutbox() {
  if (!SCRIPT_URL) return Promise.resolve(0);
  if (flushing) return flushing;
  flushing = (async () => {
    let sent = 0;
    for (const item of readBox()) {
      const res = await post(withKey(item));
      if (res === 'retry') break; // 伺服器忙或網路不穩：這筆跟後面的都留著，稍後再送
      // 送出期間可能被標記為排隊中（交卷畫面等太久先放行），以最新的狀態為準
      const cur = readBox().find((x) => x.attemptId === item.attemptId) || item;
      writeBox(readBox().filter((x) => x.attemptId !== item.attemptId));
      if (res === 'drop') continue;
      sent++;
      // 之前排過隊的成績送出後，通知畫面右下角
      if (cur.queuedAt) window.dispatchEvent(new CustomEvent('score-sent', { detail: cur }));
    }
    if (sent) retryDelay = FIRST_RETRY_MS;
    return sent;
  })().finally(() => { flushing = null; scheduleRetry(); });
  return flushing;
}

// 交卷畫面最多等這麼久；還沒確認就先讓學生離開，背景繼續送，送到時右下角通知
const SCREEN_WAIT_MS = 5000;

export async function submitScore(payload) {
  const item = withKey({ ...payload, attemptId: payload.attemptId || newAttemptId() });
  // 另外存一份到 Firestore，跟送去老師試算表互不影響
  import('./firebase.js').then((fb) => fb.saveScoreToFirestore(item, item.key)).catch((e) => console.warn(e));
  // 通過（或複習）才算完成；沒通過要補考
  if (item.unit) { if (item.review || Number(item.pct) >= PASS) store.setDone(item.unit); else store.setTried(item.unit); }
  if (!SCRIPT_URL) return { status: 'disabled' };
  writeBox([...readBox().filter((x) => x.attemptId !== item.attemptId), item]);
  const inBox = () => readBox().some((x) => x.attemptId === item.attemptId);
  const done = (async () => {
    if (flushing) await flushing.catch(() => {});
    await flushOutbox();
  })();
  const timedOut = await Promise.race([
    done.then(() => false),
    new Promise((r) => setTimeout(() => r(true), SCREEN_WAIT_MS)),
  ]);
  if (inBox()) {
    // 還沒確認：標記為排隊中，之後送出時右下角會通知
    writeBox(readBox().map((x) => (x.attemptId === item.attemptId ? { ...x, queuedAt: Date.now() } : x)));
    if (!timedOut) window.dispatchEvent(new CustomEvent('score-queued', { detail: item }));
    return { status: timedOut ? 'pending' : 'queued', attemptId: item.attemptId };
  }
  return { status: 'sent', attemptId: item.attemptId };
}

export const pendingCount = () => readBox().length;
export const pendingItems = () => readBox();
export const clearOutbox = () => writeBox([]);
