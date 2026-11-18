// 主畫面 App（全螢幕）的右滑返回：內容跟手、導覽列與底部分頁列不動；滑夠遠回上一頁、不夠遠彈回；作答中與一般瀏覽器不啟用：node tools/e2e/edge-back.mjs
import assert from 'node:assert';
import { startWorld, sleep } from './harness.mjs';

const world = await startWorld({ scriptLatency: 40 });
const g = world.gas;
g.api('saveAllSettings', [[], ['l1-voc'].map((id, i) => ({ id, title: `L${i + 1} 單字`, type: 'vocab', lesson: i + 1, topic: 'T', visible: true, disabled: [], questionCount: 4, custom: true }))]);
const words = ['apple', 'banana', 'cherry', 'dates', 'egg', 'fig'].map((w) => ({ word: w, pos: 'n.', zh: '字' + w, example: `I [${w}] it.`, exampleZh: '我。' }));
g.api('saveContent', ['l1-voc', { topic: 'Food', words }, true]);
const phone = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true };
let bad = 0;
const step = async (n, f) => { try { await f(); console.log('✓', n); } catch (e) { bad++; console.log('✗', n, '\n  ', String(e.message).split('\n')[0]); } };

const open = async (standalone) => {
  const ctx = await world.newContext(phone);
  if (standalone) await ctx.addInitScript(() => { window.__standalone = true; });
  const p = await world.newPage(ctx, { student: true });
  await p.goto(world.base + '/'); await p.waitForSelector('.unit-tile'); await sleep(600);
  await p.tap('.unit-tile[data-id="l1-voc"]'); await p.waitForSelector('[data-start]'); await sleep(700);
  p.cdp = await ctx.newCDPSession(p);
  return p;
};
// 從 (x0, y) 用手指往右拖到 x1；hold=true 時停在最後不放開
const swipe = async (p, x0, x1, { y = 420, steps = 10, ms = 16, hold = false } = {}) => {
  const t = (type, x) => p.cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
  await t('touchStart', x0);
  for (let i = 1; i <= steps; i++) { await t('touchMove', x0 + ((x1 - x0) * i) / steps); await sleep(ms); }
  if (!hold) await t('touchEnd', x1);
};
const state = (p) => p.evaluate(() => {
  const app = document.getElementById('app'), dock = document.getElementById('dock'), top = document.querySelector('.topbar');
  return { left: app.getBoundingClientRect().left, hash: location.hash, dockHidden: dock.hidden, dockOp: getComputedStyle(dock).opacity, dockMid: (() => { const r = dock.getBoundingClientRect(); return Math.round((r.left + r.right) / 2); })(), topLeft: top.getBoundingClientRect().left, sx: document.documentElement.scrollWidth };
});

const p = await open(true);
await step('拖一小段：內容跟著手指往右，上方導覽列不動，底部分頁列在原位浮現、不跟著移動', async () => {
  await swipe(p, 8, 108, { hold: true }); await sleep(80);
  const s = await state(p);
  assert.ok(Math.abs(s.left - 100) < 20, '內容往右 ' + s.left);
  assert.equal(s.topLeft, 0, '導覽列不動');
  assert.equal(s.dockHidden, false, '分頁列出現');
  assert.ok(+s.dockOp > 0 && +s.dockOp < 1, '分頁列邊滑邊浮現 ' + s.dockOp);
  assert.ok(Math.abs(s.dockMid - 195) < 2, '分頁列不跟著移動 ' + s.dockMid);
  assert.ok(s.sx <= 390, '畫面不能左右捲動 ' + s.sx);
  await p.cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await sleep(500);
});
await step('滑不夠遠（慢慢放開）：彈回原位，還在單元頁，分頁列收起', async () => {
  const s = await state(p);
  assert.match(s.hash, /#\/u\/l1-voc/);
  assert.equal(s.left, 0); assert.equal(s.dockHidden, true);
  assert.ok(await p.$('[data-start]'));
});
await step('滑過三分之一：回到首頁（不再做第二次換頁轉場），內容回到原位、分頁列完整顯示', async () => {
  await p.evaluate(() => { window.__vt = 0; const o = document.startViewTransition.bind(document); document.startViewTransition = (cb) => { window.__vt++; return o(cb); }; });
  await swipe(p, 8, 220, { steps: 14, ms: 30 }); await p.waitForSelector('.unit-tile'); await sleep(600);
  const s = await state(p);
  assert.equal(s.left, 0, '內容回到原位');
  assert.equal(s.dockHidden, false); assert.equal(s.dockOp, '1');
  assert.equal(await p.evaluate(() => window.__vt), 0, '沒有再做轉場');
  assert.equal(await p.evaluate(() => getComputedStyle(document.getElementById('app')).visibility), 'visible');
});
await step('甩得快（距離短）也回上一頁', async () => {
  await p.tap('.unit-tile[data-id="l1-voc"]'); await p.waitForSelector('[data-start]'); await sleep(700);
  // 在頁面裡同一格連續送出觸控事件（電腦忙的時候 CDP 一個一個送會變慢，就不像「甩」了）
  await p.evaluate(() => {
    const fire = (type, x) => { const t = new Touch({ identifier: 1, target: document.body, clientX: x, clientY: 420 }); document.body.dispatchEvent(new TouchEvent(type, { bubbles: true, cancelable: true, touches: type === 'touchend' ? [] : [t], changedTouches: [t] })); };
    fire('touchstart', 8); for (const x of [30, 55, 80, 108]) fire('touchmove', x); fire('touchend', 108);
  });
  await p.waitForSelector('.unit-tile'); await sleep(500);
  assert.equal((await state(p)).left, 0);
});
await step('不是從左邊緣開始、或是直的滑：不啟用', async () => {
  await p.tap('.unit-tile[data-id="l1-voc"]'); await p.waitForSelector('[data-start]'); await sleep(700);
  await swipe(p, 80, 300, { hold: true }); await sleep(60);
  assert.equal((await state(p)).left, 0, '從中間滑');
  await p.cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await swipe(p, 8, 14, { y: 420, hold: true }); await sleep(30);
  await p.cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await sleep(400);
  assert.match((await state(p)).hash, /#\/u\/l1-voc/);
});
await step('作答中：不啟用（不會不小心離開測驗）', async () => {
  await p.tap('[data-start]'); await p.waitForSelector('.q-card'); await sleep(400);
  await swipe(p, 8, 260, { steps: 14, ms: 30 }); await sleep(600);
  assert.equal((await state(p)).left, 0);
  assert.ok(await p.$('.q-card'), '還在作答');
  assert.equal(await p.$$eval('dialog.modal[open]', (a) => a.length), 0);
});
await step('一般瀏覽器（不是加到主畫面）：交給 Safari 自己的滑動返回，B5 不動', async () => {
  const q = await open(false);
  await swipe(q, 8, 260, { steps: 14, ms: 30 }); await sleep(600);
  const s = await state(q);
  assert.equal(s.left, 0); assert.match(s.hash, /#\/u\/l1-voc/);
});
await step('沒有 JS 錯誤', async () => { assert.deepEqual(p.errors, []); });
await world.close();
if (bad) { console.log(bad + ' 項失敗'); process.exit(1); }
console.log('右滑返回測試通過');
process.exit(0);
