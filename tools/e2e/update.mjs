// 部署新版後：學生端換頁時自動更新（考試中不打斷）；老師後台只顯示提示列、不自動重新載入
import fs from 'node:fs';
import assert from 'node:assert';
import { startWorld, sleep } from './harness.mjs';
const ROOT = new URL('../../', import.meta.url).pathname;
const vf = ROOT + 'version.json';
const orig = fs.readFileSync(vf, 'utf8');
const setV = (v) => fs.writeFileSync(vf, JSON.stringify({ v }) + '\n');
setV('aaaaaaaaaaaa');
const world = await startWorld({ scriptLatency: 100 });
const g = world.gas;
g.api('saveAllSettings', [[], [{ id: 'l2-pat', title: 'L2', type: 'pattern', lesson: 2, topic: '', visible: true, disabled: [], questionCount: 10, custom: true }]]);
g.api('saveContent', ['l2-pat', { topic: 't', items: [{ type: 'mc', tag: 'x', q: 'A ____ b', options: ['a', 'b', 'c', 'd'], answer: 0, explain: 'e' }] }, true]);
try {
  const ctx = await world.newContext({ viewport: { width: 390, height: 844 } });
  const p = await world.newPage(ctx, { student: true });
  let loads = 0;
  p.on('load', () => { loads++; });
  const wake = () => p.evaluate(() => window.dispatchEvent(new Event('focus')));
  await p.goto(world.base + '/'); await p.waitForSelector('.unit-tile');
  await sleep(1500); // 記下目前版本
  await wake(); await sleep(400);
  assert.equal(await p.locator('.update-bar').count(), 0, '沒有新版時不提示');
  // 1) 考試中部署新版：只提示，不重新載入
  await p.click('.unit-tile'); await p.waitForSelector('[data-start]'); await p.click('[data-start]'); await p.waitForSelector('.opt');
  setV('bbbbbbbbbbbb'); await wake(); await p.waitForSelector('.update-bar', { timeout: 4000 });
  const before = loads;
  await p.locator('.opt').first().click(); await sleep(600);
  assert.equal(loads, before, '考試中不能自動重新載入');
  // 2) 考完回到首頁（換頁）：自動載入新版
  await p.locator('[data-next]:not([hidden])').click(); await p.waitForSelector('.result');
  await p.evaluate(() => { location.hash = '#/'; });
  await p.waitForFunction((n) => performance.getEntriesByType('navigation').length >= 1 && !document.querySelector('.update-bar'), loads, { timeout: 6000 });
  await sleep(1500);
  assert(loads > before, '換頁時要自動更新成新版');
  assert.equal(await p.locator('.update-bar').count(), 0, '更新後提示列消失');
  // 3) 老師後台：只提示，不自動重新載入
  const t = await world.newPage(ctx, { staff: 'teacher@example.com' });
  let tl = 0; t.on('load', () => { tl++; });
  await t.goto(world.base + '/admin.html'); await t.waitForSelector('#units tr[data-i]', { timeout: 15000 });
  await sleep(1500);
  setV('cccccccccccc'); await t.evaluate(() => window.dispatchEvent(new Event('focus')));
  await t.waitForSelector('.update-bar', { timeout: 4000 });
  const tb = tl; await sleep(1500);
  assert.equal(tl, tb, '後台不能自動重新載入');
  assert.match(await t.locator('.update-bar').textContent(), /先儲存/);
  await t.click('.update-bar button');
  await t.waitForSelector('#units tr[data-i]', { timeout: 15000 });
  assert(tl > tb, '按「立即更新」會重新載入');
  const bad = p.errors.concat(t.errors).filter((e) => !/favicon|ERR_ABORTED/.test(e));
  assert.equal(bad.length, 0, bad.join('\n'));
  console.log('自動更新測試通過');
} finally {
  fs.writeFileSync(vf, orig);
  await world.close();
}
