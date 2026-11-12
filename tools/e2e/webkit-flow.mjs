import assert from 'node:assert';
import { startWorld, startBrowser, sleep } from './wk-harness.mjs';
// 轉場與流暢度（WebKit 版）：換頁、捲到下面換頁、返回原位、分頁、搜尋、開始測驗到交卷、轉場中點擊。OUT=資料夾 會存轉場中的截圖
const OUT = process.env.OUT || '';
const world = await startWorld();
const g = world.gas;
const mk = (id, title, type, lesson) => ({ id, title, type, lesson, topic: 'Topic', visible: true, disabled: [], questionCount: 4, custom: true });
const list = []; for (let l = 1; l <= 6; l++) { list.push(mk(`l${l}-voc`, `L${l} 單字`, 'vocab', l)); list.push(mk(`l${l}-read`, `L${l} 課文`, 'reading', l)); }
g.api('saveAllSettings', [[], list]);
const words = ['apple', 'banana', 'cherry', 'dates', 'egg', 'fig'].map((w) => ({ word: w, pos: 'n.', zh: '字' + w, example: `I [${w}] it.`, exampleZh: '我。' }));
for (let l = 1; l <= 6; l++) {
  g.api('saveContent', [`l${l}-voc`, { topic: 'Food', words }, true]);
  g.api('saveContent', [`l${l}-read`, { title: 'Tea', topic: 'Tea', passage: ['Tea is good for you. '.repeat(10)], questions: [0, 1].map((i) => ({ ref: '1-1', skill: '細節', q: `Q${i}?`, options: ['a', 'b', 'c', 'd'], answer: 0, explain: 'x', key: 'Tea is good' })) }, true]);
}
const b = await startBrowser();
await b.go(world.base + '/'); await b.wait(() => document.querySelectorAll('.unit-tile').length); await sleep(1500);
let bad = 0;
const step = async (n, f) => { try { await f(); console.log('✓', n); } catch (e) { bad++; console.log('✗', n, '\n  ', String(e.message).split('\n')[0]); } };
const clean = async () => {
  const s = await b.js(() => ({ cls: document.documentElement.className, bcls: document.body.className, top: document.getElementById('app').style.top, pos: document.getElementById('app').style.position, nav: document.documentElement.dataset.nav || '', vt: document.getAnimations().filter((a) => String(a.effect && a.effect.pseudoElement || '').includes('view-transition')).length }));
  assert.ok(!/far-run|far-out|far-in/.test(s.cls), 'html 殘留 ' + s.cls);
  assert.ok(!/searching|search-lock|search-closing/.test(s.cls + ' ' + s.bcls), '搜尋殘留 ' + s.cls + '|' + s.bcls);
  assert.equal(s.top, '', '#app top 殘留'); assert.equal(s.pos, '', '#app position 殘留');
  return s;
};
// 轉場中連拍：把動畫放慢 8 倍後截 3 張
const film = async (name, act) => {
  await b.js(() => { window.__slow = setInterval(() => document.getAnimations().forEach((a) => { if (a.playbackRate !== 0.125) a.playbackRate = 0.125; }), 5); });
  await act();
  for (let i = 0; i < 3; i++) { await sleep(250); if (OUT) await b.shot(`${OUT}/${name}-${i}.png`); }
  const info = await b.js(() => ({ sy: scrollY, vtAnims: document.getAnimations().filter((a) => String(a.effect && a.effect.pseudoElement || '').includes('view-transition')).map((a) => a.effect.pseudoElement + ' ' + a.animationName) }));
  await b.js(() => { clearInterval(window.__slow); document.getAnimations().forEach((a) => { a.playbackRate = 1; }); });
  await sleep(1200);
  return info;
};

