// 交卷的路線：node tools/e2e/submit-route.mjs
//   先送伺服器計分（SUBMIT_URL）：收到就算送出，不再送 Apps Script（由伺服器轉送試算表）；伺服器拒收就是拒收，不改走備援
//   伺服器連不上：先確認它是不是其實收到了；連續 3 次連不上才改送 Apps Script 備援
import assert from 'node:assert/strict';

const mem = new Map();
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k), key: (i) => [...mem.keys()][i], get length() { return mem.size; } };
globalThis.window = globalThis;
globalThis.addEventListener = () => {};
globalThis.dispatchEvent = () => true;
globalThis.CustomEvent = class { constructor(type, o = {}) { this.type = type; this.detail = o.detail; } };

const calls = [];
let fn = 'ok'; // ok | reject | down | busy
let seen = false;
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  const isFn = u.includes('cloudfunctions.net');
  calls.push(`${isFn ? 'fn' : 'gas'}:${opts.method || 'GET'}${u.includes('check=') ? ':check' : ''}`);
  if (isFn) {
    if (fn === 'down') throw new TypeError('Failed to fetch');
    if (u.includes('check=')) return new Response(JSON.stringify({ ok: true, seen }));
    if (fn === 'reject') return new Response(JSON.stringify({ ok: false, error: '不在名單上' }), { status: 403 });
    if (fn === 'busy') return new Response(JSON.stringify({ ok: false, busy: true }), { status: 429 });
    return new Response(JSON.stringify({ ok: true, score: 3, total: 4, pct: 75 }));
  }
  if (opts.method === 'POST') { globalThis.__gasBody = JSON.parse(opts.body); return new Response(JSON.stringify({ ok: true })); }
  return new Response(JSON.stringify({ seen: false }));
};
const S = await import('../../js/submit.js');
const base = { cls: '301', seat: '12', name: '王小明', key: 'k'.repeat(64), unit: 'u1', unitTitle: 'L1', score: 4, total: 4, pct: 100, mode: 'reading' };
const box = () => JSON.parse(mem.get('b5p:outbox') || '[]');

// 1. 伺服器收到：只送伺服器
calls.length = 0;
let r = await S.submitScore({ ...base, attemptId: 'route-ok' });
assert.equal(r.status, 'sent');
assert.deepEqual(calls, ['fn:POST'], '只送伺服器計分，不直接送 Apps Script');
assert.equal(box().length, 0);

// 2. 伺服器拒收：記到被拒收清單，不改走備援
fn = 'reject'; calls.length = 0;
r = await S.submitScore({ ...base, attemptId: 'route-rej' });
assert.equal(r.status, 'rejected');
assert.ok(!calls.some((c) => c.startsWith('gas')), '拒收不改送 Apps Script');

// 3. 伺服器忙：留在清單稍後重送，不改走備援
fn = 'busy'; calls.length = 0;
r = await S.submitScore({ ...base, attemptId: 'route-busy' });
assert.ok(['queued', 'pending'].includes(r.status));
assert.ok(!calls.some((c) => c.startsWith('gas')));
S.clearOutbox();

// 4. 連不上但其實收到了：算送出
fn = 'down'; seen = true; calls.length = 0;
globalThis.fetch = ((orig) => async (url, opts = {}) => (String(url).includes('check=') && String(url).includes('cloudfunctions') ? new Response(JSON.stringify({ ok: true, seen: true })) : orig(url, opts)))(globalThis.fetch);
r = await S.submitScore({ ...base, attemptId: 'route-seen' });
assert.equal(r.status, 'sent', '確認伺服器已經收到');

// 5. 連續連不上：第 3 次才改送 Apps Script
seen = false; calls.length = 0;
S.clearOutbox();
const fetch2 = globalThis.fetch;
globalThis.fetch = async (url, opts = {}) => { if (String(url).includes('cloudfunctions')) { calls.push('fn:down'); throw new TypeError('Failed to fetch'); } return fetch2(url, opts); };
r = await S.submitScore({ ...base, attemptId: 'route-down' });
assert.ok(['queued', 'pending'].includes(r.status), '第 1 次連不上：排隊');
assert.ok(!calls.some((c) => c.startsWith('gas')));
await S.flushOutbox();
assert.equal(box().length, 1, '第 2 次還是排隊');
await S.flushOutbox();
assert.equal(box().length, 0, '第 3 次改送 Apps Script 成功');
assert.ok(calls.some((c) => c === 'gas:POST'));
assert.equal(globalThis.__gasBody.fnFails, undefined, '送 Apps Script 的資料不帶內部計數');
console.log('交卷路線測試通過');
process.exit(0);
