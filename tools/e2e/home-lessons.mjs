// 首頁課次多時：上方課次快速跳轉（完成的打勾）；全部完成的課收合、點標題展開：node tools/e2e/home-lessons.mjs
import assert from 'node:assert';
import { startWorld, sleep } from './harness.mjs';

const world = await startWorld({ scriptLatency: 40 });
const g = world.gas;
const list = [];
for (let l = 1; l <= 5; l++) list.push({ id: `l${l}-voc`, title: `L${l} 單字`, type: 'vocab', lesson: l, topic: 'T', visible: true, disabled: [], questionCount: 4, custom: true });
g.api('saveAllSettings', [[], list]);
const words = ['apple', 'banana', 'cherry', 'dates', 'egg', 'fig'].map((w) => ({ word: w, pos: 'n.', zh: '字' + w, example: `I [${w}] it.`, exampleZh: '我。' }));
for (const u of list) g.api('saveContent', [u.id, { topic: 'Food', words }, true]);
const ctx = await world.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
const p = await world.newPage(ctx, { student: true });
await p.addInitScript(() => { // 第 1 課做完而且檢討過；第 2 課做完還沒檢討
  window.__fb = window.__fb || {};
  window.__fb.attempts = [
    { unit: 'l1-voc', mode: 'vocab', pct: 92, clientTs: '2026-09-30 10:00:00', review: false, details: [], createdAt: { toMillis: () => Date.now() } },
    { unit: 'l2-voc', mode: 'vocab', pct: 80, clientTs: '2026-09-30 10:05:00', review: false, details: [], createdAt: { toMillis: () => Date.now() } },
  ];
  window.__fb.reviews = [{ id: 'l1-voc', at: { toMillis: () => Date.now() } }];
});
await p.goto(world.base + '/'); await p.waitForSelector('.unit-tile'); await sleep(2500);
let bad = 0;
const step = async (n, f) => { try { await f(); console.log('✓', n); } catch (e) { bad++; console.log('✗', n, '\n  ', String(e.message).split('\n')[0]); } };

await step('課次快速跳轉：每一課一個，全部完成的打勾', async () => {
  assert.deepEqual(await p.$$eval('.lesson-jump [data-jump]', (a) => a.map((b) => b.textContent.trim())), ['L1', 'L2', 'L3', 'L4', 'L5']);
  assert.deepEqual(await p.$$eval('.lesson-jump .done', (a) => a.map((b) => b.dataset.jump)), ['1']);
});
await step('全部完成的課收合（標題還在、卡片藏起來），還沒完成的照常展開', async () => {
  assert.equal(await p.$$eval('details.lesson-done', (a) => a.length), 1);
  assert.equal(await p.$eval('details.lesson-done', (d) => d.open), false);
  assert.equal(await p.$eval('.unit-tile[data-id="l1-voc"]', (t) => t.checkVisibility()), false, '第 1 課的卡片藏起來');
  assert.ok(await p.$eval('.unit-tile[data-id="l2-voc"]', (t) => t.getBoundingClientRect().height) > 50, '第 2 課（待檢討）照常顯示');
});
await step('點收合的標題展開', async () => {
  await p.tap('details.lesson-done > summary'); await sleep(200);
  assert.ok(await p.$eval('.unit-tile[data-id="l1-voc"]', (t) => t.getBoundingClientRect().height) > 50);
});
await step('點課次跳到那一課（標題在導覽列下方）', async () => {
  await p.tap('.lesson-jump [data-jump="5"]'); await sleep(1200);
  const r = await p.evaluate(() => { const h = document.querySelector('[data-lesson="5"]').getBoundingClientRect(); const bar = document.querySelector('.topbar').getBoundingClientRect(); return { top: Math.round(h.top), bar: Math.round(bar.bottom), sy: Math.round(scrollY), max: Math.round(document.documentElement.scrollHeight - innerHeight) }; });
  assert.ok(r.top >= r.bar - 2 && (r.top < r.bar + 40 || r.sy >= r.max - 2), JSON.stringify(r));
});
await step('沒有 JS 錯誤', async () => { assert.deepEqual(p.errors, []); });
await world.close();
if (bad) { console.log(bad + ' 項失敗'); process.exit(1); }
console.log('首頁課次測試通過');
process.exit(0);
