// iPad（WebKit）：單字作答的底部橫幅要貼齊整個螢幕底部、滿版寬（不能被頁面進場動畫卡在內容寬度）。需要 xvfb：xvfb-run -a node tools/e2e/wk-ipad.mjs
import assert from 'node:assert';
import { startWorld, startBrowser, sleep } from './wk-harness.mjs';
const world = await startWorld();
const g = world.gas;
g.api('saveAllSettings', [[], [{ id: 'l5-voc', title: 'L5單字片語', type: 'vocab', lesson: 5, topic: 'T', visible: true, disabled: [], questionCount: 14, custom: true }]]);
const words = ['commerce', 'overall', 'outlook', 'elevator', 'egg', 'fig', 'grape', 'honey'].map((w) => ({ word: w, pos: 'n.', zh: '字' + w, example: `I [${w}] it.`, exampleZh: '我。' }));
g.api('saveContent', ['l5-voc', { topic: 'Food', words }, true]);
const b = await startBrowser({ width: 1000, height: 685 });
let bad = 0;
const step = async (n, f) => { try { await f(); console.log('✓', n); } catch (e) { bad++; console.log('✗', n, '\n  ', String(e.message).split('\n')[0]); } };
const box = () => b.js(() => { const d = document.querySelector('.q-dock'); if (!d) return null; const r = d.getBoundingClientRect(); return { l: Math.round(r.left), w: Math.round(r.width), bottom: Math.round(innerHeight - r.bottom), vw: innerWidth, inBody: d.parentElement === document.body }; });
await b.go(world.base + '/#/u/l5-voc'); await b.wait(() => document.querySelector('[data-start]')); await sleep(1500);
await step('開始作答的動畫中、動畫後：底部橫幅都滿版、貼齊底部', async () => {
  await b.js(() => { document.querySelector('[data-start]').click(); return 1; });
  await b.wait(() => document.querySelector('.q-dock'));
  const seen = [];
  for (let i = 0; i < 6; i++) { seen.push(await box()); await sleep(150); }
  for (const d of seen) { assert.equal(d.l, 0, JSON.stringify(d)); assert.equal(d.w, d.vw, JSON.stringify(d)); assert.equal(d.bottom, 0, JSON.stringify(d)); }
  assert.ok(seen[0].inBody, '放在 body 底下');
});
await step('離開測驗：底部橫幅一起移除', async () => {
  await b.js(() => { delete document.body.dataset.busy; location.hash = '#/'; return 1; });
  await b.wait(() => document.querySelector('.unit-tile')); await sleep(600);
  assert.equal(await b.js(() => document.querySelectorAll('.q-dock').length), 0);
});
await b.close?.(); await world.close?.();
if (bad) { console.log(bad + ' 項失敗'); process.exit(1); }
console.log('iPad 底部橫幅測試通過');
process.exit(0);
