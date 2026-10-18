import { SCRIPT_URL, SUBMIT_URL } from './config.js';
import { take } from './integrity.js';
import { PASS } from './types.js';
import { store } from './storage.js';

// 成績先放進這台裝置的等待清單，再送到伺服器計分（SUBMIT_URL；連不到才送 Apps Script）；網路失敗時留在清單裡，
// 之後開站、恢復連線或下次送成績時自動補送。每筆有 attemptId，伺服器會去除重複。
const OUTBOX = 'b5p:outbox';
const REJECTED = 'b5p:rejected';
const MAX_QUEUE = 50;

// 這台裝置存不了東西（儲存空間滿了、瀏覽器封鎖網站資料）：等待清單改放在記憶體，
// 這一頁開著的時候照樣會送、會重送；交卷畫面會請學生等到「已送出」再離開，離開前也會跳出提醒。
let mem = null;
function readBox() {
  if (mem) return mem.slice();
  try { return JSON.parse(localStorage.getItem(OUTBOX) || '[]'); } catch { return []; }
}
function writeBox(list) {
  const l = list.slice(-MAX_QUEUE);
  if (!mem) {
    try { localStorage.setItem(OUTBOX, JSON.stringify(l)); return; } catch { /* 存不進去：改用記憶體 */ }
  }
  mem = l;
}
export const storageBroken = () => !!mem;
window.addEventListener('beforeunload', (e) => {
  if (mem && mem.length) { e.preventDefault(); e.returnValue = ''; }
});

// 被伺服器拒收的成績（重送也不會成功）：不再靜默丟掉，留在這台裝置，「我的成績」頁列出來請學生截圖給老師
let memRejected = [];
export function rejectedItems() {
  try { return JSON.parse(localStorage.getItem(REJECTED) || '[]').concat(memRejected); } catch { return memRejected.slice(); }
}
function saveRejected(item, reason) {
  const rec = { ...item, reason: String(reason || '伺服器拒收').slice(0, 200), rejectedAt: new Date().toISOString() };
  try {
    const list = JSON.parse(localStorage.getItem(REJECTED) || '[]').filter((x) => x.attemptId !== item.attemptId);
    localStorage.setItem(REJECTED, JSON.stringify([...list, rec].slice(-20)));
  } catch { memRejected = [...memRejected.filter((x) => x.attemptId !== item.attemptId), rec]; }
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
    // 伺服器明確拒絕（例如資料不完整）：重送也不會成功，移出等待清單（免得卡住後面的成績），改記到「被拒收」清單
    console.warn('成績被伺服器拒絕，不再重送', j, payload);
    return `drop:${j.error || ''}`;
  }
  // 回應異常或讀不到：確認伺服器是否其實已經寫入
  for (let i = 0; i < (readable ? 1 : 3); i++) {
    if (i) await sleep(3000);
    if (await seenOnServer(payload.attemptId)) return 'ok';
  }
  return 'retry';
}

// 伺服器計分（Cloud Function）：回應有 CORS，每種瀏覽器都讀得到。
// 'ok'＝收到（或判定重複）；'retry'＝忙碌或暫時出錯；'drop:原因'＝拒收（不在名單、題型不符），重送也沒用；'unreachable'＝連不上
// 伺服器計分的結果（分數、明細；課文理解與句型練習還有完整題目）：交卷畫面與檢討要用
const results = new Map();
export const serverResult = (attemptId) => results.get(attemptId) || null;
// 完整題目（答案、解析）存在這台裝置：之後檢討、複習、錯題重練不用再問伺服器。v＝題目版本（老師改過題目就失效）
const KEYS_PREFIX = 'b5p:key:';
export function cachedKey(unit, v) {
  try { const k = JSON.parse(localStorage.getItem(KEYS_PREFIX + unit) || 'null'); return k && k.data && (!v || String(k.v) === String(v)) ? k.data : null; } catch { return null; }
}
function saveKey(unit, v, data) { try { localStorage.setItem(KEYS_PREFIX + unit, JSON.stringify({ v, data })); } catch { /* 空間不足就不存 */ } }
// 伺服器回覆成功：記下結果；用伺服器算的分數決定這個單元算不算完成（課文理解交卷時網站還不知道分數）
function applyResult(item, j) {
  results.set(item.attemptId, j);
  if (j.data && item.unit) saveKey(item.unit, j.v, j.data);
  if (item.unit && typeof j.pct === 'number') { if (item.review || j.pct >= PASS) store.setDone(item.unit); else store.setTried(item.unit); }
  window.dispatchEvent(new CustomEvent('score-graded', { detail: { attemptId: item.attemptId, unit: item.unit, result: j } }));
}
const who = () => { const s = store.student() || {}; return { cls: s.cls, seat: s.seat, name: s.name, key: s.key }; };
async function callServer(body, ms = 20000) {
  const r = await fetchTimeout(SUBMIT_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ ...who(), ...body }), credentials: 'omit', cache: 'no-store' }, ms);
  let j = null;
  try { j = await r.json(); } catch { j = null; }
  if (!j || !j.ok) { const e = new Error((j && j.error) || '連線失敗'); e.status = r.status; throw e; }
  return j;
}
// 課文理解、句型練習的完整題目（只給交過這個單元的學生）
export async function fetchKey(unit, v) {
  const hit = cachedKey(unit, v);
  if (hit) return hit;
  const j = await callServer({ op: 'key', unit });
  saveKey(unit, j.v, j.data);
  return j.data;
}
// 句型練習正式測驗的一題：伺服器判斷並記下，回傳 { got, q（這一題的答案與解析）}
export const checkAnswer = ({ unit, session, qid, yours }) => callServer({ op: 'answer', unit, session, qid, yours }, 15000);

