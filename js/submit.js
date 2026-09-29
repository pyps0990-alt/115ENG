import { SCRIPT_URL } from './config.js';
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
const TIMEOUT_MS = 45000; // 伺服器排隊最多等 30 秒，多留一點時間
async function post(payload) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
      credentials: 'omit',
      cache: 'no-store',
      signal: ctrl.signal,
    });
    const j = JSON.parse(await r.text());
    if (j && (j.ok || j.duplicate)) return 'ok';
    if (j && j.busy) return 'retry';
    // 伺服器明確拒絕（例如資料不完整）：重送也不會成功，丟掉，免得卡住後面的成績
    console.warn('成績被伺服器拒絕，不再重送', j, payload);
    return 'drop';
  } catch {
    return 'retry'; // 網路失敗、逾時、Google 偶發回應網頁：稍後再送
  } finally {
    clearTimeout(t);
  }
}

// 排隊中的成績：每隔一段時間自動重送（20 秒起，最多 2 分鐘），恢復連線、重新開站時也會重送
let flushing = null;
let retryTimer = null;
let retryDelay = 20000;
function scheduleRetry() {
  clearTimeout(retryTimer);
  if (!readBox().length) { retryDelay = 20000; return; }
  retryTimer = setTimeout(() => { flushOutbox(); }, retryDelay);
  retryDelay = Math.min(retryDelay * 2, 120000);
}

export function flushOutbox() {
  if (!SCRIPT_URL) return Promise.resolve(0);
  if (flushing) return flushing;
  flushing = (async () => {
    let sent = 0;
    for (const item of readBox()) {
      const res = await post(item);
      if (res === 'retry') break; // 伺服器忙或網路不穩：這筆跟後面的都留著，稍後再送
      // 送出期間可能被標記為排隊中（交卷畫面等太久先放行），以最新的狀態為準
      const cur = readBox().find((x) => x.attemptId === item.attemptId) || item;
      writeBox(readBox().filter((x) => x.attemptId !== item.attemptId));
      if (res === 'drop') continue;
      sent++;
      // 之前排過隊的成績送出後，通知畫面右下角
      if (cur.queuedAt) window.dispatchEvent(new CustomEvent('score-sent', { detail: cur }));
    }
    if (sent) retryDelay = 20000;
    return sent;
  })().finally(() => { flushing = null; scheduleRetry(); });
  return flushing;
}

// 交卷畫面最多等這麼久；還沒確認就先讓學生離開，背景繼續送，送到時右下角通知
const SCREEN_WAIT_MS = 5000;

export async function submitScore(payload) {
  const item = { ...payload, attemptId: payload.attemptId || newAttemptId() };
  // 另外存一份到 Firestore，跟送去老師試算表互不影響
  import('./firebase.js').then((fb) => fb.saveScoreToFirestore(item, (store.student() || {}).key)).catch((e) => console.warn(e));
  if (item.unit) store.setDone(item.unit);
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
