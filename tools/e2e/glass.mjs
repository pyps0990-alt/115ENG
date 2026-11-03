// 後台液態玻璃的拖拉手感（手機版）：選取膠囊、儲存列拉了有極限、放開彈回；「更多」選單、確認視窗往下拉會關閉：node tools/e2e/glass.mjs
import assert from 'node:assert';
import { startWorld, sleep } from './harness.mjs';

const world = await startWorld({ scriptLatency: 30 });
world.gas.api('saveAllSettings', [[], [{ id: 'l1-voc', title: 'L1 單字', type: 'vocab', lesson: 1, topic: '', visible: true, disabled: [], questionCount: 4, custom: true }]]);
let bad = 0;
const step = async (n, f) => { try { await f(); console.log('✓', n); } catch (e) { bad++; console.log('✗', n, '\n  ', e.message.split('\n')[0]); } };
const ctx = await world.newContext({ viewport: { width: 390, height: 844 } });
const p = await world.newPage(ctx, { staff: 'teacher@example.com' });
await p.goto(world.base + '/admin.html'); await p.waitForSelector('#app-root:not([hidden])', { timeout: 15000 }); await sleep(1000);
const ty = (sel) => p.evaluate((s) => { const t = getComputedStyle(document.querySelector(s)).translate; return t === 'none' ? 0 : parseFloat(t.split(' ')[1] || '0'); }, sel);
const drag = async (x, y, dx, dy, holdCheck) => {
  await p.mouse.move(x, y); await p.mouse.down();
  for (let i = 1; i <= 10; i++) { await p.mouse.move(x + (dx * i) / 10, y + (dy * i) / 10); await sleep(16); }
  const mid = holdCheck ? await holdCheck() : null;
  await p.mouse.up(); return mid;
};

await step('選取膠囊往上拉、往兩端外拖：只有膠囊動（有極限），分頁列不動，放開彈回、不切換分頁', async () => {
  await p.evaluate(() => { location.hash = '#overview'; }); await sleep(600);
  const b = await p.locator('.rail a[data-view="overview"]').boundingBox();
  const before = await p.evaluate(() => location.hash);
  const inkY = () => p.evaluate(() => new DOMMatrix(getComputedStyle(document.querySelector('.lg-ink')).transform).m42);
  const inkX = () => p.evaluate(() => new DOMMatrix(getComputedStyle(document.querySelector('.lg-ink')).transform).m41);
  const x0 = await inkX();
  const mid = await drag(b.x + b.width / 2, b.y + b.height / 2, 0, -200, async () => { await sleep(250); return { ink: await inkY(), rail: await ty('.rail') }; });
  assert.ok(mid.ink < -5 && mid.ink > -17, `膠囊拉 200px 只能移動不到 16px，實際 ${mid.ink}`);
  assert.equal(Math.round(mid.rail), 0, '分頁列本身不能動');
  await sleep(900);
  assert.ok(Math.abs(await inkY()) < 1, '放開要彈回原位');
  assert.equal(await p.evaluate(() => location.hash), before, '上下拉不能切換分頁');
  const left = await drag(b.x + b.width / 2, b.y + b.height / 2, -150, 0, async () => { await sleep(250); return inkX(); });
  assert.ok(left < x0 && left > x0 - 26, `往左拖出界只能多走不到 22px，實際 ${left - x0}`);
  await sleep(900);
  assert.ok(Math.abs((await inkX()) - x0) < 1.5, '放開回到目前分頁');
});
await step('分頁列橫向拖曳（原本的膠囊）照樣可以切換分頁', async () => {
  const a = await p.locator('.rail a[data-view="overview"]').boundingBox();
  const c = await p.locator('.rail a[data-view="scores"]').boundingBox();
  await p.evaluate(() => { location.hash = '#overview'; }); await sleep(500);
  await drag(a.x + a.width / 2, a.y + a.height / 2, c.x - a.x, 0);
  await p.waitForFunction(() => location.hash === '#scores', null, { timeout: 3000 });
});
await step('「更多」選單往上拉有極限、往下拉就關閉', async () => {
  await p.click('#rail-more'); await sleep(600);
  const b = await p.locator('#m-sheet .m-panel').boundingBox();
  const mid = await drag(b.x + 30, b.y + 20, 0, -150, () => ty('#m-sheet .m-panel'));
  assert.ok(mid < 0 && mid > -25, `往上拉有極限，實際 ${mid}`);
  await sleep(700);
  assert.equal(await p.evaluate(() => document.getElementById('m-sheet').hidden), false, '往上拉不會關閉');
  await drag(b.x + 30, b.y + 20, 0, 160);
  await p.waitForFunction(() => document.getElementById('m-sheet').hidden, null, { timeout: 3000 });
});
await step('確認視窗往下拉＝取消', async () => {
  const r = p.evaluate(() => window.ask('測試確認？\n往下拉會取消', { danger: false }));
  await p.waitForSelector('dialog.ask[open]'); await sleep(400);
  const b = await p.locator('dialog.ask').boundingBox();
  await drag(b.x + b.width / 2, b.y + 20, 0, 180);
  assert.equal(await r, false);
  await sleep(300);
  assert.equal(await p.locator('dialog.ask').count(), 0);
});
await step('儲存列：拖了會跟著走一點，放開彈回，不會誤按儲存', async () => {
  await p.evaluate(() => { location.hash = '#unit/l1-voc/settings'; }); await sleep(800);
  await p.evaluate(() => { const cb = document.querySelector('#us-form [data-us-k="visible"]'); cb.click(); });
  await p.waitForSelector('#savebar.on'); await sleep(500);
  const b = await p.locator('#savebar-save').boundingBox();
  const saves = await p.evaluate(() => { window.__saves = 0; document.getElementById('save').addEventListener('click', () => window.__saves++, true); return 0; });
  void saves;
  const mid = await drag(b.x + b.width / 2, b.y + b.height / 2, 120, -120, () => p.evaluate(() => getComputedStyle(document.getElementById('savebar')).translate));
  assert.notEqual(mid, 'none', '拖動中要跟著走');
  await sleep(800);
  assert.equal(await p.evaluate(() => getComputedStyle(document.getElementById('savebar')).translate), 'none', '放開要彈回');
  assert.equal(await p.evaluate(() => window.__saves), 0, '拖完不能誤按儲存');
});
await step('沒有 JS 錯誤', async () => { const e = p.errors.filter((x) => !/favicon|404/.test(x)); assert.equal(e.length, 0, e.join('\n')); });
await world.close();
console.log(bad ? `${bad} 項失敗` : '液態玻璃拖拉測試通過');
process.exit(bad ? 1 : 0);
