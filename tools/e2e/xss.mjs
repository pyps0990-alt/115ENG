// 學生送來的資料（姓名、答案、錯誤類型）含 HTML／程式碼時，老師後台只能當文字顯示，不能執行：node tools/e2e/xss.mjs
import assert from 'node:assert';
import { startWorld, sleep } from './harness.mjs';

const world = await startWorld({ scriptLatency: 50 });
const g = world.gas;
g.api('saveAllSettings', [[], [{ id: 'x-voc', title: 'X', type: 'vocab', lesson: 1, topic: '', visible: true, disabled: [], questionCount: 4, custom: true }]]);
g.api('saveContent', ['x-voc', { topic: 't', words: ['apple', 'bread', 'candy', 'dance'].map((w) => ({ word: w, pos: 'n.', zh: '字', example: `I [${w}] it.`, exampleZh: '我。' })) }, true]);
const bad = (n) => `<img src=x onerror="window.__xss=${n}">`;
const res = g.postScore({
  cls: '306', seat: '3', name: bad(1), unit: 'x-voc', unitTitle: '<svg onload="window.__xss=2">', mode: 'vocab', score: 0, total: 1, pct: 0,
  durationSec: 60, attemptId: 'xss1', wrong: [bad(3)], basic: bad(4),
  details: [{ stage: '基礎', n: 1, kind: '英→中', word: bad(5), correct: bad(6), yours: '<script>window.__xss=7</script>', ok: false, points: 0, err: bad(8) }],
});
assert.equal(res.ok, true, JSON.stringify(res));

const ctx = await world.newContext();
const t = await world.newPage(ctx, { staff: 'teacher@example.com' });
await t.goto(world.base + '/admin.html');
await t.waitForSelector('#units tr[data-i]', { timeout: 15000 });
await t.click('nav button[data-tab="scores"]');
await t.click('#load');
await t.waitForFunction(() => /onerror/.test(document.getElementById('rows').textContent), null, { timeout: 15000 });
await t.click('#wload');
await t.waitForSelector('#wstats table', { timeout: 15000 });
await sleep(500);
const out = await t.evaluate(() => ({
  xss: window.__xss,
  rows: document.getElementById('rows').textContent,
  imgs: document.querySelectorAll('#rows img, #rows svg, #wstats img, #wstats script').length,
  wstats: document.getElementById('wstats').textContent,
}));
assert.equal(out.xss, undefined, '學生送來的程式碼被執行了');
assert.equal(out.imgs, 0, '學生送來的 HTML 變成了元素');
assert.ok(out.rows.includes('<img src=x onerror='), '姓名要原樣當文字顯示');
assert.ok(out.wstats.includes('<img src=x onerror='), '錯題分析的單字要原樣當文字顯示');
await world.close();
console.log('後台顯示學生資料的 XSS 測試通過');
