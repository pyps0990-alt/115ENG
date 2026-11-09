// 轉場與流暢度相關的行為：搜尋框開關、點搜尋結果直接換頁、返回首頁回到原本捲到的位置、單元裡換場景（開始測驗、交卷）後畫面正確：node tools/e2e/flow-motion.mjs
import assert from 'node:assert';
import { startWorld, sleep } from './harness.mjs';
const world = await startWorld({ scriptLatency: 60 });
const g = world.gas;
const mk = (id, title, type, lesson) => ({ id, title, type, lesson, topic: 'Topic', visible: true, disabled: [], questionCount: 4, custom: true });
const list = []; for (let l = 1; l <= 6; l++) { list.push(mk(`l${l}-voc`, `L${l} 單字`, 'vocab', l)); list.push(mk(`l${l}-read`, `L${l} 課文`, 'reading', l)); }
g.api('saveAllSettings', [[], list]);
const words = ['apple', 'banana', 'cherry', 'dates', 'egg', 'fig'].map((w) => ({ word: w, pos: 'n.', zh: '字' + w, example: `I [${w}] it.`, exampleZh: '我。' }));
for (let l = 1; l <= 6; l++) {
  g.api('saveContent', [`l${l}-voc`, { topic: 'Food', words }, true]);
  g.api('saveContent', [`l${l}-read`, { title: 'Tea', topic: 'Tea', passage: ['Tea is good for you. '.repeat(10)], questions: [0, 1].map((i) => ({ ref: '1-1', skill: '細節', q: `Q${i}?`, options: ['a', 'b', 'c', 'd'], answer: 0, explain: 'x', key: 'Tea is good' })) }, true]);
}
const ctx = await world.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
const p = await world.newPage(ctx, { student: true });
const errs = []; p.on('pageerror', (e) => errs.push(String(e)));
let bad = 0;
const step = async (n, f) => { try { await f(); console.log('✓', n); } catch (e) { bad++; console.log('✗', n, '\n  ', String(e.message).split('\n')[0]); } };
await p.goto(world.base + '/'); await p.waitForSelector('.unit-tile'); await sleep(1500);

await step('搜尋：打開時按鈕長成搜尋框、B5 讓位；取消後收回、不留下搜尋畫面', async () => {
  await p.tap('[data-search]');
  await p.waitForSelector('dialog.search-sheet[open] .ss-field input');
  assert.ok(await p.evaluate(() => document.body.classList.contains('searching')));
  assert.equal(await p.evaluate(() => document.activeElement && document.activeElement.matches('.ss-field input')), true, '游標在搜尋框');
  await p.tap('.ss-x');
  await p.waitForFunction(() => !document.querySelector('dialog.search-sheet') && !document.body.classList.contains('searching'), null, { timeout: 3000 });
});
await step('搜尋：點結果直接換到單元頁，搜尋畫面一起收掉', async () => {
  await p.tap('[data-search]'); await p.waitForSelector('dialog.search-sheet[open]');
  await p.fill('.ss-field input', 'L4 課文'); await sleep(200);
  assert.equal(await p.$$eval('.ss-row', (a) => a.length), 1);
  await p.tap('.ss-row');
  await p.waitForSelector('[data-start]');
  assert.equal(await p.evaluate(() => location.hash), '#/u/l4-read');
  assert.equal(await p.$$eval('dialog.search-sheet', (a) => a.length), 0);
  assert.equal(await p.evaluate(() => document.body.classList.contains('searching')), false);
});
await step('返回首頁：回到點進單元前捲到的位置', async () => {
  await p.evaluate(() => { location.hash = '#/'; }); await p.waitForSelector('.unit-tile'); await sleep(600);
  await p.evaluate(() => document.querySelector('.unit-tile[data-id="l6-voc"]').scrollIntoView({ block: 'center' })); await sleep(300);
  const y0 = await p.evaluate(() => Math.round(scrollY));
  assert.ok(y0 > 300, '有捲下去');
  await p.tap('.unit-tile[data-id="l6-voc"]'); await p.waitForSelector('[data-start]'); await sleep(400);
  assert.ok(await p.evaluate(() => scrollY) < 5, '單元頁從最上面開始');
  await p.tap('.top-back'); await p.waitForSelector('.unit-tile'); await sleep(700);
  const y1 = await p.evaluate(() => Math.round(scrollY));
  assert.ok(Math.abs(y1 - y0) < 4, `回到原位（${y0} → ${y1}）`);
});
await step('從分頁列換到我的成績：從最上面開始（只有從單元返回才回到原位）', async () => {
  await p.tap('#dock a[data-dock="me"]'); await p.waitForSelector('.me-row'); await sleep(500);
  assert.ok(await p.evaluate(() => scrollY) < 5);
  await p.tap('#dock a[data-dock="home"]'); await p.waitForSelector('.unit-tile'); await sleep(500);
});
await step('換場景：開始測驗 → 作答 → 交卷 → 成績，每一步畫面都正確', async () => {
  await p.evaluate(() => { location.hash = '#/u/l2-read'; }); await p.waitForSelector('[data-start]'); await sleep(500);
  await p.tap('[data-start]'); await p.waitForSelector('.pq');
  assert.equal(await p.$$eval('.gate', (a) => a.length), 0, '開始後關卡畫面消失');
  await p.evaluate(() => document.querySelectorAll('.pq').forEach((q) => q.querySelector('.opt[data-i="0"]').click())); await sleep(300);
  await p.tap('[data-submit-btn]'); await p.waitForSelector('dialog.modal[open]');
  await p.tap('dialog.modal[open] .btn.primary');
  await p.waitForSelector('.result', { timeout: 8000 }); await sleep(1600);
  const n = await p.evaluate(() => (document.querySelector('[data-num]') || {}).textContent);
  assert.equal(n, '100', '分數數字停在最終分數');
});
await step('轉場進行中立刻點選項：點擊不會被吃掉', async () => {
  await p.evaluate(() => { location.hash = '#/u/l3-read'; }); await p.waitForSelector('[data-start]'); await sleep(500);
  await p.tap('[data-start]'); await p.waitForSelector('.pq .opt');
  const b = await p.locator('.pq[data-q="0"] .opt[data-i="2"]').boundingBox();
  await p.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2); // 不等轉場結束
  await sleep(400);
  const i = await p.evaluate(() => [...document.querySelectorAll('.pq[data-q="0"] .opt')].findIndex((o) => o.classList.contains('selected')));
  assert.equal(i, 2);
});
await step('沒有 JS 錯誤', async () => { assert.equal(errs.length, 0, errs.join('\n')); });
await world.close?.();
if (bad) { console.log(bad + ' 項失敗'); process.exit(1); }
console.log('轉場與流暢度測試通過');
process.exit(0);
