// 學習設定所有裝置套用：自動下一題、句型說明看法存在學生帳本（vault/{key}/prefs/learn），換一台裝置登入也一樣：node tools/e2e/prefs-sync.mjs
import assert from 'node:assert';
import { startWorld, sleep } from './harness.mjs';
import { keyOf } from './gas-mock.mjs';
const world = await startWorld({ scriptLatency: 40 });
const g = world.gas;
g.api('saveAllSettings', [[], [{ id: 'l1-voc', title: 'L1 單字', type: 'vocab', lesson: 1, topic: '', visible: true, disabled: [], questionCount: 4, custom: true }]]);
const words = ['apple', 'banana', 'cherry', 'dates', 'egg', 'fig'].map((w) => ({ word: w, pos: 'n.', zh: '字' + w, example: `I [${w}] it.`, exampleZh: '我。' }));
g.api('saveContent', ['l1-voc', { topic: 'Food', words }, true]);
const KEY = keyOf('306', '20', '陳奕嘉');
const PATH = `vault/${KEY}/prefs/learn`;
let bad = 0;
const step = async (n, f) => { try { await f(); console.log('✓', n); } catch (e) { bad++; console.log('✗', n, '\n  ', String(e.message).split('\n')[0]); } };

// 裝置 A：在帳號頁關掉自動下一題、選「直接看說明」→ 寫進學生帳本
let cloud = null;
await step('裝置 A：帳號頁改設定，寫進學生帳本（自動下一題、句型說明看法）', async () => {
  const ctx = await world.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const p = await world.newPage(ctx, { student: true });
  await p.goto(world.base + '/#/account'); await p.waitForSelector('[data-auto]'); await sleep(1800);
  assert.equal(await p.getAttribute('[data-auto]', 'aria-checked'), 'true', '預設開');
  await p.tap('[data-auto]'); await p.tap('[data-learn="read"]'); await sleep(1500);
  cloud = await p.evaluate((path) => window.__fb.docs[path], PATH);
  assert.ok(cloud, '有寫進雲端');
  assert.equal(cloud.auto, false); assert.equal(cloud.mode, 'read');
  await ctx.close();
});
// 裝置 B：全新的裝置（這台沒有任何設定），雲端已經有裝置 A 的設定
await step('裝置 B：登入後套用裝置 A 的設定（帳號頁顯示關閉、單字作答答對不自動跳）', async () => {
  const ctx = await world.newContext({ viewport: { width: 1280, height: 860 } });
  const p = await world.newPage(ctx, { student: true });
  await p.addInitScript(([path, v]) => { window.__fb = window.__fb || {}; window.__fb.docs = window.__fb.docs || {}; window.__fb.docs[path] = v; }, [PATH, { ...cloud, at: null }]);
  await p.goto(world.base + '/'); await p.waitForSelector('.unit-tile');
  await p.waitForFunction(() => localStorage.getItem('b5p:auto') === '0', null, { timeout: 12000 }); // 這台也套用：關閉
  await p.evaluate(() => { location.hash = '#/account'; }); await p.waitForSelector('[data-auto]'); await sleep(1800);
  assert.equal(await p.getAttribute('[data-auto]', 'aria-checked'), 'false');
  assert.equal(await p.getAttribute('[data-learn="read"]', 'aria-checked'), 'true');
  // 單字作答：開關也是關的
  await p.evaluate(() => { location.hash = '#/u/l1-voc'; }); await p.waitForSelector('[data-start]'); await p.click('[data-start]'); await p.waitForSelector('[data-auto-toggle]');
  assert.equal(await p.getAttribute('[data-auto-toggle]', 'aria-checked'), 'false', '作答時的自動下一題開關也是關的');
  // 在作答畫面打開：也寫回帳本
  await p.click('[data-auto-toggle]'); await sleep(1500);
  assert.equal(await p.evaluate((path) => window.__fb.docs[path].auto, PATH), true, '作答時改的也同步');
  await ctx.close();
});
await world.close?.();
if (bad) { console.log(bad + ' 項失敗'); process.exit(1); }
console.log('學習設定跨裝置同步測試通過');
process.exit(0);