await step('首頁 → 單元（在頂端）', async () => {
  const i = await film('a-top', () => b.click('.unit-tile[data-id="l2-read"]'));
  console.log('   轉場中', JSON.stringify(i));
  await b.wait(() => document.querySelector('[data-start]'));
  await clean();
});
await step('返回首頁', async () => { await b.click('.top-back'); await b.wait(() => document.querySelector('.unit-tile')); await sleep(900); await clean(); });
let y0;
await step('捲到下面 → 單元：轉場中不捲動、結束後在頂端', async () => {
  await b.js(() => document.querySelector('.unit-tile[data-id="l6-voc"]').scrollIntoView({ block: 'center' })); await sleep(400);
  y0 = await b.js(() => Math.round(scrollY)); assert.ok(y0 > 300);
  const i = await film('b-far', () => b.click('.unit-tile[data-id="l6-voc"]'));
  console.log('   轉場中', JSON.stringify(i));
  await b.wait(() => document.querySelector('[data-start]'));
  assert.ok(await b.js(() => scrollY) < 5, '單元頁從頂端開始');
  await clean();
});
await step('返回首頁：回到原本位置', async () => {
  const i = await film('c-back', () => b.click('.top-back'));
  console.log('   轉場中', JSON.stringify(i));
  await b.wait(() => document.querySelector('.unit-tile'));
  const y1 = await b.js(() => Math.round(scrollY));
  assert.ok(Math.abs(y1 - y0) < 4, `${y0} → ${y1}`);
  await clean();
});
await step('分頁列：首頁 → 我的成績 → 帳號 → 首頁', async () => {
  for (const [k, sel] of [['me', '.me-row, .me-empty, .empty'], ['account', '.acct-ver'], ['home', '.unit-tile']]) {
    await b.click(`#dock a[data-dock="${k}"]`); await b.wait((s) => document.querySelector(s), 8000, sel); await sleep(700);
    assert.ok(await b.js(() => scrollY) < 5, k + ' 從頂端'); await clean();
  }
});
await step('搜尋：打開、輸入、關閉，頁面不動', async () => {
  await b.js(() => scrollTo(0, 500)); await sleep(300);
  const ya = await b.js(() => Math.round(scrollY));
  await b.click('[data-search]'); await b.wait(() => document.querySelector('dialog.search-sheet[open] .ss-field input')); await sleep(500);
  if (OUT) await b.shot(`${OUT}/d-search-open.png`);
  assert.ok(await b.js(() => document.activeElement && document.activeElement.matches('.ss-field input')), '游標在搜尋框');
  await b.type('.ss-field input', 'L4');
  await sleep(300);
  assert.ok(await b.js(() => document.querySelectorAll('.ss-row').length) >= 2, '有結果');
  await b.click('.ss-x'); await b.wait(() => !document.querySelector('dialog.search-sheet')); await sleep(1200);
  const yb = await b.js(() => Math.round(scrollY));
  assert.ok(Math.abs(ya - yb) < 4, `${ya} → ${yb}`);
  await clean();
});
await step('搜尋結果 → 單元', async () => {
  await b.click('[data-search]'); await b.wait(() => document.querySelector('dialog.search-sheet[open] .ss-field input')); await sleep(400);
  await b.type('.ss-field input', 'L4 課文'); await sleep(300);
  const i = await film('e-search-go', () => b.click('.ss-row'));
  console.log('   轉場中', JSON.stringify(i));
  await b.wait(() => location.hash === '#/u/l4-read' && document.querySelector('[data-start]'));
  assert.equal(await b.js(() => document.querySelectorAll('dialog.search-sheet').length), 0);
  await clean();
});
await step('開始測驗 → 作答 → 交卷 → 成績', async () => {
  await b.js(() => { location.hash = '#/u/l2-read'; }); await b.wait(() => document.querySelector('[data-start]')); await sleep(600);
  const i = await film('f-start', () => b.click('[data-start]'));
  console.log('   轉場中', JSON.stringify(i));
  await b.wait(() => document.querySelector('.pq'));
  assert.equal(await b.js(() => document.querySelectorAll('.gate').length), 0);
  await b.js(() => document.querySelectorAll('.pq').forEach((q) => q.querySelector('.opt[data-i="0"]').click())); await sleep(300);
  await b.click('[data-submit-btn]'); await b.wait(() => document.querySelector('dialog.modal[open]')); await sleep(300);
  await b.click('dialog.modal[open] .btn.primary');
  await b.wait(() => document.querySelector('.result'), 10000); await sleep(1800);
  assert.equal(await b.js(() => (document.querySelector('[data-num]') || {}).textContent), '100');
  if (OUT) await b.shot(`${OUT}/g-result.png`);
  await clean();
});
await step('轉場進行中立刻點選項', async () => {
  await b.js(() => { location.hash = '#/u/l3-read'; }); await b.wait(() => document.querySelector('[data-start]')); await sleep(600);
  await b.click('[data-start]');
  await b.wait(() => document.querySelector('.pq .opt'));
  const r = await b.js(() => { const o = document.querySelector('.pq[data-q="0"] .opt[data-i="2"]').getBoundingClientRect(); return [o.x + o.width / 2, o.y + o.height / 2]; });
  await b.clickAt(r[0], r[1]); await sleep(500);
  assert.equal(await b.js(() => [...document.querySelectorAll('.pq[data-q="0"] .opt')].findIndex((o) => o.classList.contains('selected'))), 2);
});
await step('沒有 JS 錯誤', async () => { const e = await b.js(() => window.__errs); assert.equal(e.length, 0, JSON.stringify(e)); });
await b.quit(); world.close();
console.log(bad ? bad + ' 項失敗' : 'WebKit 流程全部通過');
process.exit(bad ? 1 : 0);
