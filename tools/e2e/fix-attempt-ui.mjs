// 後台「所有作答紀錄」的修正：改到另一位學生、刪除這筆（含再確認）：node tools/e2e/fix-attempt-ui.mjs
import assert from 'node:assert';
import { startWorld, sleep } from './harness.mjs';
import { adminReady } from './admin-ui.mjs';
import { keyOf } from './gas-mock.mjs';

global.__fsDocs = new Map();
global.__vault = [{ cls: '306', seat: '20', name: '陳奕嘉' }, { cls: '306', seat: '21', name: '王小明' }];
const world = await startWorld({ scriptLatency: 50 });
const g = world.gas;
g.cacheMap.set('fn-secret', 'e2e-secret');
g.api('saveAllSettings', [[], [{ id: 'x-voc', title: 'X 單字', type: 'vocab', lesson: 1, topic: '', visible: true, disabled: [], questionCount: 4, custom: true }]]);
for (const [id, pct] of [['att-ui-1', 90], ['att-ui-2', 30]]) {
  const d = { cls: '306', seat: '20', name: '陳奕嘉', unit: 'x-voc', unitTitle: 'X 單字', mode: 'vocab', score: 1, total: 1, pct, attemptId: id, key: keyOf('306', '20', '陳奕嘉'), serverGraded: true, sig: 'e2e-secret', serverCheck: '' };
  assert.equal(g.post(d).ok, true);
  global.__fsDocs.set(`classes/306/seats/20/units/x-voc/attempts/${id}`, { cls: { stringValue: '306' }, seat: { stringValue: '20' }, name: { stringValue: '陳奕嘉' }, key: { stringValue: d.key } });
}

const t = await world.newPage(await world.newContext(), { staff: 'teacher@example.com' });
await t.goto(world.base + '/admin.html'); await adminReady(t);
await t.evaluate(() => { location.hash = '#scores'; }); await sleep(500);
const load = () => t.evaluate(() => { const src = document.getElementById('f-src'); if (src) src.value = 'sheet'; document.getElementById('load').click(); });
await load();
await t.waitForSelector('#rows [data-fix]', { state: 'attached', timeout: 15000 });
let bad = 0;
const step = async (n, f) => { try { await f(); console.log('✓', n); } catch (e) { bad++; console.log('✗', n, '\n  ', String(e.message).split('\n')[0]); } };
const rowOf = (id) => g.ss.getSheetByName('scores').rows.find((r) => r[17] === id);
const openFix = async (id) => {
  const i = await t.evaluate((pct) => [...document.querySelectorAll('#rows tr')].findIndex((tr) => tr.children[6] && tr.children[6].textContent === String(pct)), id === 'att-ui-1' ? 90 : 30);
  await t.evaluate((i) => document.querySelectorAll('#rows tr')[i].querySelector('[data-fix]').click(), i);
  await t.waitForSelector('dialog.fix-dlg[open]');
};

await step('改到另一位學生：選名單上的人才按得下去，改完表格重新載入', async () => {
  await openFix('att-ui-1');
  assert.equal(await t.$eval('dialog.fix-dlg [data-a="move"]', (b) => b.disabled), true, '還沒選人不能按');
  await t.fill('dialog.fix-dlg .ask-in', '王');
  await t.waitForSelector('dialog.fix-dlg .pick button[data-seat="21"]');
  assert.equal(await t.$$eval('dialog.fix-dlg .pick button[data-seat="20"]', (a) => a.length), 0, '名單不列出原本的學生');
  await t.dispatchEvent('dialog.fix-dlg .pick button[data-seat="21"]', 'mousedown');
  await t.click('dialog.fix-dlg [data-a="move"]');
  await t.waitForFunction(() => !document.querySelector('dialog.fix-dlg') && /已把/.test(document.getElementById('smsg').textContent), null, { timeout: 15000 });
  assert.deepEqual(rowOf('att-ui-1').slice(1, 4), ['306', '21', '王小明']);
  assert.ok(global.__fsDocs.has('classes/306/seats/21/units/x-voc/attempts/att-ui-1'));
});

await step('刪除這筆：要再確認一次，取消就不刪', async () => {
  await t.waitForFunction(() => document.querySelectorAll('#rows [data-fix]').length === 2, null, { timeout: 15000 });
  await openFix('att-ui-2');
  await t.click('dialog.fix-dlg [data-a="del"]');
  await t.waitForSelector('dialog.ask:not(.fix-dlg)[open]');
  await t.click('dialog.ask:not(.fix-dlg)[open] [data-a="0"]'); await sleep(300);
  assert.ok(rowOf('att-ui-2'), '取消後還在');
  await t.click('dialog.fix-dlg [data-a="del"]');
  await t.waitForSelector('dialog.ask:not(.fix-dlg)[open]');
  await t.click('dialog.ask:not(.fix-dlg)[open] [data-a="1"]');
  await t.waitForFunction(() => !document.querySelector('dialog.fix-dlg') && /已刪除/.test(document.getElementById('smsg').textContent), null, { timeout: 15000 });
  assert.equal(rowOf('att-ui-2'), undefined);
  assert.ok(!global.__fsDocs.has('classes/306/seats/20/units/x-voc/attempts/att-ui-2'));
});

await step('沒有 JS 錯誤', async () => { assert.deepEqual(t.errors, []); });
await world.close();
if (bad) { console.log(bad + ' 項失敗'); process.exit(1); }
console.log('後台成績修正測試通過');
process.exit(0);