async function postServer(payload) {
  let r;
  try {
    r = await fetchTimeout(SUBMIT_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(payload), credentials: 'omit', cache: 'no-store' }, TIMEOUT_MS);
  } catch {
    // 逾時或網路不通：伺服器可能其實已經收到，先確認
    try {
      const c = await fetchTimeout(`${SUBMIT_URL}?check=${encodeURIComponent(payload.attemptId)}&key=${encodeURIComponent(payload.key || '')}`, { cache: 'no-store', credentials: 'omit' }, 15000);
      if ((await c.json()).seen) return 'ok';
    } catch { /* 也連不上 */ }
    return 'unreachable';
  }
  let j = null;
  try { j = await r.json(); } catch { j = null; }
  if (j && (j.ok || j.duplicate)) { applyResult(payload, j); return 'ok'; }
  if (j && j.busy) return 'retry';
  if (j && j.ok === false) { console.warn('成績被伺服器拒絕，不再重送', j, payload); return `drop:${j.error || ''}`; }
  return 'retry';
}
// 一筆成績送哪裡：先送伺服器計分；連續 3 次連不上（例如學校網路擋掉）才改送 Apps Script 備援
const FALLBACK_AFTER = 3;
async function send(item) {
  if (SUBMIT_URL) {
    const r = await postServer(item);
    if (r !== 'unreachable') return r;
    const fails = (Number(item.fnFails) || 0) + 1;
    writeBox(readBox().map((x) => (x.attemptId === item.attemptId ? { ...x, fnFails: fails } : x)));
    if (fails < FALLBACK_AFTER || !SCRIPT_URL) return 'retry';
  }
  if (!SCRIPT_URL) return 'retry';
  const { fnFails, ...plain } = item; // eslint-disable-line no-unused-vars
  return post(plain);
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
  if (!SCRIPT_URL && !SUBMIT_URL) return Promise.resolve(0);
  if (flushing) return flushing;
  flushing = (async () => {
    let sent = 0;
    for (const item of readBox()) {
      const res = await send(withKey(item));
      if (res === 'retry') break; // 伺服器忙或網路不穩：這筆跟後面的都留著，稍後再送
      // 送出期間可能被標記為排隊中（交卷畫面等太久先放行），以最新的狀態為準
      const cur = readBox().find((x) => x.attemptId === item.attemptId) || item;
      writeBox(readBox().filter((x) => x.attemptId !== item.attemptId));
      if (res.startsWith('drop')) {
        saveRejected(cur, res.slice(5));
        track('rejected');
        window.dispatchEvent(new CustomEvent('score-rejected', { detail: cur }));
        continue;
      }
      sent++;
      // 之前排過隊的成績送出後，通知畫面右下角
      if (cur.queuedAt) { window.dispatchEvent(new CustomEvent('score-sent', { detail: cur })); track('late'); }
    }
    if (sent) retryDelay = FIRST_RETRY_MS;
    return sent;
  })().finally(() => { flushing = null; scheduleRetry(); });
  return flushing;
}

// 交卷畫面最多等這麼久（伺服器要重算分數、寫入、轉送試算表，通常 2～5 秒）；還沒確認就先讓學生離開，背景繼續送，送到時右下角通知
const SCREEN_WAIT_MS = 9000;

// 交卷健康度統計（給老師的即時監控頁）：動態載入，不拖慢交卷；失敗也不影響送成績
const track = (field) => { import('./presence.js').then((p) => p.track(field)).catch(() => {}); };

export async function submitScore(payload) {
  const integ = take(payload.unit); // 作答中離開畫面、翻譯、貼上的次數（沒有就不附）
  const item = withKey({ ...payload, ...(integ ? { integrity: integ } : {}), attemptId: payload.attemptId || newAttemptId() });
  // 通過（或複習）才算完成；沒通過要補考（伺服器重算的分數只會跟誠實作答一樣，不會比較高）。
  // 網站還不知道分數的（課文理解）等伺服器回覆再決定（applyResult）
  if (item.unit && item.pct != null) { if (item.review || Number(item.pct) >= PASS) store.setDone(item.unit); else store.setTried(item.unit); }
  if (!SUBMIT_URL && !SCRIPT_URL) return { status: 'disabled' };
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
    // 這台裝置存不了：關掉頁面就沒了，請學生先留在這一頁
    if (storageBroken()) { track('volatile'); return { status: 'volatile', attemptId: item.attemptId }; }
    track('queued');
    return { status: timedOut ? 'pending' : 'queued', attemptId: item.attemptId };
  }
  if (rejectedItems().some((x) => x.attemptId === item.attemptId)) return { status: 'rejected', attemptId: item.attemptId };
  track('sent');
  return { status: 'sent', attemptId: item.attemptId, result: serverResult(item.attemptId) };
}

export const pendingCount = () => readBox().length;
// 交卷畫面「立即重送」之後要顯示的狀態
export const outboxStatus = () => (pendingCount() ? (storageBroken() ? 'volatile' : 'queued') : 'sent');
export const pendingItems = () => readBox();
export const clearOutbox = () => writeBox([]);
