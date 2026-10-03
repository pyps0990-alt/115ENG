// 全班同時交卷的壓力模擬：node tools/e2e/load.mjs [人數] [收件秒數] [整理一批的固定秒數]
// 模擬 Apps Script 的限制：同時執行數上限 30（超過回錯誤頁）、整理成績同一時間只有一個（拿不到鎖就跳過）。
// 伺服器流程跟 Code.gs 的 doPost 一樣：收件（寫一列到 inbox）→ 拿得到鎖就整理（一批一批寫進各分頁，最多 DRAIN_BUDGET_MS）。
// 每位學生是獨立的瀏覽器環境，使用真正的 js/submit.js（重試、退避、確認機制）。
import assert from 'node:assert';
import { startWorld, sleep } from './harness.mjs';
import { keyOf } from './gas-mock.mjs';

const N = Number(process.argv[2] || 40);
const RECEIVE = Number(process.argv[3] || 0.8) * 1000;    // 收件：核對、查重、寫一列到 inbox
const DRAIN_FIXED = Number(process.argv[4] || 4) * 1000; // 整理一批的固定成本（讀 inbox、查重、寫 4 個分頁、刪 inbox）
const DRAIN_PER_ROW = 60;                                // 每多一筆的成本（成績單逐格寫入）
const world = await startWorld({ scriptLatency: 0 });
const g = world.gas;
g.api('saveAllSettings', [[], [{ id: 'r1', title: 'R', type: 'reading', lesson: 1, topic: '', visible: true, disabled: [], questionCount: 5, custom: true }]]);
g.api('saveContent', ['r1', { title: 'T', topic: 't', passage: ['Tea is good.'], questions: [{ ref: '1-1', skill: '細節', q: 'Q1?', options: ['a', 'b'], answer: 0, explain: 'x' }] }, true]);
const budget = g.ctx.DRAIN_BUDGET_MS;
const inboxRows = () => { const s = g.sheets.get('inbox'); return s ? s.getLastRow() - 1 : 0; };

let inflight = 0;
let draining = false;
const stats = { requests: 0, busy: 0, overloaded: 0, drains: 0, longest: 0, maxBatch: 0 };
async function drainLikeServer() {
  if (draining) return; // tryLock(0) 失敗：別人正在整理
  draining = true;
  try {
    const until = Date.now() + budget;
    let n;
    do {
      n = Math.min(inboxRows(), g.ctx.DRAIN_MAX_ROWS);
      if (!n) break;
      stats.maxBatch = Math.max(stats.maxBatch, n);
      await sleep(DRAIN_FIXED + n * DRAIN_PER_ROW);
      g.ctx.drainBatch_(n); // 只整理開始時讀到的那幾列（整理期間新進來的留給下一批）
      stats.drains++;
    } while (Date.now() < until);
  } finally { draining = false; }
}
world.scriptOverride = async (route, req, cors) => {
  const ok = (obj) => route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify(obj) });
  stats.requests++;
  if (req.method() === 'GET') { await sleep(150); return ok(g.get(Object.fromEntries(new URL(req.url()).searchParams))); }
  if (inflight >= 30) { stats.overloaded++; return route.fulfill({ status: 200, headers: cors, contentType: 'text/html', body: '<html>Service invoked too many times in a short time</html>' }); }
  inflight++;
  const t0 = Date.now();
  try {
    await sleep(300); // 冷啟動與網路
    await sleep(RECEIVE);
    const out = g.ctx.receiveScore_(JSON.parse(req.postData() || '{}'));
    if (out.busy) stats.busy++;
    if (out.ok && !out.duplicate) await drainLikeServer();
    return ok(out);
  } finally { inflight--; stats.longest = Math.max(stats.longest, Date.now() - t0); }
};

const t0 = Date.now();
const done = [];
const contexts = await Promise.all(Array.from({ length: N }, () => world.newContext({ viewport: { width: 360, height: 640 } })));
await Promise.all(contexts.map(async (ctx, i) => {
  const p = await ctx.newPage();
  await p.goto(world.base + '/data/config.default.json');
  await p.evaluate((st) => { localStorage.setItem('b5p:student', JSON.stringify(st)); }, { cls: '306', seat: String(i + 1), name: '學生' + i, key: keyOf('306', String(i + 1), '學生' + i) });
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
while (draining) await sleep(200);
const left = inboxRows();
const scoreRows = () => g.sheets.get('scores').rows.slice(1).filter((r) => r[17]);
const before = scoreRows().length;
// 老師打開後台成績：先整理剩下的
g.api('getScores', [{}]);
const rows = scoreRows();
const ids = new Set(rows.map((r) => r[17]));
const sorted = done.map((d) => d.doneMs).sort((a, b) => a - b);
const pct = (q) => (sorted[Math.floor((sorted.length - 1) * q)] / 1000).toFixed(1);
console.log(`人數 ${N}；模擬：收件 ${RECEIVE / 1000}s、整理一批 ${DRAIN_FIXED / 1000}s + 每筆 ${DRAIN_PER_ROW}ms、同時執行上限 30`);
console.log(`學生端確認送達：全部 ${Math.round(total / 1000)} 秒；中位數 ${pct(0.5)}s、90% ${pct(0.9)}s、最慢 ${pct(1)}s`);
console.log(`交卷畫面先放行（排隊中）的人：${done.filter((d) => d.status !== 'sent').length}；伺服器回忙碌 ${stats.busy} 次、過載 ${stats.overloaded} 次；請求 ${stats.requests}`);
console.log(`整理 ${stats.drains} 批（最大一批 ${stats.maxBatch} 筆）；最長的一個請求 ${(stats.longest / 1000).toFixed(1)}s`);
console.log(`學生都確認後：已寫進 scores ${before} 筆、inbox 剩 ${left} 筆；老師打開成績後 scores ${rows.length} 筆（不重複 ${ids.size}）`);
assert.equal(done.filter((d) => d.doneMs > 60000).length, 0, '每位學生都要在 1 分鐘內確認送達');
assert.equal(rows.length, N, '每位學生的成績都要寫入，而且只寫一次');
assert.equal(ids.size, N);
assert.ok(stats.longest < 45000, '單一請求不能超過學生端的 45 秒逾時');
console.log('✓ 全部成績都送達，沒有遺失也沒有重複');
await world.close();
