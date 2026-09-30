// 量測「按下儲存」到各個階段的時間：node tools/e2e/timing.mjs
import { startWorld, sleep } from './harness.mjs';
const world = await startWorld({ scriptLatency: 1200 });
const g = world.gas;
g.api('saveAllSettings', [[], [
  { id: 'a-voc', title: 'A', type: 'vocab', lesson: 1, topic: '', visible: true, disabled: [], questionCount: 5, custom: true },
  { id: 'b-voc', title: 'B', type: 'vocab', lesson: 2, topic: '', visible: true, disabled: [], questionCount: 5, custom: true },
]]);
const words = ['a1', 'b2', 'c3', 'd4', 'e5'].map((w) => ({ word: w, pos: 'n.', zh: '字', example: `I [${w}] it.`, exampleZh: '我。' }));
['a-voc', 'b-voc'].forEach((id) => g.api('saveContent', [id, { topic: 't', words }, true]));
const ctx = await world.newContext();
const student = await world.newPage(ctx, { student: true });
await student.goto(world.base + '/'); await student.waitForSelector('.unit-tile');
await student.evaluate(() => {
  window.__log = [];
  const op = window.__fb.push;
  window.__fb.push = (p, d) => { { let j = {}; try { j = JSON.parse(d.json); } catch {} window.__log.push(['push', p, Math.round(performance.now()), j.units && j.units['a-voc'] && j.units['a-voc'].visible, String(j.updated).slice(17, 23)]); } return op(p, d); };
  window.addEventListener('config-updated', (e) => window.__log.push(['event', Math.round(performance.now()), e.detail.units['a-voc'].visible]));
});
const teacher = await world.newPage(ctx, { staff: 'teacher@example.com' });
await teacher.goto(world.base + '/admin.html'); await teacher.waitForSelector('#units tr[data-i]');
await teacher.evaluate(() => {
  window.__t = [];
  const mark = (k) => window.__t.push([k, Math.round(performance.now())]);
  const of = window.fetch; window.fetch = function (u, o) { if (String(u).includes(':commit')) { mark('fetch-start'); return of.apply(this, arguments).then((r) => { mark('fetch-end'); return r; }); } return of.apply(this, arguments); };
  document.getElementById('save').addEventListener('click', () => mark('click-handler'), true);
});
for (let i = 0; i < 4; i++) {
  const box = teacher.locator('#units tr[data-i]').first().locator('input[data-k="visible"]');
  if (i % 2 === 0) await box.uncheck(); else await box.check();
  await teacher.evaluate(() => { window.__t.length = 0; });
  await student.evaluate(() => { window.__seen = null; window.addEventListener('config-updated', () => { window.__seen = Math.round(performance.now()); }, { once: true }); });
  const t0 = Date.now();
  await teacher.evaluate(() => document.getElementById('save').click()); // 直接觸發，排除 Playwright 點擊前的等待
  await student.waitForFunction(() => window.__seen !== null, null, { polling: 10 });
  const seenMs = Date.now() - t0;
  const tt = await teacher.evaluate(() => window.__t);
  const sl = await student.evaluate(() => { const l = window.__log.splice(0); return l; });
  console.log('   學生端事件', JSON.stringify(sl), '學生 now=', await student.evaluate(() => Math.round(performance.now())));
  await teacher.waitForFunction(() => /^✓ 已儲存/.test(document.getElementById('msg').textContent));
  console.log(`第 ${i + 1} 次：學生收到 ${seenMs}ms；老師端事件 ${JSON.stringify(tt)}`);
  await sleep(300);
}
await world.close();
