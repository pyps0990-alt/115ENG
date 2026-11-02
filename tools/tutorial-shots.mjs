// 產生後台「教學」頁用的截圖（假資料，不含真實學生）：node tools/tutorial-shots.mjs
// 後台畫面改版後重跑一次，圖會存到 img/tutorial/，再部署網站即可。
import fs from 'node:fs';
import path from 'node:path';
import { startWorld, sleep } from './e2e/harness.mjs';

const OUT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'img', 'tutorial');
fs.mkdirSync(OUT, { recursive: true });
const world = await startWorld({ scriptLatency: 30 });
const g = world.gas;
const unit = (id, title, type, lesson, extra = {}) => ({ id, title, type, lesson, topic: '', visible: true, disabled: [], questionCount: 10, custom: true, ...extra });
g.api('saveAllSettings', [[], [
  unit('l3-voc', 'L3 單字片語', 'vocab', 3, { closeAt: '2026-12-20T23:59' }),
  unit('l3-read', 'L3 課文理解', 'reading', 3),
  unit('l4-voc', 'L4 單字片語', 'vocab', 4),
]]);
const words = [['resilient', 'adj.', '有韌性的'], ['adapt', 'v.', '適應'], ['setback', 'n.', '挫折'], ['bounce back', 'phr.', '恢復過來'], ['persevere', 'v.', '堅持不懈'], ['obstacle', 'n.', '障礙']]
  .map(([w, pos, zh]) => ({ word: w, pos, zh, example: `She stayed [${w}] after the game.`, exampleZh: '例句翻譯。' }));
g.api('saveContent', ['l3-voc', { topic: 'Resilience', words }, true]);
g.api('saveContent', ['l3-read', { title: "Mia's Second Try", topic: 'Resilience', passage: ['Mia failed her first audition.', 'She practiced every day and tried again.'], questions: [{ ref: '1-1', skill: '細節', q: 'What happened at the first audition?', options: ['She failed', 'She won'], answer: 0, explain: '第一段第一句。' }] }, true]);
const names = ['王小明', '李小華', '陳怡君', '林冠宇', '張家豪', '黃詩涵', '吳承恩', '劉雅婷'];

const ctx = await world.newContext({ viewport: { width: 1280, height: 820 }, deviceScaleFactor: 2 });
const p = await world.newPage(ctx, { staff: 'teacher@example.com' });
await p.addInitScript((names) => {
  window.liveDemo = true; // 即時監控用示範資料（不連資料庫）
  const now = Date.now();
  window.__fb = window.__fb || {};
  window.__fb.attempts = names.flatMap((n, i) => [{ id: 'a' + i, attemptId: 'a' + i, cls: i < 5 ? '306' : '307', seat: String(i + 1), name: n, unit: 'l3-voc', unitTitle: 'L3 單字片語', mode: 'vocab',
    pct: [92, 58, 81, 100, 44, 76, 88, 63][i], score: 8, total: 10, review: false, serverGraded: true, check: i === 1 ? '作答時間過短' : i === 4 ? '離開作答畫面 3 次（共 42 秒）' : '', wrong: ['setback', 'persevere'].slice(0, i % 3), createdAt: { toMillis: () => now - (i + 1) * 3600000 } }]);
}, names);
await p.goto(world.base + '/admin.html');
await p.waitForSelector('#app-root:not([hidden])', { timeout: 15000 });
await sleep(1500);
await p.addStyleTag({ content: '.tour-ring, .tour-card { display:none !important; } *, *::before, *::after { animation-duration:0s !important; transition-duration:0s !important; }' });

const go = async (hash, wait = 900) => { await p.evaluate((h) => { location.hash = h; }, hash); await sleep(wait); };
// 截某個區塊（四周留一點空白）；找不到就截整個畫面
const shot = async (name, sel, pad = 14) => {
  const file = path.join(OUT, name + '.jpg');
  const el = sel ? await p.$(sel) : null;
  if (el) {
    await el.scrollIntoViewIfNeeded().catch(() => {});
    await sleep(200);
    const b = await el.boundingBox();
    const vp = p.viewportSize();
    const clip = { x: Math.max(0, b.x - pad), y: Math.max(0, b.y - pad), width: Math.min(vp.width, b.width + pad * 2), height: Math.min(vp.height - Math.max(0, b.y - pad), b.height + pad * 2) };
    await p.screenshot({ path: file, type: 'jpeg', quality: 70, clip });
  } else {
    if (sel) console.warn('找不到', sel, '，改截整個畫面');
    await p.screenshot({ path: file, type: 'jpeg', quality: 70 });
  }
  console.log('✓', name);
};

await go('#overview'); await shot('overview', null);
await go('#units'); await shot('new-unit', '#nu2 section');
await go('#unit/l4-voc/content'); await shot('content-ways', '.uc-empty');
await go('#unit/l3-voc/content'); await p.click('[data-uc="edit"]'); await sleep(900);
await shot('ai-vocab', '#imp-vocab .bar');
await p.evaluate(() => { const bar = document.getElementById('imp-check').closest('.bar'); bar.id = 'imp-bar-shot'; });
await shot('check-save', '#imp-bar-shot');
await go('#unit/l3-voc/settings'); await shot('unit-open', '#us-form section');
await go('#unit/l3-voc/makeup'); await shot('makeup', '[data-utab-pane="makeup"] .card');
await go('#scores', 1500); await shot('scores', '#sc-view section');
await go('#unit/l3-voc/scores', 1500); await shot('unit-scores', '#usc-view');
await p.evaluate(() => { const h = [...document.querySelectorAll('#usc-view h2')].find((x) => x.textContent.startsWith('需要確認')); if (h) h.closest('section').id = 'flag-shot'; });
await shot('needs-check', '#flag-shot');
await go('#students', 1200); await p.evaluate(() => { const d = document.getElementById('st-import'); if (d) d.open = true; }); await sleep(300);
await shot('roster', '#st-import');
await go('#live', 1500); await shot('live', '[data-pane-view="live"]');
await go('#settings', 1200); await shot('settings-ai', '#ai-box');
await p.evaluate(() => { const b = document.getElementById('sem-backup'); if (b) b.closest('.card, section').id = 'sem-shot'; });
await shot('semester', '#sem-shot');
await world.close();
const files = fs.readdirSync(OUT);
console.log(`完成：${files.length} 張，共 ${Math.round(files.reduce((a, f) => a + fs.statSync(path.join(OUT, f)).size, 0) / 1024)} KB`);
