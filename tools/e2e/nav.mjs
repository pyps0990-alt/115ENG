// 導覽列、登入回饋、動畫效能的檢查：node tools/e2e/nav.mjs
import assert from 'node:assert';
import { startWorld, sleep } from './harness.mjs';
const world = await startWorld({ scriptLatency: 100 });
const g = world.gas;
const units = Array.from({ length: 8 }, (_, i) => ({ id: `u${i}-voc`, title: `U${i}`, type: 'vocab', lesson: 1 + Math.floor(i / 2), topic: '', visible: true, disabled: [], questionCount: 4, custom: true }));
g.api('saveAllSettings', [[], units]);
const words = ['a1', 'b2', 'c3', 'd4', 'e5', 'f6'].map((w) => ({ word: w, pos: 'n.', zh: '字', example: `I [${w}] it.`, exampleZh: '我。' }));
units.forEach((u) => g.api('saveContent', [u.id, { topic: 'Topic ' + u.id, words }, true]));
const results = [];
const step = async (name, fn) => { try { await fn(); console.log('✓', name); results.push(1); } catch (e) { console.log('✗', name, '\n  ', String(e.message).split('\n').join('\n   ')); results.push(0); } };

const ctx = await world.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

// ---------- 首次來訪：設定很慢也要先看到登入表單 ----------
await step('首次來訪：老師的設定 4 秒才回來，登入表單仍在 2 秒內出現，設定到了再更新', async () => {
  world.firestoreDelay = 4000;
  const c0 = await world.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const p0 = await world.newPage(c0);
  const t0 = Date.now();
  await p0.goto(world.base + '/');
  await p0.waitForSelector('.welcome', { timeout: 8000 });
  const ms = Date.now() - t0;
  world.firestoreDelay = 0;
  console.log('   登入表單出現：', ms, 'ms');
  assert.ok(ms < 2500, `等太久：${ms}ms`);
  assert.equal(await p0.evaluate(() => document.getElementById('app').className.includes('page-in')), false, '第一次畫面不做進場動畫');
  await p0.close();
});

// ---------- 登入回饋 ----------
await step('登入：按鈕依序顯示「確認中 → 已確認」，成功後才換頁；沒有紅字', async () => {
  const c1 = await world.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const p = await world.newPage(c1);
  await p.goto(world.base + '/'); await p.waitForSelector('.welcome');
  await p.evaluate(() => {
    window.__states = [];
    const btn = document.querySelector('.welcome [type="submit"]');
    new MutationObserver(() => window.__states.push([btn.dataset.state || 'idle', btn.textContent.trim(), Math.round(performance.now())])).observe(btn, { attributes: true, childList: true, subtree: true });
  });
  await p.fill('#f-cls', '306'); await p.fill('#f-seat', '20'); await p.fill('#f-name', '陳奕嘉');
  const t0 = Date.now();
  await p.click('.welcome [type="submit"]');
  await p.waitForSelector('.unit-tile', { timeout: 8000 });
  const total = Date.now() - t0;
  const states = await p.evaluate(() => window.__states);
  const seq = [...new Set(states.map((x) => x[0]))];
  console.log('   狀態順序：', seq.join(' → '), '；從按下到看到單元：', total, 'ms');
  assert.deepEqual(seq.slice(0, 2), ['busy', 'ok']);
  assert.ok(states.some((x) => /已確認，歡迎/.test(x[1])));
  assert.ok(total >= 400 && total < 2000, `停留時間不合理：${total}ms`);
  const chip = await p.evaluate(() => !document.getElementById('student-chip').hidden);
  assert.ok(chip);
  await p.close();
});
await step('登入失敗：按鈕輕抖、提示為琥珀色小字（不是紅色），輸入後自動消失', async () => {
  const c2 = await world.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const p = await world.newPage(c2);
  await p.addInitScript(() => { window.__fb = window.__fb || {}; window.__fb.allowedKey = 'nobody'; });
  await p.goto(world.base + '/'); await p.waitForSelector('.welcome');
  await p.fill('#f-cls', '306'); await p.fill('#f-seat', '20'); await p.fill('#f-name', '不存在');
  await p.click('.welcome [type="submit"]');
  await p.waitForFunction(() => document.querySelector('.form-err').textContent.length > 0);
  const info = await p.evaluate(() => { const b = document.querySelector('.welcome [type="submit"]'); return { shake: b.classList.contains('shake'), disabled: b.disabled, color: getComputedStyle(document.querySelector('.form-err')).color, text: b.textContent.trim() }; });
  console.log('   ', JSON.stringify(info));
  assert.ok(info.shake && !info.disabled);
  assert.notEqual(info.color, 'rgb(153, 27, 27)');
  assert.match(info.text, /確認/);
  await p.fill('#f-name', '陳'); 
  await p.waitForFunction(() => document.querySelector('.form-err').textContent === '');
  await p.close();
});

