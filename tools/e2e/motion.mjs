// 動畫：換頁（首頁 ↔ 單元）、成績畫面浮現；頁面正常、沒有錯誤
import assert from 'node:assert';
import { startWorld, sleep } from './harness.mjs';
const out = process.argv[2] || '/tmp/shots';
const world = await startWorld({ scriptLatency: 100 });
const g = world.gas;
g.api('saveAllSettings', [[], [
  { id: 'l2-pat', title: 'L2 句型練習', type: 'pattern', lesson: 2, topic: '', visible: true, disabled: [], questionCount: 10, custom: true },
  { id: 'l3-pat', title: 'L3 句型練習', type: 'pattern', lesson: 3, topic: '', visible: true, disabled: [], questionCount: 10, custom: true },
  { id: 'l4-exam', title: 'L4 段考複習', type: 'exam', lesson: 4, topic: '', visible: true, disabled: [], questionCount: 10, custom: true },
]]);
const items = { topic: 't', items: [{ type: 'mc', tag: 'x', q: 'A ____ b', options: ['a', 'b', 'c', 'd'], answer: 0, explain: 'e' }] };
g.api('saveContent', ['l2-pat', items, true]);
g.api('saveContent', ['l3-pat', { ...items, topic: 'third' }, true]);
g.api('saveContent', ['l4-exam', { topic: 'e', blocks: [{ type: 'mc', q: 'A ____ b', options: ['a', 'b', 'c', 'd'], answer: 0, explain: 'e' }] }, true]);
const ctx = await world.newContext({ viewport: { width: 1280, height: 800 } });
const p = await world.newPage(ctx, { student: true });
await p.goto(world.base + '/'); await p.waitForSelector('.unit-tile');
await p.click('.unit-tile[data-id="l2-pat"]'); await p.waitForSelector('[data-start]');
await p.click('.back'); await p.waitForSelector('.unit-tile'); await sleep(500);
// 從單元選單切換
await p.click('.unit-tile[data-id="l2-pat"]'); await p.waitForSelector('[data-start]');
await p.click('#unit-menu-btn'); await p.click('#unit-menu a[data-id="l3-pat"]');
await p.waitForFunction(() => /third/.test(document.querySelector('#app').textContent), null, { timeout: 5000 });
// 段考複習的說明卡要和上面的標題靠左對齊（不是置中跑版）
await p.click('#unit-menu-btn'); await p.click('#unit-menu a[data-id="l4-exam"]');
await p.waitForSelector('.gate-card'); await sleep(500);
const left = await p.evaluate(() => ({ head: document.querySelector('.unit-head h1').getBoundingClientRect().left, card: document.querySelector('.gate-card').getBoundingClientRect().left }));
assert(Math.abs(left.head - left.card) < 24, `說明卡要和標題靠左對齊：${JSON.stringify(left)}`);
await p.screenshot({ path: `${out}/motion-exam-gate.png` });
// 成績畫面
await p.click('#unit-menu-btn'); await p.click('#unit-menu a[data-id="l2-pat"]');
await p.waitForSelector('[data-start]'); await p.click('[data-start]');
await p.waitForSelector('.opt'); await p.locator('.opt').first().click();
await sleep(200);
await p.locator('[data-next]:not([hidden])').click(); await p.waitForSelector('.result.pass');
await sleep(1400);
await p.screenshot({ path: `${out}/motion-result.png` });
const bad = p.errors.filter((e) => !/favicon/.test(e));
assert.equal(bad.length, 0, bad.join('\n'));
console.log('動畫測試通過');
await world.close();
