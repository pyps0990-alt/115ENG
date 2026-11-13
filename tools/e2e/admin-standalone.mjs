// 後台加到主畫面（iPhone）：打開、切回來時自動輕推內容區，讓系統重算安全區域（不用自己滑）；一般瀏覽器不動：node tools/e2e/admin-standalone.mjs
import assert from 'node:assert';
import { startWorld, sleep } from './harness.mjs';

const world = await startWorld({ scriptLatency: 40 });
const phone = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true };
let bad = 0;
const step = async (n, f) => { try { await f(); console.log('✓', n); } catch (e) { bad++; console.log('✗', n, '\n  ', String(e.message).split('\n')[0]); } };

const ctx = await world.newContext(phone);
await ctx.addInitScript(() => { window.__standalone = true; });
const t = await world.newPage(ctx, { staff: 'teacher@example.com' });
await t.goto(world.base + '/admin.html'); await t.waitForSelector('.work', { state: 'attached' }); await sleep(1500);
await step('主畫面 App 打開：自動輕推', async () => {
  const a = await t.evaluate(() => ({ on: document.documentElement.classList.contains('standalone'), n: window.__saKicks || 0 }));
  assert.ok(a.on && a.n >= 3, JSON.stringify(a));
});
await step('切回來也輕推，內容區捲動位置不變', async () => {
  const y0 = await t.evaluate(() => { const w = document.querySelector('.work'); const d = document.createElement('div'); d.style.height = '3000px'; w.append(d); w.scrollTo({ top: 400, behavior: 'instant' }); return w.scrollTop; });
  assert.ok(y0 > 0);
  const n0 = await t.evaluate(() => window.__saKicks);
  await t.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
  await sleep(1300);
  const b = await t.evaluate(() => ({ n: window.__saKicks, y: document.querySelector('.work').scrollTop }));
  assert.ok(b.n >= n0 + 3); assert.equal(b.y, y0);
});
await step('一般瀏覽器不輕推', async () => {
  const q = await world.newPage(await world.newContext(phone), { staff: 'teacher@example.com' });
  await q.goto(world.base + '/admin.html'); await q.waitForSelector('.work', { state: 'attached' }); await sleep(1500);
  assert.equal(await q.evaluate(() => window.__saKicks || 0), 0);
});
await step('沒有 JS 錯誤', async () => { assert.deepEqual(t.errors, []); });
await world.close();
if (bad) { console.log(bad + ' 項失敗'); process.exit(1); }
console.log('後台主畫面 App 測試通過');
process.exit(0);
