// 成績送出的安全機制：node tools/e2e/submit.mjs
//   1. 伺服器拒收的成績不會靜默消失：記到「被拒收」清單，交卷畫面顯示 rejected
//   2. 這台裝置存不了東西時，成績改放在記憶體照樣送出；還沒送到就顯示 volatile，離開頁面前提醒
import assert from 'node:assert/strict';

const mem = new Map();
let broken = false;
globalThis.localStorage = {
  getItem: (k) => { if (broken) throw new Error('SecurityError'); return mem.has(k) ? mem.get(k) : null; },
  setItem: (k, v) => { if (broken) throw new Error('QuotaExceededError'); mem.set(k, String(v)); },
  removeItem: (k) => mem.delete(k),
  key: (i) => [...mem.keys()][i],
  get length() { return mem.size; },
};
const listeners = {};
const events = [];
globalThis.window = globalThis;
globalThis.addEventListener = (t, fn) => { (listeners[t] ||= []).push(fn); };
globalThis.dispatchEvent = (e) => { events.push(e.type); (listeners[e.type] || []).forEach((fn) => fn(e)); return true; };
globalThis.CustomEvent = class { constructor(type, o = {}) { this.type = type; this.detail = o.detail; } };

let reply = { ok: true };
globalThis.fetch = async (url, opts = {}) => {
  if (String(url).includes('action=check')) return new Response(JSON.stringify({ seen: false }));
  if (opts.method === 'POST') return new Response(JSON.stringify(reply));
  return new Response('{}');
};

const { submitScore, rejectedItems, pendingCount, storageBroken, outboxStatus } = await import('../../js/submit.js');
const { submitStateHTML } = await import('../../js/components/gate.js').catch(() => ({}));
const base = { cls: '301', seat: '12', name: '王小明', unit: 'u1', unitTitle: 'L1 句型練習', score: 8, total: 10, pct: 80 };

// 1. 伺服器拒收
reply = { ok: false, error: '資料不完整' };
let r = await submitScore({ ...base, attemptId: 'rej-1' });
assert.equal(r.status, 'rejected', '拒收要回報 rejected，不能顯示已送出');
assert.equal(pendingCount(), 0, '拒收的成績移出等待清單，不會卡住後面的');
const rej = rejectedItems();
assert.equal(rej.length, 1);
assert.equal(rej[0].attemptId, 'rej-1');
assert.equal(rej[0].reason, '資料不完整');
assert.ok(events.includes('score-rejected'), '要通知畫面');
assert.ok(JSON.parse(mem.get('b5p:rejected')).length === 1, '拒收紀錄存在這台裝置');

// 2a. 裝置存不了東西，但伺服器正常：照樣送出
broken = true;
reply = { ok: true };
r = await submitScore({ ...base, attemptId: 'vol-ok' });
assert.equal(r.status, 'sent', '存不了也要照樣送出');
assert.equal(storageBroken(), true);

// 2b. 裝置存不了東西，伺服器忙：留在記憶體，顯示 volatile，離開前提醒
reply = { busy: true };
r = await submitScore({ ...base, attemptId: 'vol-busy' });
assert.equal(r.status, 'volatile', '還沒送到又存不了：要請學生先留在這一頁');
assert.equal(pendingCount(), 1, '成績還在記憶體的等待清單裡');
assert.equal(outboxStatus(), 'volatile');
let prevented = false;
(listeners.beforeunload || []).forEach((fn) => fn({ preventDefault: () => { prevented = true; } }));
assert.ok(prevented, '有成績只在記憶體時，關閉頁面前要提醒');

// 2c. 伺服器恢復：記憶體裡的成績送出，不再提醒
reply = { ok: true };
const { flushOutbox } = await import('../../js/submit.js');
await flushOutbox();
assert.equal(pendingCount(), 0);
assert.equal(outboxStatus(), 'sent');
prevented = false;
(listeners.beforeunload || []).forEach((fn) => fn({ preventDefault: () => { prevented = true; } }));
assert.ok(!prevented, '都送出後就不用提醒');

if (submitStateHTML) {
  assert.match(submitStateHTML('volatile'), /不要關掉/);
  assert.match(submitStateHTML('rejected'), /截圖/);
  assert.doesNotMatch(submitStateHTML('rejected'), /data-resend/, '拒收的重送也沒用，不放重送按鈕');
}
console.log('成績送出安全機制測試通過');
process.exit(0);
