// 動畫：首頁卡片 ↔ 單元頁轉場（View Transitions）、成績畫面浮現；轉場後頁面正常、沒有錯誤
import assert from 'node:assert';
import { startWorld, sleep } from './harness.mjs';
const out = process.argv[2] || '/tmp/shots';
const world = await startWorld({ scriptLatency: 100 });
const g = world.gas;
g.api('saveAllSettings', [[], [{ id: 'l2-pat', title: 'L2 句型練習', type: 'pattern', lesson: 2, topic: '', visible: true, disabled: [], questionCount: 10, custom: true }]]);
g.api('saveContent', ['l2-pat', { topic: 't', items: [{ type: 'mc', tag: 'x', q: 'A ____ b', options: ['a', 'b', 'c', 'd'], answer: 0, explain: 'e' }] }, true]);
const ctx = await world.newContext({ viewport: { width: 390, height: 844 } });
await ctx.addInitScript(() => {
  window.__vt = 0;
  const orig = document.startViewTransition && document.startViewTransition.bind(document);
  if (orig) document.startViewTransition = (cb) => { window.__vt++; return orig(cb); };
});
const p = await world.newPage(ctx, { student: true });
await p.goto(world.base + '/'); await p.waitForSelector('.unit-tile');
await p.click('.unit-tile'); await sleep(160);
await p.screenshot({ path: `${out}/motion-mid.png` });
await p.waitForSelector('.unit-head h1'); await p.waitForSelector('[data-start]');
assert.equal(await p.evaluate(() => window.__vt), 1, '進入單元要用卡片轉場');
assert.equal(await p.locator('.unit-head.shell').count(), 0, '載入完成後換成正式標題');
await p.click('.back'); await p.waitForSelector('.unit-tile');
assert.equal(await p.evaluate(() => window.__vt), 2, '返回要用卡片轉場');
await sleep(600);
assert.equal(await p.evaluate(() => document.querySelectorAll('[style*="view-transition-name"]').length), 0, '轉場結束後要清掉 view-transition-name');
// 成績畫面
await p.click('.unit-tile'); await p.waitForSelector('[data-start]'); await p.click('[data-start]');
await p.waitForSelector('.opt'); await p.locator('.opt').first().click();
await sleep(200);
await p.screenshot({ path: `${out}/motion-correct.png` });
await p.locator('[data-next]:not([hidden])').click(); await p.waitForSelector('.result.pass');
await sleep(1400);
await p.screenshot({ path: `${out}/motion-result.png` });
const bad = p.errors.filter((e) => !/favicon/.test(e));
assert.equal(bad.length, 0, bad.join('\n'));
console.log('動畫測試通過');
await world.close();
