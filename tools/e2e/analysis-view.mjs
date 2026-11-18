// 後台「錯誤分析」獨立頁：選單進得去；每個單字單元一列（狀態、字數、分析鍵）；用這台電腦分析時進度顯示在那一列；
// 單元「題目」分頁只留狀態和「去分析」；設定頁不再有引擎設定：node tools/e2e/analysis-view.mjs
import assert from 'node:assert';
import { startWorld, sleep } from './harness.mjs';
const world = await startWorld({ scriptLatency: 40 });
const g = world.gas;
const unit = (id, title, type = 'vocab') => ({ id, title, type, lesson: 1, topic: '', visible: true, disabled: [], questionCount: 4, custom: true });
g.api('saveAllSettings', [[], [unit('v1', 'L1 單字'), unit('v2', 'L2 單字'), unit('p1', 'L1 句型', 'pattern')]]);
const words = (n) => Array.from({ length: n }, (_, i) => ({ word: 'word' + i, pos: 'n.', zh: '字' + i, examples: [{ ex: `I like [word${i}].`, zh: '我喜歡。' }] }));
g.api('saveContent', ['v1', { topic: 'T', words: words(66) }, true]);
g.api('saveContent', ['v2', { topic: 'T', words: words(5) }, true]);
g.api('setBrainConfig', ['', 'k-secret']);

let bad = 0;
const step = async (n, f) => { try { await f(); console.log('✓', n); } catch (e) { bad++; console.log('✗', n, '\n  ', String(e.message).split('\n')[0]); } };
const ctx = await world.newContext({ viewport: { width: 1280, height: 900 } });
// 假的本機分析引擎：health 正常；analyze 先回幾行進度（慢慢回），最後回結果
let analyzed = [];
await ctx.route('http://127.0.0.1:8765/**', async (route) => {
  const req = route.request();
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Private-Network': 'true' };
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 200, headers: cors });
  if (req.url().endsWith('/health')) return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: '{"ok":true}' });
  const body = JSON.parse(req.postData());
  analyzed.push([body.unit, body.data.words.length]);
  await new Promise((r) => setTimeout(r, 1200));
  const lines = [{ p: { stage: '檢查同單元選項會不會也說得通', step: 2, steps: 3, done: 30, total: body.data.words.length, word: 'word30', sec: 2 } }, { result: { engine: 'x', sig: 'will-be-wrong', words: {} } }];
  return route.fulfill({ status: 200, headers: cors, contentType: 'application/x-ndjson', body: lines.map((l) => JSON.stringify(l)).join('\n') + '\n' });
});
// 後台讀題目走 Firestore（假的）：放進這兩個單元的題目
const seed = (c) => c.addInitScript(([a, b]) => { window.__fb = window.__fb || {}; window.__fb.docs = window.__fb.docs || {};
  window.__fb.docs['public/content_v1'] = { json: JSON.stringify({ v: '1', data: { words: a } }) };
  window.__fb.docs['public/content_v2'] = { json: JSON.stringify({ v: '1', data: { words: b } }) }; }, [words(66), words(5)]);
await seed(ctx);
const t = await world.newPage(ctx, { staff: 'teacher@example.com' });
const errs = []; t.on('pageerror', (e) => errs.push(e.message));
await t.addInitScript(() => { try { localStorage.setItem('brWhere', 'local'); } catch (e) { /* 無 */ } });

