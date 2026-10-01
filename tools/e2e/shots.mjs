// 各畫面截圖（給人眼檢查版面）：node tools/e2e/shots.mjs [輸出資料夾]
import { startWorld, sleep } from './harness.mjs';
const out = process.argv[2] || '/tmp/shots';
const world = await startWorld({ scriptLatency: 200 });
const g = world.gas;
g.api('saveAllSettings', [[], [
  { id: 'l1-voc', title: 'L1 單字片語', type: 'vocab', lesson: 1, topic: '', visible: true, disabled: [], questionCount: 4, custom: true },
  { id: 'l1-reading', title: 'L1 課文理解', type: 'reading', lesson: 1, topic: '', visible: true, disabled: [], questionCount: 5, custom: true, closeAt: '2099-01-01T00:00' },
  { id: 'l2-voc', title: 'L2 單字片語', type: 'vocab', lesson: 2, topic: '', visible: true, disabled: [], questionCount: 4, custom: true, openAt: '2099-01-01T08:00' },
]]);
const words = ['apple', 'bread', 'candy', 'dance', 'eagle', 'flame'].map((w, i) => ({ word: w, pos: 'n.', zh: '中文' + i, example: `I like [${w}] a lot.`, exampleZh: '我很喜歡。' }));
g.api('saveContent', ['l1-voc', { topic: 'Food and Drink', words }, true]);
g.api('saveContent', ['l2-voc', { topic: 'Sports', words }, true]);
g.api('saveContent', ['l1-reading', { title: 'Tea', topic: "Mia's Second Try", passage: ['Tea is a drink made from leaves. People all over the world enjoy it every day.', 'It can be hot or cold, sweet or plain.'], questions: [
  { ref: '1-1', skill: '細節', q: 'What is tea made from?', options: ['Leaves', 'Rocks', 'Milk', 'Sand'], answer: 0, explain: '第一句。', ref: '1-1', key: 'made from leaves' },
  { ref: '1-1', skill: '主旨', q: 'Who enjoys tea?', options: ['Nobody', 'Only kids', 'People worldwide', 'Cats'], answer: 2, explain: '第二句。' },
] }, true]);
for (const [name, w, h] of [['m', 390, 844], ['d', 1280, 800]]) {
  const ctx = await world.newContext({ viewport: { width: w, height: h } });
  const shot = async (p, label) => { await sleep(500); await p.screenshot({ path: `${out}/${name}-${label}.png`, fullPage: true }); };
  const nostu = await world.newPage(ctx);
  await nostu.goto(world.base + '/'); await nostu.waitForSelector('.welcome'); await shot(nostu, '1-login');
  const p = await world.newPage(ctx, { student: true });
  await p.goto(world.base + '/'); await p.waitForSelector('.unit-tile'); await shot(p, '2-home');
  await p.goto(world.base + '/#/u/l1-voc'); await p.waitForSelector('#stage'); await shot(p, '3-vocab-gate');
  await p.goto(world.base + '/#/u/l1-reading'); await p.waitForSelector('#stage'); await shot(p, '4-reading-gate');
  await p.goto(world.base + '/#/privacy'); await shot(p, '5-privacy');
  await p.goto(world.base + '/#/teacher'); await shot(p, '6-teacher-login');
  await p.goto(world.base + '/#/diag'); await shot(p, '7-diag');
  const t = await world.newPage(ctx, { staff: 'teacher@example.com' });
  await t.goto(world.base + '/admin.html'); await t.waitForSelector('#units tr[data-i]'); await shot(t, '8-admin-settings');
  for (const tab of ['import', 'roster', 'scores', 'semester']) { await t.click(`nav button[data-tab="${tab}"]`); await shot(t, `9-admin-${tab}`); }
  await ctx.close();
}
await world.close();
console.log('done');
