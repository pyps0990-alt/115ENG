// 外觀：淺色／深色／跟隨系統（學生帳號頁、老師後台帳號選單），存在這台裝置、重新整理後還在：node tools/e2e/theme.mjs
import assert from 'node:assert';
import { startWorld, sleep } from './harness.mjs';
import { adminReady } from './admin-ui.mjs';

const world = await startWorld({ scriptLatency: 40 });
world.gas.api('saveAllSettings', [[], [{ id: 'l1-voc', title: 'L1 單字', type: 'vocab', lesson: 1, topic: 'T', visible: true, disabled: [], questionCount: 4, custom: true }]]);
let bad = 0;
const step = async (n, f) => { try { await f(); console.log('✓', n); } catch (e) { bad++; console.log('✗', n, '\n  ', String(e.message).split('\n')[0]); } };
const dark = (p) => p.evaluate(() => document.documentElement.classList.contains('dark'));
const bg = (p) => p.evaluate(() => getComputedStyle(document.body).backgroundColor);

const ctx = await world.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, colorScheme: 'dark' });
const p = await world.newPage(ctx, { student: true });
await p.goto(world.base + '/#/account'); await p.waitForSelector('[data-theme]'); await sleep(500);
await step('學生：預設跟隨系統（系統是深色 → 深色）', async () => {
  assert.equal(await dark(p), true);
  assert.equal(await p.$eval('[data-theme="auto"]', (b) => b.getAttribute('aria-checked')), 'true');
  assert.notEqual(await bg(p), 'rgb(246, 248, 251)');
});
await step('學生：選「淺色」立刻變淺色，重新整理後還是淺色', async () => {
  await p.tap('[data-theme="light"]'); await sleep(200);
  assert.equal(await dark(p), false);
  assert.equal(await bg(p), 'rgb(246, 248, 251)');
  await p.reload(); await p.waitForSelector('[data-theme]');
  assert.equal(await dark(p), false);
  assert.equal(await p.$eval('[data-theme="light"]', (b) => b.getAttribute('aria-checked')), 'true');
});
await step('學生：系統是淺色時選「深色」也是深色；改回「跟隨系統」就跟著系統', async () => {
  await p.emulateMedia({ colorScheme: 'light' });
  await p.tap('[data-theme="dark"]'); await sleep(200);
  assert.equal(await dark(p), true);
  await p.tap('[data-theme="auto"]'); await sleep(200);
  assert.equal(await dark(p), false);
  await p.emulateMedia({ colorScheme: 'dark' }); await sleep(200);
  assert.equal(await dark(p), true, '系統切到深色，畫面跟著變');
});
const t = await world.newPage(await world.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: 'light' }), { staff: 'teacher@example.com' });
await t.goto(world.base + '/admin.html'); await adminReady(t);
await step('後台：帳號選單有外觀，選「深色」整個後台變深色，重新整理後還在', async () => {
  await t.click('#who-btn'); await t.waitForSelector('#who-menu:not([hidden]) .who-theme');
  await t.click('#who-menu .who-theme [data-theme="dark"]'); await sleep(200);
  assert.equal(await dark(t), true);
  assert.ok(await t.$('#who-menu:not([hidden])'), '選了之後選單還開著');
  await t.reload(); await adminReady(t);
  assert.equal(await dark(t), true);
  assert.equal(t.errors.length, 0, t.errors.join('\n'));
});
await step('沒有 JS 錯誤', async () => { assert.deepEqual(p.errors, []); });
await world.close();
if (bad) { console.log(bad + ' 項失敗'); process.exit(1); }
console.log('外觀切換測試通過');
process.exit(0);
