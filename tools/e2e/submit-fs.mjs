// 成績先送 Firestore（SCORE_TRANSPORT）：node tools/e2e/submit-fs.mjs
//   firestore：Firestore 馬上確認就不走 Apps Script；被拒或 5 秒沒確認改走 Apps Script 備援；之後 Firestore 送到了就從待送清單拿掉並通知
//   both：Apps Script 還沒確認但 Firestore 確認了，也算送出（仍在清單繼續送試算表）
// 用 Node 的模組載入勾子把 submit.js 用到的 ./firebase.js、./config.js 換成假的（不需要瀏覽器、不連網路）
import assert from 'node:assert/strict';
import { register } from 'node:module';

const hooks = `
export async function resolve(spec, ctx, next) {
  const parent = ctx.parentURL || '';
  if (parent.includes('/js/submit.js') && spec === './firebase.js') return { url: 'data:text/javascript,export const saveScoreToFirestore = (item) => globalThis.__fs(item);', shortCircuit: true };
  if (parent.includes('/js/submit.js') && spec === './config.js') {
    const mode = new URL(parent).searchParams.get('mode') || 'both';
    return { url: 'data:text/javascript,' + encodeURIComponent("export const SCRIPT_URL = 'https://script.example/exec'; export const SCORE_TRANSPORT = '" + mode + "';"), shortCircuit: true };
  }
  if (parent.includes('/js/submit.js') && spec === './presence.js') return { url: 'data:text/javascript,export const track = (f) => (globalThis.__tracked ||= []).push(f);', shortCircuit: true };
  return next(spec, ctx);
}`;
register('data:text/javascript,' + encodeURIComponent(hooks));

const mem = new Map();
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k), key: (i) => [...mem.keys()][i], get length() { return mem.size; } };
const events = [];
globalThis.window = globalThis;
globalThis.addEventListener = () => {};
globalThis.dispatchEvent = (e) => { events.push(e.type); return true; };
globalThis.CustomEvent = class { constructor(type, o = {}) { this.type = type; this.detail = o.detail; } };
let posts = 0;
let reply = { ok: true };
globalThis.fetch = async (url, opts = {}) => {
  if (String(url).includes('action=check')) return new Response(JSON.stringify({ seen: false }));
  if (opts.method === 'POST') { posts++; return new Response(JSON.stringify(reply)); }
  return new Response('{}');
};
const base = { cls: '301', seat: '12', name: '王小明', unit: 'u1', unitTitle: 'L1', score: 8, total: 10, pct: 80 };
const box = () => JSON.parse(mem.get('b5p:outbox') || '[]');
const tracked = () => globalThis.__tracked || [];

// ---------- firestore ----------
const F = await import('../../js/submit.js?mode=firestore');
// 1. Firestore 馬上確認：不走 Apps Script
globalThis.__fs = async () => 'ok';
posts = 0;
let r = await F.submitScore({ ...base, attemptId: 'f-ok' });
assert.equal(r.status, 'sent');
assert.equal(posts, 0, 'Firestore 確認了就不用送 Apps Script');
assert.equal(box().length, 0);

// 2. Firestore 拒絕：改走 Apps Script 備援
globalThis.__fs = async () => 'denied';
reply = { ok: true };
r = await F.submitScore({ ...base, attemptId: 'f-denied' });
assert.equal(r.status, 'sent');
assert.equal(posts, 1, '被拒就改送 Apps Script');

// 3. Firestore 5 秒沒確認（離線）、Apps Script 也忙：排隊；之後 Firestore 送到了就從清單拿掉並通知
let resolveFs;
globalThis.__fs = () => new Promise((res) => { resolveFs = res; });
reply = { busy: true };
const t0 = Date.now();
r = await F.submitScore({ ...base, attemptId: 'f-late' });
assert.ok(Date.now() - t0 >= 4900, '先等 Firestore 5 秒');
assert.ok(['queued', 'pending'].includes(r.status), `排隊中（${r.status}）`);
assert.ok(box().some((x) => x.attemptId === 'f-late'), '留在 Apps Script 待送清單當備援');
resolveFs('ok');
await new Promise((res) => setTimeout(res, 50));
assert.ok(!box().some((x) => x.attemptId === 'f-late'), 'Firestore 送到後從待送清單拿掉');
assert.ok(events.includes('score-sent'), '通知已送出');
assert.ok(tracked().includes('late'));

// ---------- both ----------
mem.clear();
const B = await import('../../js/submit.js?mode=both');
// 4. Apps Script 忙、Firestore 確認：算送出，仍留在清單繼續送試算表
globalThis.__fs = async () => 'ok';
reply = { busy: true };
r = await B.submitScore({ ...base, attemptId: 'b-fs' });
assert.equal(r.status, 'sent', 'Firestore 確認了就算送出');
assert.ok(box().some((x) => x.attemptId === 'b-fs'), 'both 模式仍繼續送 Apps Script');
// 5. 兩邊都正常
reply = { ok: true };
mem.clear();
r = await B.submitScore({ ...base, attemptId: 'b-ok' });
assert.equal(r.status, 'sent');
assert.equal(box().length, 0);

console.log('成績先送 Firestore 測試通過');
process.exit(0);
