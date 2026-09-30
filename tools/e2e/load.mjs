// 40 位學生同時交卷的壓力模擬：node tools/e2e/load.mjs [人數] [每筆寫入秒數]
// 模擬 Apps Script 的限制：同一時間只有一筆能寫入試算表（每筆佔用 SERVICE 毫秒）、鎖最多等 30 秒、同時執行數上限 30。
// 每位學生是獨立的瀏覽器環境，使用真正的 js/submit.js（重試、退避、確認機制）。
import assert from 'node:assert';
import { startWorld, sleep } from './harness.mjs';

const N = Number(process.argv[2] || 40);
const SERVICE = Number(process.argv[3] || 1.0) * 1000;
const world = await startWorld({ scriptLatency: 0 });
const g = world.gas;
g.api('saveAllSettings', [[], [{ id: 'r1', title: 'R', type: 'reading', lesson: 1, topic: '', visible: true, disabled: [], questionCount: 5, custom: true }]]);
g.api('saveContent', ['r1', { title: 'T', topic: 't', passage: ['Tea is good.'], questions: [{ skill: '細節', q: 'Q1?', options: ['a', 'b'], answer: 0, explain: 'x' }] }, true]);

// ---- 假的 Apps Script：排隊、鎖逾時、同時執行上限
let inflight = 0;
let lockQueue = Promise.resolve();
const stats = { requests: 0, busy: 0, overloaded: 0, written: 0, duplicates: 0 };
world.scriptOverride = async (route, req, cors) => {
  const ok = (obj) => route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify(obj) });
  stats.requests++;
  if (req.method() === 'GET') { await sleep(150); return ok(g.get(Object.fromEntries(new URL(req.url()).searchParams))); }
  if (inflight >= 30) { stats.overloaded++; return route.fulfill({ status: 200, headers: cors, contentType: 'text/html', body: '<html>Service invoked too many times in a short time</html>' }); }
  inflight++;
  try {
    await sleep(300); // 冷啟動與網路
    const t0 = Date.now();
    // 排隊等鎖，最多等 30 秒
    const turn = lockQueue;
    let release;
    lockQueue = new Promise((r) => { release = r; });
    const waited = await Promise.race([turn.then(() => true), sleep(30000).then(() => false)]);
    if (!waited) { stats.busy++; release(); return ok({ ok: false, busy: true, error: 'busy' }); }
    await sleep(SERVICE);
    const out = g.post(req.postData() || '{}');
    if (out.duplicate) stats.duplicates++; else if (out.ok) stats.written++;
    release();
    return ok(out);
  } finally { inflight--; }
};

const t0 = Date.now();
const done = [];
const contexts = await Promise.all(Array.from({ length: N }, () => world.newContext({ viewport: { width: 360, height: 640 } })));
await Promise.all(contexts.map(async (ctx, i) => {
  const p = await ctx.newPage();
  await p.goto(world.base + '/data/config.default.json');
  await p.evaluate(() => { localStorage.setItem('b5p:student', JSON.stringify({ cls: '306', seat: 'x', name: 'x', key: 'k' })); });
  const tStart = Date.now();
  const res = await p.evaluate(async ([i]) => {
    const { submitScore, pendingCount } = await import('/js/submit.js');
    const r = await submitScore({ clientTs: '2026-10-01 10:00:00', cls: '306', seat: String(i + 1), name: '學生' + i, unit: 'r1', unitTitle: 'R', mode: 'reading', score: 1, total: 1, pct: 100, durationSec: 30, details: [{ n: 1, correct: 'A. a', yours: 'A. a', ok: true, points: 1 }] });
    return { status: r.status, pending: pendingCount() };
  }, [i]);
  // 畫面上先放行（最多 5 秒）；沒送成的會在背景繼續，等它送完
  const shown = Date.now() - tStart;
  for (let k = 0; k < 240 && (await p.evaluate(() => JSON.parse(localStorage.getItem('b5p:outbox') || '[]').length)); k++) await sleep(500);
  done.push({ i, status: res.status, shownMs: shown, doneMs: Date.now() - tStart });
}));
const total = Date.now() - t0;
const rows = g.sheets.get('scores').getLastRow() - 1;
const ids = new Set(g.sheets.get('scores').rows.slice(1).map((r) => r[17]));
const sortedDone = done.map((d) => d.doneMs).sort((a, b) => a - b);
const pct = (q) => Math.round(sortedDone[Math.floor((sortedDone.length - 1) * q)] / 1000);
console.log(`人數 ${N}，每筆寫入 ${SERVICE / 1000}s`);
console.log(`全部送達：${Math.round(total / 1000)} 秒；中位數 ${pct(0.5)}s、90% ${pct(0.9)}s、最慢 ${pct(1)}s`);
console.log(`交卷畫面先放行（排隊中）的人：${done.filter((d) => d.status !== 'sent').length}；伺服器回忙碌 ${stats.busy} 次、過載 ${stats.overloaded} 次；請求 ${stats.requests}`);
console.log(`試算表列數 ${rows}，不重複的成績 ${ids.size}`);
assert.equal(rows, N, '每位學生的成績都要寫入，而且只寫一次');
assert.equal(ids.size, N);
console.log('✓ 全部成績都送達，沒有遺失也沒有重複');
await world.close();
