// 拼字題按「提示」：手機上鍵盤收著時不會自己跳出來；鍵盤開著時保持開著；電腦上游標回到輸入框：node tools/e2e/spell-hint.mjs
import assert from 'node:assert';
import { startWorld } from './harness.mjs';

const world = await startWorld();
let bad = 0;
const step = async (n, f) => { try { await f(); console.log('✓', n); } catch (e) { bad++; console.log('✗', n, '\n  ', String(e.message).split('\n')[0]); } };
const open = async (opts) => {
  const p = await (await world.newContext(opts)).newPage();
  await p.goto(world.base + '/tools/e2e/spell-preview.html'); await p.waitForSelector('.case [data-hint]');
  return p;
};
const focused = (p) => p.evaluate(() => !!document.activeElement && document.activeElement.matches('.case:first-child .spell-input'));
const sel = '.case:first-child [data-hint]';

const phone = await open({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
await step('手機：鍵盤收著時按提示，不會把鍵盤叫出來', async () => {
  await phone.evaluate(() => document.activeElement && document.activeElement.blur());
  await phone.tap(sel);
  assert.equal(await phone.evaluate(() => document.querySelector('.case:first-child .spell-input').value.length), 1, '有給一個字母');
  assert.equal(await focused(phone), false);
});
await step('手機：正在打字（鍵盤開著）時按提示，輸入框保持焦點', async () => {
  await phone.focus('.case:first-child .spell-input');
  await phone.tap(sel);
  assert.equal(await focused(phone), true);
});
const desk = await open({ viewport: { width: 1280, height: 800 } });
await step('電腦：按提示後游標回到輸入框，可以直接接著打', async () => {
  await desk.click(sel);
  assert.equal(await focused(desk), true);
});
await world.close();
if (bad) { console.log(bad + ' 項失敗'); process.exit(1); }
console.log('拼字提示測試通過');
process.exit(0);
