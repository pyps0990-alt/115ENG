// 「需要確認」的作答：老師按「已確認」後不再算進卡片與總覽，可以取消：node tools/e2e/ack.mjs
import assert from 'node:assert';
import { startWorld, sleep } from './harness.mjs';

const world = await startWorld({ scriptLatency: 50 });
const g = world.gas;
g.api('saveAllSettings', [[], [{ id: 'u1', title: 'U1 單字', type: 'vocab', lesson: 1, topic: '', visible: true, disabled: [], questionCount: 4, custom: true }]]);
const ctx = await world.newContext({ viewport: { width: 1280, height: 900 } });
const t = await world.newPage(ctx, { staff: 'teacher@example.com' });
await t.addInitScript(() => {
  const now = Date.now();
  const mk = (id, seat, name, check, ago) => ({ id, attemptId: id, cls: '306', seat, name, unit: 'u1', unitTitle: 'U1 單字', mode: 'vocab', pct: 80, score: 8, total: 10, review: false,
    serverGraded: true, check, wrong: [], createdAt: { toMillis: () => now - ago } });
  window.__fb = window.__fb || {};
  window.__fb.attempts = [
    mk('a1', '1', '甲', '作答時間過短', 60000), mk('a2', '2', '乙', '離開作答畫面 3 次（共 40 秒）', 120000),
    mk('a3', '3', '丙', '截止後才交卷', 180000), mk('a4', '4', '丁', '', 240000),
  ];
});
let bad = 0;
const step = async (n, f) => { try { await f(); console.log('✓', n); } catch (e) { bad++; console.log('✗', n, '\n  ', e.message); } };
const flagged = () => t.$$eval('#usc-view [data-usc-ack][data-on="1"]', (a) => a.length);
const acked = () => t.$$eval('#usc-view [data-usc-ack][data-on="0"]', (a) => a.length);

await t.goto(world.base + '/admin.html#unit/u1/scores');
await t.waitForSelector('#usc-view [data-usc-ack]', { timeout: 15000 });
await step('需要確認列出 3 筆，每筆有「已確認」按鈕，正常的那筆不列', async () => {
  assert.equal(await flagged(), 3);
  assert.doesNotMatch(await t.textContent('#usc-view'), /丁/);
  assert.match(await t.textContent('#ov-att'), /3 筆<\/b>成績需要確認|3 筆成績需要確認/, '確認前總覽要提示 3 筆');
});
await step('按一筆「已確認」：剩 2 筆，移到「已確認」區，Firestore 記下單元與老師', async () => {
  await t.click('#usc-view [data-usc-ack="a1"]');
  await t.waitForFunction(() => document.querySelectorAll('#usc-view [data-usc-ack][data-on="1"]').length === 2);
  assert.equal(await acked(), 1);
  await sleep(200);
  const d = await t.evaluate(() => window.__fb.docs['acks/a1']);
  assert.equal(d.unit, 'u1'); assert.equal(d.by, 'teacher@example.com');
});
await step('全部已確認（自製對話框）：需要確認清空', async () => {
  await t.click('#usc-view [data-usc-ackall]');
  await t.waitForSelector('dialog.ask[open]');
  await t.click('dialog.ask [data-a="1"]');
  await t.waitForFunction(() => /沒有需要確認的作答/.test(document.getElementById('usc-view').textContent));
  assert.equal(await acked(), 3);
});
await step('總覽與成績卡片不再提示需要確認', async () => {
  await t.evaluate(() => { location.hash = '#overview'; }); await sleep(500);
  assert.doesNotMatch(await t.textContent('#ov-att'), /需要確認/);
  await t.evaluate(() => { location.hash = '#scores'; }); await sleep(500);
  assert.doesNotMatch(await t.textContent('#sc-view'), /需要確認/);
});
await step('取消確認：回到需要確認', async () => {
  await t.evaluate(() => { location.hash = '#unit/u1/scores'; });
  await t.waitForSelector('#usc-view details.usc-acked');
  await t.evaluate(() => { document.querySelector('#usc-view details.usc-acked').open = true; });
  await t.click('#usc-view [data-usc-ack="a2"][data-on="0"]');
  await t.waitForFunction(() => document.querySelectorAll('#usc-view [data-usc-ack][data-on="1"]').length === 1);
  assert.equal(await t.evaluate(() => window.__fb.docs['acks/a2']), undefined);
});
await step('沒有 JS 錯誤', async () => { const e = t.errors.filter((x) => !/favicon|404/.test(x)); assert.equal(e.length, 0, e.join('\n')); });
await world.close();
console.log(bad ? `${bad} 項失敗` : '已確認功能測試通過');
process.exit(bad ? 1 : 0);
