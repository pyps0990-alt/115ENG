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
    return !!(j && (j.ok || j.duplicate));
  } catch {
    return false;
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
      const ok = await post(item);
      if (!ok) break; // 伺服器忙或網路不穩：這筆跟後面的都留著，稍後再送
      writeBox(readBox().filter((x) => x.attemptId !== item.attemptId));
      sent++;
      // 之前排過隊的成績送出後，通知畫面右下角
      if (item.queuedAt) window.dispatchEvent(new CustomEvent('score-sent', { detail: item }));
    }
    if (sent) retryDelay = 20000;
    return sent;
  })().finally(() => { flushing = null; scheduleRetry(); });
  return flushing;
}

export async function submitScore(payload) {
  const item = { ...payload, attemptId: payload.attemptId || newAttemptId() };
  // 另外存一份到 Firestore，跟送去老師試算表互不影響
  import('./firebase.js').then((fb) => fb.saveScoreToFirestore(item, (store.student() || {}).key)).catch((e) => console.warn(e));
  if (item.unit) store.setDone(item.unit);
  if (!SCRIPT_URL) return { status: 'disabled' };
  writeBox([...readBox().filter((x) => x.attemptId !== item.attemptId), item]);
  if (flushing) await flushing.catch(() => {});
  await flushOutbox();
  const stillQueued = readBox().some((x) => x.attemptId === item.attemptId);
  if (stillQueued) {
    // 標記為排隊中：之後送出時會通知
    writeBox(readBox().map((x) => (x.attemptId === item.attemptId ? { ...x, queuedAt: Date.now() } : x)));
    window.dispatchEvent(new CustomEvent('score-queued', { detail: item }));
  }
  return { status: stillQueued ? 'queued' : 'sent', attemptId: item.attemptId };
}

export const pendingCount = () => readBox().length;
