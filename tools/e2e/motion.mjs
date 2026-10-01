// 動畫：首頁卡片 ↔ 單元頁轉場（View Transitions）、成績畫面浮現；轉場後頁面正常、沒有錯誤
import assert from 'node:assert';
import { startWorld, sleep } from './harness.mjs';
const out = process.argv[2] || '/tmp/shots';
const world = await startWorld({ scriptLatency: 100 });
const g = world.gas;
g.api('saveAllSettings', [[], [{ id: 'l2-pat', title: 'L2 句型練習', type: 'pattern', lesson: 2, topic: '', visible: true, disabled: [], questionCount: 10, custom: true }]]);
g.api('saveContent', ['l2-pat', { topic: 't', items: [{ type: 'mc', tag: 'x', q: 'A ____ b', options: ['a', 'b', 'c', 'd'], answer: 0, explain: 'e' }] }, true]);
g.api('saveAllSettings', [[], [
  { id: 'l2-pat', title: 'L2 句型練習', type: 'pattern', lesson: 2, topic: '', visible: true, disabled: [], questionCount: 10, custom: true },
  { id: 'l3-pat', title: 'L3 句型練習', type: 'pattern', lesson: 3, topic: '', visible: true, disabled: [], questionCount: 10, custom: true },
]]);
g.api('saveContent', ['l2-pat', { topic: 't', items: [{ type: 'mc', tag: 'x', q: 'A ____ b', options: ['a', 'b', 'c', 'd'], answer: 0, explain: 'e' }] }, true]);
g.api('saveContent', ['l3-pat', { topic: 'third', items: [{ type: 'mc', tag: 'x', q: 'C ____ d', options: ['a', 'b', 'c', 'd'], answer: 0, explain: 'e' }] }, true]);
const many = Array.from({ length: 9 }, (_, i) => ({ id: `m${i + 1}-pat`, title: `M${i + 1} 句型練習`, type: 'pattern', lesson: 4 + i, topic: '', visible: true, disabled: [], questionCount: 10, custom: true }));
g.api('saveAllSettings', [[], [
  { id: 'l2-pat', title: 'L2 句型練習', type: 'pattern', lesson: 2, topic: '', visible: true, disabled: [], questionCount: 10, custom: true },
  { id: 'l3-pat', title: 'L3 句型練習', type: 'pattern', lesson: 3, topic: '', visible: true, disabled: [], questionCount: 10, custom: true },
  ...many,
]]);
for (const u of many) g.api('saveContent', [u.id, { topic: 'x', items: [{ type: 'mc', tag: 'x', q: 'A ____ b', options: ['a', 'b', 'c', 'd'], answer: 0, explain: 'e' }] }, true]);
g.api('saveContent', ['l2-pat', { topic: 't', items: [{ type: 'mc', tag: 'x', q: 'A ____ b', options: ['a', 'b', 'c', 'd'], answer: 0, explain: 'e' }] }, true]);
g.api('saveContent', ['l3-pat', { topic: 'third', items: [{ type: 'mc', tag: 'x', q: 'C ____ d', options: ['a', 'b', 'c', 'd'], answer: 0, explain: 'e' }] }, true]);
const ctx = await world.newContext({ viewport: { width: 390, height: 844 } });
await ctx.addInitScript(() => {
  window.__vt = 0;
  const orig = document.startViewTransition && document.startViewTransition.bind(document);
  if (orig) document.startViewTransition = (cb) => { window.__vt++; return orig(cb); };
});
const p = await world.newPage(ctx, { student: true });
await p.goto(world.base + '/'); await p.waitForSelector('.unit-tile');
await p.click('.unit-tile[data-id="l2-pat"]'); await sleep(160);
await p.screenshot({ path: `${out}/motion-mid.png` });
await p.waitForSelector('.unit-head h1'); await p.waitForSelector('[data-start]');
assert.equal(await p.evaluate(() => window.__vt), 1, '進入單元要用卡片轉場');
assert.equal(await p.locator('.unit-head.shell').count(), 0, '載入完成後換成正式標題');
await p.click('.back'); await p.waitForSelector('.unit-tile');
assert.equal(await p.evaluate(() => window.__vt), 2, '返回要用卡片轉場');
await sleep(600);
assert.equal(await p.evaluate(() => document.documentElement.dataset.vt || ""), "", "轉場結束後要清掉方向標記");
// 卡片在頁面下方：動畫從它現在的位置開始；退出後首頁捲回原本的位置，頁面縮回同一張卡片
await p.waitForSelector('.unit-tile[data-id="m9-pat"]'); await sleep(300);
await p.evaluate(() => document.querySelector('.unit-tile[data-id="m9-pat"]').scrollIntoView({ block: 'center' }));
await sleep(200);
const y0 = await p.evaluate(() => window.scrollY);
const top0 = await p.evaluate(() => document.querySelector('.unit-tile[data-id="m9-pat"]').getBoundingClientRect().top);
assert(y0 > 300, '首頁要真的捲動過：' + y0);
await p.click('.unit-tile[data-id="m9-pat"]'); await p.waitForSelector('[data-start]'); await sleep(900);
assert.equal(await p.evaluate(() => window.scrollY), 0, '單元頁在最上方');
await p.click('.back'); await p.waitForSelector('.unit-tile[data-id="m9-pat"]'); await sleep(900);
const y1 = await p.evaluate(() => window.scrollY);
const top1 = await p.evaluate(() => document.querySelector('.unit-tile[data-id="m9-pat"]').getBoundingClientRect().top);
assert(Math.abs(y1 - y0) < 4 && Math.abs(top1 - top0) < 4, `退出後要回到原本位置：scrollY ${y0}→${y1}，卡片 top ${top0}→${top1}`);
await p.evaluate(() => window.scrollTo(0, 0)); await sleep(200);
// 從單元選單切換：用獨立的整頁換景動畫（unit → unit、unit → 首頁、首頁 → unit）
await p.click('.unit-tile[data-id="l2-pat"]'); await p.waitForSelector('[data-start]'); await sleep(900);
const vt0 = await p.evaluate(() => window.__vt);
await p.click('#unit-menu-btn'); await p.click('#unit-menu a[data-id="l3-pat"]');
await p.waitForFunction(() => /third/.test(document.querySelector('#app').textContent), null, { timeout: 5000 });
assert.equal(await p.evaluate(() => window.__vt), vt0 + 1, '選單切換單元要有轉場');
await sleep(700);
assert.equal(await p.evaluate(() => document.documentElement.dataset.vt || ''), '', '轉場結束要清掉標記');
assert.equal(await p.evaluate(() => document.querySelectorAll('[style*="view-transition-name"]').length), 0);
await p.click('#unit-menu-btn'); await p.click('#unit-menu a.home');
await p.waitForSelector('.unit-tile'); await sleep(700);
assert.equal(await p.evaluate(() => window.__vt), vt0 + 2, '選單回首頁要有轉場');
await p.click('#unit-menu-btn'); await p.click('#unit-menu a[data-id="l2-pat"]');
await p.waitForSelector('[data-start]'); await sleep(700);
assert.equal(await p.evaluate(() => window.__vt), vt0 + 3, '選單從首頁進單元要有轉場');
// 成績畫面
await p.click('[data-start]');
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
