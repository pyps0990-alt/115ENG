// 老師指派的作業：後台指派 → 學生首頁最上面放這份作業、列表分段 → 點到別的單元時提醒：node tools/e2e/assign.mjs
import assert from 'node:assert';
import { startWorld, sleep } from './harness.mjs';

const world = await startWorld({ scriptLatency: 40 });
const g = world.gas;
const units = [
  { id: 'u1', title: 'L1 單字', type: 'vocab', lesson: 1, topic: '', visible: true, disabled: [], questionCount: 4, custom: true },
  { id: 'u2', title: 'L2 單字', type: 'vocab', lesson: 2, topic: '', visible: true, disabled: [], questionCount: 4, custom: true },
];
g.api('saveAllSettings', [[], units]);
const words = ['a1', 'b2', 'c3', 'd4', 'e5', 'f6'].map((w) => ({ word: w, pos: 'n.', zh: '字', example: `I [${w}] it.`, exampleZh: '我。' }));
units.forEach((u) => g.api('saveContent', [u.id, { topic: 'Topic', words }, true]));

let bad = 0;
const step = async (n, f) => { try { await f(); console.log('✓', n); } catch (e) { bad++; console.log('✗', n, '\n  ', String(e.message).split('\n')[0]); } };
const errors = [];

// ---------- 老師：在單元頁指派給全部班級 ----------
const tctx = await world.newContext({ viewport: { width: 1280, height: 900 } });
const t = await world.newPage(tctx, { staff: 'teacher@example.com' });
t.on('pageerror', (e) => errors.push('admin: ' + e.message));
await t.goto(world.base + '/admin.html#unit/u2/content');
await t.waitForSelector('#u-assign', { state: 'visible', timeout: 15000 });

await step('單元頁按「指派作業」：面板預設全部班級、截止「週五」，選下週一後按「指派」→ 試算表與學生網站都有這份作業', async () => {
  await t.click('#u-assign');
  await t.waitForSelector('dialog.asg-sheet[open]');
  assert.equal(await t.isChecked('dialog.asg-sheet .asg-chips input[value="all"]'), true);
  await t.check('dialog.asg-sheet input[name="asg-due"][value="mon"]');
  assert.match(await t.textContent('#asg-when'), /截止/);
  await t.click('dialog.asg-sheet [data-a="1"]');
  await t.waitForFunction(() => /✓/.test((document.getElementById('asg-msg') || {}).textContent || '') || !document.querySelector('dialog.asg-sheet'), null, { timeout: 8000 });
  await sleep(300);
  const d = g.api('getAdminData', []).data;
  assert.equal(d.assignments.length, 1);
  assert.equal(d.assignments[0].unit, 'u2');
  assert.deepEqual(d.assignments[0].cls, ['all']);
  const cfg = JSON.parse(world.docs.config);
  assert.equal(cfg.assign[0].unit, 'u2');
  assert.equal(cfg.assign[0].warn, true);
});
await step('單元標題列顯示「已指派」，按鈕變成「編輯指派」', async () => {
  await t.waitForFunction(() => /已指派/.test(document.getElementById('u-sub').textContent));
  assert.match(await t.textContent('#u-assign'), /編輯指派/);
});
await step('總覽「指派作業」卡列出這份作業與截止時間', async () => {
  await t.goto(world.base + '/admin.html#overview');
  await t.waitForSelector('#ov-asg .asg-item', { timeout: 8000 });
  assert.match(await t.textContent('#ov-asg'), /L2 單字/);
  assert.match(await t.textContent('#ov-asg'), /截止/);
});

// ---------- 學生 ----------
const sctx = await world.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
const p = await world.newPage(sctx);
p.on('pageerror', (e) => errors.push('student: ' + e.message));
await p.goto(world.base + '/');
await p.waitForSelector('.welcome');
await p.fill('#f-cls', '306'); await p.fill('#f-seat', '20'); await p.fill('#f-name', '陳奕嘉');
await p.click('.welcome [type="submit"]');
await p.waitForSelector('.unit-tile', { timeout: 10000 });

