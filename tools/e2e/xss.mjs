// 學生送來的資料（姓名、答案、錯誤類型）含 HTML／程式碼時，老師後台只能當文字顯示，不能執行：node tools/e2e/xss.mjs
import assert from 'node:assert';
import { startWorld, sleep } from './harness.mjs';
import { adminReady } from './admin-ui.mjs';

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
await adminReady(t);
// 新版：成績頁下方「查詢作答紀錄」裡的查詢（按鈕在收合區塊裡，直接觸發）
await t.evaluate(() => { location.hash = '#scores'; });
await sleep(500);
await t.evaluate(() => { const src = document.getElementById('f-src'); if (src) src.value = 'sheet'; document.getElementById('load').click(); }); // 測試資料在試算表
await t.waitForFunction(() => /onerror/.test(document.getElementById('rows').textContent), null, { timeout: 15000 });
await t.evaluate(() => document.getElementById('wload').click());
await t.waitForSelector('#wstats table', { timeout: 15000, state: 'attached' }); // 在收合的區塊裡
await sleep(500);
const out = await t.evaluate(() => ({
  xss: window.__xss,
  rows: document.getElementById('rows').textContent,
  imgs: document.querySelectorAll('#rows img, #rows svg:not(.ic-w), #wstats img, #wstats svg:not(.ic-w), #wstats script').length, // .ic-w 是後台自己的警示圖示
  what: [...document.querySelectorAll('#rows img, #rows svg, #wstats img, #wstats script')].map((e) => e.outerHTML.slice(0, 80)),
  wstats: document.getElementById('wstats').textContent,
}));
assert.equal(out.xss, undefined, '學生送來的程式碼被執行了');
assert.equal(out.imgs, 0, '學生送來的 HTML 變成了元素：' + JSON.stringify(out.what));
assert.ok(out.rows.includes('<img src=x onerror='), '姓名要原樣當文字顯示');
assert.ok(out.wstats.includes('<img src=x onerror='), '錯題分析的單字要原樣當文字顯示');
// 新版後台的總覽、成績、學生頁：成績直接讀 Firestore（假的 SDK 從 window.__fb.attempts 給資料）
const t2 = await world.newPage(await world.newContext(), { staff: 'teacher@example.com' });
await t2.addInitScript((b) => {
  const at = Date.now() - 60000;
  window.__fb = window.__fb || {};
  window.__fb.attempts = [{ id: 'x2', cls: '306', seat: '3', name: b, unit: 'x-voc', unitTitle: b, pct: 40, score: 0, total: 1, wrong: [b], check: b, serverGraded: true, level: b, createdAt: { toMillis: () => at } }];
}, bad(9));
await t2.goto(world.base + '/admin.html'); await adminReady(t2);
for (const h of ['#overview', '#scores', '#students', '#unit/x-voc/scores', '#live']) {
  await t2.evaluate((x) => { location.hash = x; }, h); await sleep(700);
  const r = await t2.evaluate(() => ({ xss: window.__xss, n: document.querySelectorAll('#work img[src="x"], #work [onerror], #work [onload]').length }));
  assert.equal(r.xss, undefined, `${h}：學生送來的程式碼被執行了`);
  assert.equal(r.n, 0, `${h}：學生送來的 HTML 變成了元素`);
  if (h === '#overview') assert.ok(await t2.evaluate(() => document.getElementById('work').textContent.includes('<img src=x')), '總覽要把姓名原樣當文字顯示（確認測試資料真的有畫出來）');
}
await world.close();
console.log('後台顯示學生資料的 XSS 測試通過');