// ---------- 導覽列 ----------
const p = await world.newPage(ctx, { student: true });
await p.goto(world.base + '/'); await p.waitForSelector('.unit-tile');
await sleep(600);
await step('導覽列高度固定：捲動前後高度相同，頁面總高度不變', async () => {
  const before = await p.evaluate(() => ({ h: document.querySelector('.topbar').getBoundingClientRect().height, doc: document.documentElement.scrollHeight }));
  await p.evaluate(() => window.scrollTo(0, 600)); await sleep(700);
  const after = await p.evaluate(() => ({ h: document.querySelector('.topbar').getBoundingClientRect().height, doc: document.documentElement.scrollHeight, cls: document.body.classList.contains('scrolled') }));
  console.log('   ', JSON.stringify({ before, after }));
  assert.ok(after.cls, '捲動後要收起 B5');
  assert.equal(after.h, before.h);
  assert.equal(after.doc, before.doc);
});
await step('B5 收起：選單按鈕往左平移補位（transform），B5 淡出', async () => {
  const r = await p.evaluate(() => { const m = document.getElementById('unit-menu-btn'); const b = document.querySelector('.brand'); return { mx: m.getBoundingClientRect().x, brandOp: getComputedStyle(b).opacity, brandVis: getComputedStyle(b).visibility, tf: getComputedStyle(m).transform }; });
  console.log('   ', JSON.stringify(r));
  assert.equal(r.brandOp, '0'); assert.equal(r.brandVis, 'hidden');
  assert.ok(r.mx < 30, `選單按鈕應該移到最左邊，實際 x=${r.mx}`);
  await p.evaluate(() => window.scrollTo(0, 0)); await sleep(700);
  const back = await p.evaluate(() => ({ mx: document.getElementById('unit-menu-btn').getBoundingClientRect().x, op: getComputedStyle(document.querySelector('.brand')).opacity }));
  assert.ok(back.mx > 50 && back.op === '1', JSON.stringify(back));
});
await step('快速來回滑動：狀態不會亂閃、沒有版面位移', async () => {
  await p.evaluate(() => {
    window.__flips = 0; window.__cls = 0;
    new MutationObserver(() => { window.__flips++; }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
    new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: 'layout-shift', buffered: false });
  });
  for (let i = 0; i < 12; i++) { await p.evaluate((y) => window.scrollTo(0, y), i % 2 ? 0 : 700); await sleep(45); }
  await sleep(900);
  const r = await p.evaluate(() => ({ flips: window.__flips, cls: window.__cls, scrolled: document.body.classList.contains('scrolled'), y: scrollY }));
  console.log('   ', JSON.stringify(r));
  assert.ok(r.flips <= 8, `狀態切換 ${r.flips} 次`);
  assert.ok(r.cls < 0.01, `版面位移 ${r.cls}`);
  assert.equal(r.scrolled, r.y > 40, '最後狀態要和捲動位置一致');
});
await step('選單面板：打開／關閉都有過場，關閉後不可見也不會被點到', async () => {
  await p.evaluate(() => window.scrollTo(0, 0)); await sleep(500);
  await p.click('#unit-menu-btn');
  await sleep(120);
  const mid = await p.evaluate(() => Number(getComputedStyle(document.getElementById('unit-menu')).opacity));
  await sleep(500);
  const open = await p.evaluate(() => { const m = document.getElementById('unit-menu'); return { op: getComputedStyle(m).opacity, vis: getComputedStyle(m).visibility, items: m.querySelectorAll('.menu-item').length }; });
  assert.ok(mid > 0 && mid < 1, `展開中途 opacity=${mid}（應該在過場中）`);
  assert.equal(open.vis, 'visible'); assert.equal(open.op, '1');
  await p.click('#unit-menu-btn');
  await sleep(90);
  const midClose = await p.evaluate(() => Number(getComputedStyle(document.getElementById('unit-menu')).opacity));
  await sleep(400);
  const closed = await p.evaluate(() => { const m = document.getElementById('unit-menu'); return { op: getComputedStyle(m).opacity, vis: getComputedStyle(m).visibility, pe: getComputedStyle(m).pointerEvents }; });
  console.log('   中途', mid.toFixed(2), '收合中', midClose.toFixed(2), JSON.stringify(closed));
  assert.ok(midClose > 0 && midClose < 1, `收合中途 opacity=${midClose}`);
  assert.deepEqual(closed, { op: '0', vis: 'hidden', pe: 'none' });
});
await step('捲動後開啟選單：面板對齊按鈕', async () => {
  await p.evaluate(() => window.scrollTo(0, 700)); await sleep(800);
  await p.click('#unit-menu-btn'); await sleep(500);
  const r = await p.evaluate(() => { const m = document.getElementById('unit-menu').getBoundingClientRect(); return { x: m.x, right: m.right, w: innerWidth }; });
  assert.ok(r.x >= 0 && r.right <= r.w, JSON.stringify(r));
  await p.click('#unit-menu-btn'); await sleep(400);
});
await step('換頁：首頁 ↔ 單元有進場動畫且方向不同', async () => {
  await p.evaluate(() => window.scrollTo(0, 0)); await sleep(200);
  await p.click('.unit-tile'); await p.waitForSelector('#stage');
  const fwd = await p.evaluate(() => document.getElementById('app').dataset.dir);
  await p.click('.back'); await p.waitForSelector('.unit-tile');
  const back = await p.evaluate(() => document.getElementById('app').dataset.dir);
  assert.equal(fwd, 'fwd'); assert.equal(back, 'back');
});
await step('考試中：B5 固定、顯示計時與目前單元、名牌與單元選單隱藏；結束後恢復', async () => {
  await p.evaluate(() => window.scrollTo(0, 0)); await sleep(300);
  await p.click('.unit-tile'); await p.waitForSelector('[data-start]'); await p.click('[data-start]'); await p.waitForSelector('.q-card');
  await sleep(1300);
  await p.evaluate(() => window.scrollTo(0, 900)); await sleep(700);
  const r = await p.evaluate(() => ({ exam: document.body.classList.contains('exam'), scrolled: document.body.classList.contains('scrolled'), brandOp: getComputedStyle(document.querySelector('.brand')).opacity,
    timer: document.getElementById('exam-timer').textContent, unit: document.getElementById('exam-unit').textContent,
    menu: getComputedStyle(document.getElementById('nav-menu')).display, chip: getComputedStyle(document.getElementById('student-chip')).display }));
  console.log('   ', JSON.stringify(r));
  assert.ok(r.exam && !r.scrolled && r.brandOp === '1');
  assert.match(r.timer, /^0?\d+:\d\d$/); assert.notEqual(r.timer, '0:00');
  assert.match(r.unit, /^L\d 單字片語$/);
  assert.equal(r.menu, 'none'); assert.equal(r.chip, 'none');
  await p.evaluate(() => { delete document.body.dataset.busy; location.hash = '#/'; }); await sleep(600);
  assert.equal(await p.evaluate(() => document.body.classList.contains('exam')), false);
  assert.notEqual(await p.evaluate(() => getComputedStyle(document.getElementById('student-chip')).display), 'none');
});
await step('作答過程沒有 JS 錯誤', async () => { assert.equal(p.errors.filter((e) => !/favicon/.test(e)).length, 0, p.errors.join('\n')); });
await world.close();
process.exit(results.includes(0) ? 1 : 0);
