import { SCRIPT_URL } from './config.js';

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

// Apps Script Web App 不支援 CORS preflight，所以用 text/plain + no-cors 送出。
// no-cors 拿不到回應內容；請求有送出就視為成功（重複送出由伺服器用 attemptId 擋掉）。
async function post(payload) {
  await fetch(SCRIPT_URL, {
    method: 'POST',
    mode: 'no-cors',
    keepalive: JSON.stringify(payload).length < 60000,
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(payload),
  });
}

let flushing = null;
export function flushOutbox() {
  if (!SCRIPT_URL) return Promise.resolve(0);
  if (flushing) return flushing;
  flushing = (async () => {
    let sent = 0;
    for (const item of readBox()) {
      try {
        await post(item);
        writeBox(readBox().filter((x) => x.attemptId !== item.attemptId));
        sent++;
      } catch {
        break; // 還是離線，下次再試
      }
    }
    return sent;
  })().finally(() => { flushing = null; });
  return flushing;
}

export async function submitScore(payload) {
  if (!SCRIPT_URL) return { status: 'disabled' };
  const item = { ...payload, attemptId: payload.attemptId || newAttemptId() };
  writeBox([...readBox().filter((x) => x.attemptId !== item.attemptId), item]);
  if (flushing) await flushing.catch(() => {});
  await flushOutbox();
  const stillQueued = readBox().some((x) => x.attemptId === item.attemptId);
  return { status: stillQueued ? 'queued' : 'sent', attemptId: item.attemptId };
}

export const pendingCount = () => readBox().length;
