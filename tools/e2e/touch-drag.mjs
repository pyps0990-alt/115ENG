// 用真的觸控事件（不是滑鼠）拖動選取膠囊：後台下方分頁列、學生底部分頁列（手機上瀏覽器會先把觸控交給按到的連結，滑鼠測不出這種問題）：node tools/e2e/touch-drag.mjs
import { startWorld, sleep } from './harness.mjs';
const world = await startWorld({ scriptLatency: 30 });
const g = world.gas;
const units = [1,2].map(i => ({ id: 'u'+i, title: `L${i}單字`, type: 'vocab', lesson: i, topic: '', visible: true, disabled: [], questionCount: 4, custom: true }));
g.api('saveAllSettings', [[], units]);
const words = ['a1','b2','c3','d4','e5','f6'].map((w) => ({ word: w, pos: 'n.', zh: '字', example: `I [${w}] it.`, exampleZh: '我。' }));
units.forEach((u) => g.api('saveContent', [u.id, { topic: 'T', words }, true]));
const swipe = async (p, x0, y0, x1, y1) => {
  const c = await p.context().newCDPSession(p);
  const pt = (x, y) => [{ x, y, id: 1 }];
  await c.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt(x0, y0) });
  for (let i = 1; i <= 12; i++) { await c.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pt(x0 + (x1 - x0) * i / 12, y0 + (y1 - y0) * i / 12) }); await sleep(16); }
  await c.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
};
let bad = 0;
const ctx = await world.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
// 後台
const t = await world.newPage(ctx, { staff: 'teacher@example.com' });
await t.goto(world.base + '/admin.html#overview'); await t.waitForSelector('#app-root:not([hidden])', { timeout: 15000 }); await sleep(1500);
const a = await t.locator('.rail a[data-view="overview"]').boundingBox(), b = await t.locator('.rail a[data-view="scores"]').boundingBox();
await swipe(t, a.x + a.width / 2, a.y + a.height / 2, b.x + b.width / 2, b.y + b.height / 2);
await sleep(800);
const h1 = await t.evaluate(() => location.hash); console.log('後台觸控拖到成績：', h1); if (h1 !== '#scores') bad++;
await swipe(t, b.x + b.width / 2, b.y + b.height / 2, b.x + b.width / 2 + 10, b.y - 120);
await sleep(800);
const h2 = await t.evaluate(() => location.hash); console.log('後台往上拉後放開（不換頁）：', h2); if (h2 !== '#scores') bad++;
// 打開頭像面板、進到不在分頁列上的頁面（教學）：膠囊不能跑到最左邊
const inkSt = () => t.evaluate(() => { const i = document.querySelector('.lg-ink'), r = document.querySelector('.rail').getBoundingClientRect(), b = i.getBoundingClientRect(), c = document.querySelector('.rail a[aria-current="page"]'); return { op: getComputedStyle(i).opacity, left: Math.round(b.left - r.left), cur: c ? Math.round(c.getBoundingClientRect().left - r.left) : null }; });
await t.tap('#who-btn'); await sleep(700);
let s1 = await inkSt(); console.log('打開頭像：膠囊仍在目前分頁', JSON.stringify(s1)); if (s1.op !== '1' || Math.abs(s1.left - s1.cur) > 3) bad++;
await t.tap('#m-sheet a[href="#help"]'); await sleep(900);
s1 = await inkSt(); console.log('教學頁：膠囊淡出', JSON.stringify(s1)); if (s1.op !== '0') bad++;
await t.tap('.rail a[data-view="units"]'); await sleep(900);
s1 = await inkSt(); console.log('回到單元：膠囊回來', JSON.stringify(s1)); if (s1.op !== '1' || Math.abs(s1.left - s1.cur) > 3) bad++;
// 學生
const p = await world.newPage(ctx, { student: true });
await p.goto(world.base + '/'); await p.waitForSelector('#dock:not([hidden])'); await sleep(800);
const d1 = await p.locator('#dock a[data-dock="home"]').boundingBox(), d2 = await p.locator('#dock a[data-dock="me"]').boundingBox();
await swipe(p, d1.x + d1.width / 2, d1.y + d1.height / 2, d2.x + d2.width / 2, d2.y + d2.height / 2);
await sleep(900);
const h3 = await p.evaluate(() => location.hash); console.log('學生觸控拖到我的成績：', h3); if (h3 !== '#/me') bad++;
const ink = await p.evaluate(() => { const i = document.querySelector('.dock-ink').getBoundingClientRect(), c = document.querySelector('#dock a[aria-current]').getBoundingClientRect(); return Math.abs(i.left - c.left) + Math.abs(i.width - c.width); });
console.log('膠囊對齊目前分頁的誤差：', ink.toFixed(1)); if (ink > 2) bad++;

if (bad) { console.log(bad + ' 項失敗'); process.exit(1); }
console.log('觸控拖動測試通過'); process.exit(0);
