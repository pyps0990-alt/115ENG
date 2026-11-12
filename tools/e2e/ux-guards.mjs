// 防止用錯帳號與 iPhone 相關的行為：作答前確認身分、閒置 5 小時打開先確認身分、滑動返回不重複換頁動畫、手機打字時收起測驗底部列：node tools/e2e/ux-guards.mjs
import assert from 'node:assert';
import { startWorld, sleep } from './harness.mjs';

const world = await startWorld({ scriptLatency: 40 });
const g = world.gas;
g.api('saveAllSettings', [[], ['l1-voc', 'l2-voc', 'l3-voc', 'l4-voc'].map((id, i) => ({ id, title: `L${i + 1} 單字`, type: 'vocab', lesson: i + 1, topic: 'T', visible: true, disabled: [], questionCount: 4, custom: true }))]);
const words = ['apple', 'banana', 'cherry', 'dates', 'egg', 'fig'].map((w) => ({ word: w, pos: 'n.', zh: '字' + w, example: `I [${w}] it.`, exampleZh: '我。' }));
for (const id of ['l1-voc', 'l2-voc', 'l3-voc', 'l4-voc']) g.api('saveContent', [id, { topic: 'Food', words }, true]);
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
await step('手機鍵盤：程式自動把游標放進輸入框（iPhone 不會跳出鍵盤）時底部列照常顯示；鍵盤真的打開才收起，收起鍵盤就回來', async () => {
  // 模擬 iPhone 的鍵盤：鍵盤打開時「看得到的畫面高度」（visualViewport）變小，版面高度不變
  const k = await world.newContext(phone);
  await k.addInitScript(() => {
    const vv = new EventTarget(); let h = window.innerHeight;
    Object.defineProperties(vv, { height: { get: () => h }, width: { get: () => window.innerWidth }, offsetTop: { value: 0 }, offsetLeft: { value: 0 }, pageTop: { get: () => window.scrollY }, pageLeft: { value: 0 }, scale: { value: 1 } });
    Object.defineProperty(window, 'visualViewport', { value: vv, configurable: true });
    window.__kb = (open) => { h = open ? window.innerHeight - 320 : window.innerHeight; vv.dispatchEvent(new Event('resize')); };
  });
  const q = await world.newPage(k, { student: true });
  await q.goto(world.base + '/#/u/l4-voc'); await q.waitForSelector('[data-start]'); await sleep(400);
  await q.tap('[data-start]'); await q.waitForSelector('.q-card'); await sleep(500);
  const on = () => q.evaluate(() => document.documentElement.classList.contains('kb-typing'));
  await q.evaluate(() => { const i = document.createElement('input'); i.type = 'text'; i.id = 'kb'; document.querySelector('.q-card').append(i); i.focus(); });
  await sleep(450);
  assert.equal(await on(), false, '游標在輸入框但鍵盤沒打開：底部列照常（影片裡「下一題」不見的情況）');
  await q.evaluate(() => window.__kb(true)); await sleep(100);
  assert.equal(await on(), true, '鍵盤打開：收起底部列');
  assert.equal(await q.evaluate(() => getComputedStyle(document.querySelector('.q-dock')).pointerEvents), 'none');
  await q.evaluate(() => window.__kb(false)); await sleep(100);
  assert.equal(await on(), false, '鍵盤收起（焦點還在輸入框也一樣）：底部列回來');
  await q.evaluate(() => window.__kb(true)); await sleep(100);
  await q.evaluate(() => { document.getElementById('kb').disabled = true; }); await q.keyboard.press('Enter'); await sleep(300);
  assert.equal(await on(), false, '送出答案後輸入框被鎖住：底部列回來');
});
await step('單字發音：英文題目旁有 🔊，按了用英文念那個字，不會選到選項或作答', async () => {
  const ctx = await world.newContext(phone);
  await ctx.addInitScript(() => {
    window.__said = [];
    const mock = { speak: (u) => window.__said.push([u.text, u.lang]), cancel() {}, getVoices: () => [{ lang: 'en-US', name: 'Samantha' }], addEventListener() {} };
    Object.defineProperty(window, 'speechSynthesis', { value: mock, configurable: true });
    window.SpeechSynthesisUtterance = function (t) { this.text = t; };
  });
  const v = await world.newPage(ctx, { student: true });
  await v.goto(world.base + '/'); await v.waitForSelector('.unit-tile'); await sleep(500);
  // 直接畫一題英→中的選擇題（測驗的題目方向是隨機的，不一定遇得到）
  await v.evaluate(async () => {
    const { renderMC } = await import('/js/components/question.js');
    const host = document.createElement('div'); host.id = 'say-host'; document.getElementById('app').prepend(host);
    const w = (x) => ({ word: x, zh: '字' + x, pos: 'n.' });
    renderMC(host, { dir: 'en2zh', word: w('apple'), options: ['字apple', '字egg', '字fig', '字dates'], answer: 0, words: [w('apple'), w('egg'), w('fig'), w('dates')] }, { onAnswer() {} });
    scrollTo(0, 0);
  });
  await v.waitForSelector('.q-prompt .say');
  const word = await v.textContent('.q-prompt .w');
  await v.tap('.q-prompt .say'); await sleep(200);
  assert.deepEqual(await v.evaluate(() => window.__said), [[word, 'en-US']]);
  assert.equal(await v.$$eval('.q-card .opt.selected, .q-card .opt.picked', (a) => a.length), 0, '沒有選到選項');
  assert.ok(await v.$eval('.q-prompt .say', (b) => { const r = b.getBoundingClientRect(); return r.width >= 44 && r.height >= 44; }), '按鈕至少 44×44');
});
await step('底部分頁列置中不用位移（iPhone 換頁轉場會把 translateX(-50%) 算錯，整條往左偏）', async () => {
  await p.evaluate(() => { delete document.body.dataset.busy; location.hash = '#/'; }); await p.waitForSelector('.unit-tile'); await sleep(800);
  const d = await p.evaluate(() => { const el = document.getElementById('dock'); if (!el) return null; const r = el.getBoundingClientRect(); return { t: getComputedStyle(el).transform, mid: Math.round((r.left + r.right) / 2), w: innerWidth }; });
  if (d) { assert.ok(!/matrix\(1, 0, 0, 1, -/.test(d.t), '不能有往左的位移：' + d.t); assert.ok(Math.abs(d.mid - d.w / 2) < 2, '置中 ' + JSON.stringify(d)); }
});
await step('沒有 JS 錯誤', async () => { assert.deepEqual(p.errors, []); });
await world.close();
if (bad) { console.log(bad + ' 項失敗'); process.exit(1); }
console.log('iPhone 行為測試通過');
process.exit(0);