await step('學生首頁：主卡是老師指派的 L2（不是課次較前面的 L1）；列表照課次排，L2 只出現一次並帶「指派」小標籤', async () => {
  await p.waitForSelector('.asg-rail .next-card', { timeout: 5000 });
  const lead = await p.textContent('.asg-rail .next-card');
  assert.match(lead, /老師指派/); assert.match(lead, /L2 單字/);
  assert.equal(await p.$$eval('.asg-sec', (a) => a.length), 0, '不再另外分一段');
  assert.equal(await p.$$eval('.unit-tile[data-id="u2"]', (a) => a.length), 1, 'L2 在列表只出現一次');
  assert.match(await p.textContent('.unit-tile[data-id="u2"] .tile-asg'), /指派・\d+\/\d+ 截止/);
  assert.equal(await p.$$eval('.unit-tile[data-id="u1"] .tile-asg', (a) => a.length), 0);
  // 標籤靠左、不超出卡片；主卡沒有被切掉的灰色陰影區
  const r = await p.evaluate(() => { const c = document.querySelector('.unit-tile[data-id="u2"]').getBoundingClientRect(), t = document.querySelector('.unit-tile[data-id="u2"] .tile-asg').getBoundingClientRect(), rail = document.querySelector('.asg-rail'); return { inside: t.right <= c.right && t.left >= c.left, ov: getComputedStyle(rail).overflowX }; });
  assert.ok(r.inside); assert.equal(r.ov, 'visible');
});
await step('點 L1：先問「要做的是這個嗎？」，選「去做指派的作業」就到 L2', async () => {
  await p.click('.unit-tile[data-id="u1"]');
  await p.waitForSelector('dialog.modal[open]', { timeout: 5000 });
  assert.match(await p.textContent('dialog.modal'), /老師指派的是 L2 單字/);
  await p.click('dialog.modal button[value="ok"]');
  await p.waitForFunction(() => location.hash === '#/u/u2', null, { timeout: 5000 });
});
await step('再點 L1，選「還是做 L1」：進入 L1；之後再點不再問', async () => {
  await p.goto(world.base + '/'); await p.waitForSelector('.unit-tile[data-id="u1"]');
  await p.click('.unit-tile[data-id="u1"]');
  await p.waitForSelector('dialog.modal[open]');
  await p.click('dialog.modal button[value="cancel"]');
  await p.waitForFunction(() => location.hash === '#/u/u1', null, { timeout: 5000 });
  await p.goto(world.base + '/'); await p.waitForSelector('.unit-tile[data-id="u1"]');
  await p.click('.unit-tile[data-id="u1"]');
  await p.waitForFunction(() => location.hash === '#/u/u1', null, { timeout: 5000 });
  assert.equal(await p.$$eval('dialog.modal[open]', (a) => a.length), 0);
});
await step('老師取消指派：學生首頁回到原本的「下一個單元」，不再提醒', async () => {
  await t.click('#ov-asg [data-asg-edit="u2"]');
  await t.waitForSelector('dialog.asg-sheet[open] [data-a="del"]');
  await t.click('dialog.asg-sheet [data-a="del"]');
  await t.waitForFunction(() => !document.querySelector('dialog.asg-sheet'), null, { timeout: 8000 });
  assert.equal(g.api('getAdminData', []).data.assignments.length, 0);
  await p.goto(world.base + '/'); await p.reload();
  await p.waitForSelector('.unit-tile');
  await p.waitForFunction(() => !document.querySelector('.asg-rail'), null, { timeout: 8000 });
  assert.equal(await p.$$eval('.tile-asg', (a) => a.length), 0);
});
await step('沒有 JS 錯誤', async () => { assert.deepEqual(errors, []); });

await world.close?.();
if (bad) { console.log(bad + ' 項失敗'); process.exit(1); }
console.log('指派作業測試通過');
process.exit(0);