await step('選單有「分析」，打開是錯誤分析頁：兩個單字單元各一列，句型單元不列', async () => {
  await t.goto(world.base + '/admin.html#overview'); await sleep(2500);
  await t.click('.rail a[data-view="analysis"]'); await sleep(1500);
  assert.equal(await t.textContent('[data-pane-view="analysis"] h1'), '錯誤分析');
  await t.waitForFunction(() => document.querySelectorAll('#an-list .an-row').length === 2);
  const rows = await t.$$eval('#an-list .an-row', (a) => a.map((r) => r.textContent));
  assert.ok(rows.some((r) => /L1 單字[^]*66 個字[^]*還沒分析/.test(r)), rows.join(' | '));
  assert.match(await t.textContent('#an-all'), /全部分析（2）/);
  assert.match(await t.textContent('#an-eng'), /這台電腦的引擎已開啟/);
});
await step('按一個單元的「分析」：進度出現在那一列，送出全部 66 個字；做完狀態更新', async () => {
  await t.click('[data-an-go="v1"]'); await sleep(500);
  assert.ok(await t.$('.an-row[data-an="v1"] .an-prog .br-live:not([hidden])'), '進度條在這一列');
  assert.match(await t.textContent('.an-row[data-an="v1"] .pill'), /分析中/);
  assert.equal(await t.isDisabled('[data-an-go="v2"]'), true, '分析中其他單元先不能按');
  await t.waitForFunction(() => /分析完成/.test(document.getElementById('br-msg').textContent), null, { timeout: 15000 });
  assert.deepEqual(analyzed[0], ['v1', 66]);
  await sleep(1500);
  assert.equal(await t.isDisabled('[data-an-go="v2"]'), false);
});
await step('單元「題目」分頁只留狀態和「去分析」，按了到錯誤分析頁並標出這個單元', async () => {
  await t.goto(world.base + '/admin.html#unit/v2/content'); await sleep(2500);
  assert.equal(await t.isVisible('#an-card'), true);
  assert.equal(await t.$('#an-card #an-file'), null, '上傳檔案不在單元頁');
  await t.click('#an-goto'); await sleep(1500);
  assert.equal(await t.isVisible('[data-pane-view="analysis"]'), true);
  assert.ok(await t.$('.an-row.focus[data-an="v2"]'));
});
await step('引擎設定、上傳檔案在錯誤分析頁最下面；設定頁沒有了', async () => {
  assert.ok(await t.$('#an-adv #br-url'));
  assert.ok(await t.$('#an-adv #an-file'));
  await t.goto(world.base + '/admin.html#settings'); await sleep(1200);
  assert.equal(await t.$('[data-pane-view="settings"] #br-url'), null);
});
await step('手機：右上角頭像打開的選單裡有錯誤分析', async () => {
  const mc = await world.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }); await seed(mc);
  const m = await world.newPage(mc, { staff: 'teacher@example.com' });
  await m.goto(world.base + '/admin.html#overview'); await sleep(2500);
  await m.tap('#who-btn'); await sleep(500); // 手機的「更多」在右上角頭像
  await m.tap('.m-item[href="#analysis"]'); await sleep(1200);
  assert.equal(await m.isVisible('[data-pane-view="analysis"]'), true);
  assert.match(await m.textContent('#m-top-title'), /錯誤分析/);
});
await step('手機總覽：有錯誤分析卡（待分析幾個、是哪幾個），點「去分析」直接到錯誤分析頁；捲動的內容在分頁列下面', async () => {
  const mc = await world.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }); await seed(mc);
  const m = await world.newPage(mc, { staff: 'teacher@example.com' });
  await m.goto(world.base + '/admin.html#overview'); await sleep(3500);
  await m.waitForSelector('#ov-an-card:not([hidden])');
  assert.match(await m.textContent('#ov-an-card'), /個待分析|都分析好了/);
  await m.tap('#ov-an a[href="#analysis"]'); await sleep(1200);
  assert.equal(await m.isVisible('[data-pane-view="analysis"]'), true);
  const z = await m.evaluate(() => { const r = document.querySelector('.rail').getBoundingClientRect(); const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return { work: getComputedStyle(document.querySelector('.work')).zIndex, onTop: !!(el && el.closest('.rail')) }; });
  assert.equal(z.work, '0'); assert.ok(z.onTop, '分頁列在最上層');
});
await step('有待分析的單元：左邊選單「分析」標數字；手機頭像加一圈、選單裡標數字', async () => {
  await t.goto(world.base + '/admin.html#overview'); await sleep(3500);
  assert.match(await t.getAttribute('#rail-an', 'data-badge'), /^[1-9]/);
  const mc = await world.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }); await seed(mc);
  const m = await world.newPage(mc, { staff: 'teacher@example.com' });
  await m.goto(world.base + '/admin.html#overview'); await sleep(3500);
  assert.equal(await m.evaluate(() => document.getElementById('who-btn').classList.contains('has-an')), true);
  assert.match(await m.textContent('#who-btn .sr'), /待分析/);
  await m.tap('#who-btn'); await sleep(400);
  assert.match(await m.textContent('#m-an-n'), /^[1-9]/);
});
await step('沒有 JS 錯誤', async () => { assert.deepEqual(errs, []); });
await world.close();
if (bad) { console.log(bad + ' 項失敗'); process.exit(1); }
console.log('錯誤分析頁測試通過');
process.exit(0);
