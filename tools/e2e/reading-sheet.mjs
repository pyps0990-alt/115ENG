// 手機課文測驗：捲到題目時出現「文章」按鈕，按了從下面拉起半頁文章，可以關掉；平板電腦不出現：node tools/e2e/reading-sheet.mjs
import assert from 'node:assert';
import { startWorld, sleep } from './harness.mjs';

const world = await startWorld({ scriptLatency: 40 });
const g = world.gas;
g.api('saveAllSettings', [[], [{ id: 'l1-read', title: 'L1 課文', type: 'reading', lesson: 1, topic: 'Tea', visible: true, disabled: [], questionCount: 4, custom: true }]]);
g.api('saveContent', ['l1-read', { title: 'Tea', topic: 'Tea', passage: ['Tea is a drink made from leaves. '.repeat(12), 'People drink it hot or cold. '.repeat(8)], questions: [0, 1, 2, 3].map((i) => ({ ref: '1-1', skill: '細節', q: `What is tea made from? (${i})`, options: ['Leaves', 'Rocks', 'Milk', 'Sand'], answer: 0, explain: 'x', key: 'made from leaves' })) }, true]);
let bad = 0;
const step = async (n, f) => { try { await f(); console.log('✓', n); } catch (e) { bad++; console.log('✗', n, '\n  ', String(e.message).split('\n')[0]); } };
const open = async (opts) => {
  const p = await world.newPage(await world.newContext(opts), { student: true });
  await p.goto(world.base + '/#/u/l1-read'); await p.waitForSelector('[data-start]'); await sleep(400);
  await p.click('[data-start]'); await p.waitForSelector('.pq'); await sleep(900);
  return p;
};
const p = await open({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
await step('手機：文章在上方時不出現按鈕，捲到題目才出現', async () => {
  await p.evaluate(() => scrollTo(0, 0)); await sleep(400);
  assert.equal(await p.$eval('[data-sheet-open]', (b) => b.hidden), true);
  await p.evaluate(() => document.querySelector('.pq[data-q="3"]').scrollIntoView()); await sleep(500);
  assert.equal(await p.$eval('[data-sheet-open]', (b) => b.hidden), false);
});
await step('手機：按「文章」從下面拉起文章，題目仍在後面；按 ✕ 關掉', async () => {
  await p.tap('[data-sheet-open]'); await p.waitForSelector('dialog.rd-sheet[open] .passage-card'); await sleep(450);
  const r = await p.$eval('dialog.rd-sheet', (d) => { const b = d.getBoundingClientRect(); return { top: b.top, bottom: b.bottom, vh: innerHeight }; });
  assert.ok(r.top > r.vh * 0.2 && Math.abs(r.bottom - r.vh) < 2, '在下半部：' + JSON.stringify(r));
  assert.match(await p.textContent('dialog.rd-sheet'), /Tea is a drink/);
  await p.tap('dialog.rd-sheet .rd-sheet-x'); await sleep(400);
  assert.equal(await p.$$eval('dialog.rd-sheet', (a) => a.length), 0);
  assert.ok(await p.$('.pq[data-q="3"]'), '還在作答');
});
await step('平板、電腦：文章在旁邊，不出現這個按鈕', async () => {
  const d = await open({ viewport: { width: 1280, height: 800 } });
  await d.evaluate(() => document.querySelector('.pq[data-q="3"]').scrollIntoView()); await sleep(400);
  assert.equal(await d.$eval('[data-sheet-open]', (b) => b.checkVisibility()), false);
});
await step('沒有 JS 錯誤', async () => { assert.deepEqual(p.errors, []); });
await world.close();
if (bad) { console.log(bad + ' 項失敗'); process.exit(1); }
console.log('手機課文面板測試通過');
process.exit(0);
