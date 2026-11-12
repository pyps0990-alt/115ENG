// 防止用錯帳號與 iPhone 相關的行為：作答前確認身分、閒置 5 小時打開先確認身分、滑動返回不重複換頁動畫、手機打字時收起測驗底部列：node tools/e2e/ux-guards.mjs
import assert from 'node:assert';
import { startWorld, sleep } from './harness.mjs';

const world = await startWorld({ scriptLatency: 40 });
const g = world.gas;
g.api('saveAllSettings', [[], ['l1-voc', 'l2-voc'].map((id, i) => ({ id, title: `L${i + 1} 單字`, type: 'vocab', lesson: i + 1, topic: 'T', visible: true, disabled: [], questionCount: 4, custom: true }))]);
const words = ['apple', 'banana', 'cherry', 'dates', 'egg', 'fig'].map((w) => ({ word: w, pos: 'n.', zh: '字' + w, example: `I [${w}] it.`, exampleZh: '我。' }));
for (const id of ['l1-voc', 'l2-voc']) g.api('saveContent', [id, { topic: 'Food', words }, true]);
const phone = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true };
let bad = 0;
const step = async (n, f) => { try { await f(); console.log('✓', n); } catch (e) { bad++; console.log('✗', n, '\n  ', String(e.message).split('\n')[0]); } };
const page = async (seenAgoH, askWho = false) => {
  const ctx = await world.newContext(phone);
  if (askWho) await ctx.addInitScript(() => { window.__askWho = true; }); // 測試環境預設已確認身分：這裡要看確認框
  const p = await world.newPage(ctx, { student: true });
  if (seenAgoH != null) await p.addInitScript((t) => { if (!sessionStorage.getItem('x')) { sessionStorage.setItem('x', 1); localStorage.setItem('b5p:seen', String(t)); } }, Date.now() - seenAgoH * 3600000);
  await p.goto(world.base + '/'); await p.waitForSelector('.unit-tile'); await sleep(800);
  return p;
};

await step('閒置 6 小時再打開：先問「你是 陳〇嘉 嗎？」，按「換人」打開切換學生', async () => {
  const p = await page(6);
  await p.waitForSelector('dialog.modal[open]');
  assert.match(await p.textContent('dialog.modal[open]'), /你是 陳〇嘉 嗎？[^]*306 班 20 號/);
  await p.tap('dialog.modal[open] [value="cancel"]'); await sleep(400);
  await p.waitForSelector('dialog.modal[open] form');
  assert.match(await p.textContent('dialog.modal[open]'), /切換學生/);
});
await step('閒置 4 小時、或第一次打開：不問', async () => {
  for (const h of [4, null]) {
    const p = await page(h); await sleep(500);
    assert.equal(await p.$$eval('dialog.modal[open]', (a) => a.length), 0, `${h} 小時`);
  }
});
await step('作答前確認身分：開始正式測驗先問一次，「開始作答」後同一次使用不再問；「換人」打開切換學生', async () => {
  const q = await page(null, true);
  await q.tap('.unit-tile[data-id="l1-voc"]'); await q.waitForSelector('[data-start]'); await sleep(500);
  await q.tap('[data-start]'); await q.waitForSelector('dialog.modal[open]');
  assert.match(await q.textContent('dialog.modal[open]'), /以這個身分作答？[^]*306 班 20 號 陳奕嘉/);
  await q.tap('dialog.modal[open] [value="cancel"]'); await sleep(400);
  assert.match(await q.textContent('dialog.modal[open]'), /切換學生/, '換人：打開切換學生');
  await q.tap('dialog.modal[open] [data-close]'); await sleep(400);
  await q.tap('[data-start]'); await q.waitForSelector('dialog.modal[open]');
  await q.tap('dialog.modal[open] [value="ok"]'); await q.waitForSelector('.q-card');
  await q.evaluate(() => { delete document.body.dataset.busy; location.hash = '#/u/l2-voc'; }); await q.waitForSelector('[data-start]'); await sleep(500);
  await q.tap('[data-start]'); await q.waitForSelector('.q-card');
  assert.equal(await q.$$eval('dialog.modal[open]', (a) => a.length), 0, '同一次使用不再問');
});
const p = await page(0.1);
await step('滑動返回（瀏覽器自己做了動畫）：這次換頁不再做轉場', async () => {
  await p.evaluate(() => { window.__vt = 0; const o = document.startViewTransition.bind(document); document.startViewTransition = (cb) => { window.__vt++; return o(cb); }; });
  await p.tap('.unit-tile[data-id="l1-voc"]'); await p.waitForSelector('[data-start]'); await sleep(600);
  assert.equal(await p.evaluate(() => window.__vt), 1, '一般換頁有轉場');
  await p.evaluate(() => { location.hash = '#/'; window.dispatchEvent(new PopStateEvent('popstate', { hasUAVisualTransition: true })); }); // 跟真的滑動返回一樣：popstate 在 hashchange 之前
  await p.waitForSelector('.unit-tile'); await sleep(600);
  assert.equal(await p.evaluate(() => window.__vt), 1, '滑動返回不再做轉場');
  await p.evaluate(() => { location.hash = '#/u/l2-voc'; }); await p.waitForSelector('[data-start]'); await sleep(600);
  assert.equal(await p.evaluate(() => window.__vt), 2, '之後的換頁照常有轉場');
});
await step('手機上打字時收起測驗底部列，收起鍵盤後再出現', async () => {
  await sleep(300); await p.screenshot({ path: '/tmp/claude-0/-home-user-115ENG/bfaeb369-f8c3-5d91-ad5d-dce04cab85d6/scratchpad/ux.png' });
  await p.tap('[data-start]'); await p.waitForSelector('.q-dock .q-card, .q-card'); await sleep(500);
  await p.evaluate(() => { const i = document.createElement('input'); i.type = 'text'; i.id = 'kb'; document.querySelector('.q-card').append(i); });
  await p.focus('#kb'); await sleep(350);
  assert.equal(await p.evaluate(() => document.documentElement.classList.contains('kb-typing')), true);
  assert.equal(await p.evaluate(() => getComputedStyle(document.querySelector('.q-dock')).pointerEvents), 'none');
  await p.evaluate(() => document.getElementById('kb').blur()); await sleep(350);
  assert.equal(await p.evaluate(() => document.documentElement.classList.contains('kb-typing')), false);
});
await step('沒有 JS 錯誤', async () => { assert.deepEqual(p.errors, []); });
await world.close();
if (bad) { console.log(bad + ' 項失敗'); process.exit(1); }
console.log('iPhone 行為測試通過');
process.exit(0);
