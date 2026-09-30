// 上方名牌個人選單與「我的成績與缺交」頁：node tools/e2e/me.mjs
import assert from 'node:assert';
import { startWorld, sleep } from './harness.mjs';
const world = await startWorld({ scriptLatency: 100 });
const g = world.gas;
const mk = (id, t, extra = {}) => ({ id, title: id, type: t, lesson: 1, topic: '', visible: true, disabled: [], questionCount: 4, custom: true, ...extra });
g.api('saveAllSettings', [[], [mk('a-voc', 'vocab'), mk('b-voc', 'vocab'), mk('c-voc', 'vocab', { closeAt: '2020-01-01T00:00' }), mk('d-read', 'reading', { closeAt: '2099-01-01T00:00' }), mk('e-voc', 'vocab', { openAt: '2099-01-01T00:00' })]]);
const words = ['a1', 'b2', 'c3', 'd4', 'e5', 'f6'].map((w) => ({ word: w, pos: 'n.', zh: '字', example: `I [${w}] it.`, exampleZh: '我。' }));
['a-voc', 'b-voc', 'c-voc', 'e-voc'].forEach((id) => g.api('saveContent', [id, { topic: 'T ' + id, words }, true]));
g.api('saveContent', ['d-read', { title: 'R', topic: 'T d-read', passage: ['Tea is good.'], questions: [{ skill: '細節', q: 'Q?', options: ['a', 'b'], answer: 0, explain: 'x' }] }, true]);
const ctx = await world.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
const p = await world.newPage(ctx, { student: true });
await p.addInitScript(() => {
  window.__fb = window.__fb || {};
  window.__fb.attempts = [
    { unit: 'a-voc', mode: 'vocab', pct: 92, clientTs: '2026-09-30 10:00:00', review: false, details: [], createdAt: { toMillis: () => Date.now() } },
    { unit: 'b-voc', mode: 'vocab', pct: 70, clientTs: '2026-09-30 10:05:00', review: false, details: [], createdAt: { toMillis: () => Date.now() } },
  ];
  window.__fb.reviews = [{ id: 'a-voc', at: { toMillis: () => Date.now() } }];
});
let bad = 0;
const step = async (n, f) => { try { await f(); console.log('✓', n); } catch (e) { bad++; console.log('✗', n, '\n  ', e.message); } };
await p.goto(world.base + '/'); await p.waitForSelector('.unit-tile');
await step('名牌只顯示名字（第二字遮住）', async () => { assert.equal((await p.textContent('#student-chip')).trim(), '陳〇嘉'); });
await step('點名牌展開個人選單，含姓名、班座號、我的成績、切換學生', async () => {
  await p.click('#student-chip'); await sleep(500);
  const t = await p.textContent('#chip-panel');
  assert.match(t, /陳〇嘉/); assert.match(t, /306 班 20 號/); assert.match(t, /我的成績與缺交/); assert.match(t, /切換學生/);
  assert.equal(await p.getAttribute('#student-chip', 'aria-expanded'), 'true');
  const r = await p.evaluate(() => { const b = document.getElementById('chip-panel').getBoundingClientRect(); return { x: b.x, r: b.right, w: innerWidth }; });
  assert.ok(r.x >= 0 && r.r <= r.w, JSON.stringify(r));
  await p.screenshot({ path: '/tmp/shots/me-panel.png' });
});
await step('點空白處收起選單', async () => { await p.mouse.click(200, 700); await sleep(400); assert.equal(await p.getAttribute('#student-chip', 'aria-expanded'), 'false'); });
await step('進入我的成績頁：狀態與計數正確', async () => {
  await p.click('#student-chip'); await sleep(300); await p.click('#chip-panel a'); await p.waitForSelector('.me-row');
  const rows = await p.$$eval('.me-row', (a) => a.map((r) => [r.className.replace('me-row ', ''), r.querySelector('.st').textContent]));
  console.log('   ', JSON.stringify(rows));
  assert.deepEqual(rows.map((r) => r[0]), ['miss', 'todo', 'open', 'ok', 'wait']);
  assert.equal(rows.find((r) => r[0] === 'ok')[1], '92%');
  const sums = await p.$$eval('.me-sum .sum b', (a) => a.map((x) => x.textContent));
  assert.deepEqual(sums, ['1 / 5', '1', '1']);
  await sleep(500); await p.screenshot({ path: '/tmp/shots/me-page.png', fullPage: true });
});
await step('從成績頁點單元可進入；作答中名牌選單不會開', async () => {
  await p.click('.me-row.open'); await p.waitForSelector('[data-start]'); await p.click('[data-start]'); await p.waitForSelector('.q-card, .pq');
  await sleep(300);
  assert.equal(await p.evaluate(() => getComputedStyle(document.getElementById('student-chip')).display), 'none'); // 考試中名牌換成計時與單元
});
await step('首頁有進度摘要（1/5 已完成、缺交 1、待檢討 1）並可點進成績頁', async () => {
  await p.evaluate(() => { delete document.body.dataset.busy; location.hash = '#/'; });
  await p.waitForSelector('.home-prog');
  const t = (await p.textContent('.home-prog')).replace(/\s+/g, ' ');
  console.log('   ', t.trim());
  assert.match(t, /已完成 1 \/ 5/); assert.match(t, /缺交 1/); assert.match(t, /待檢討 1/);
  await p.click('.home-prog'); await p.waitForSelector('.me-row');
});
await step('內容不存在時顯示分類的錯誤頁（沒有原始錯誤訊息）', async () => {
  const rows = g.sheets.get('content').rows;
  const i = rows.findIndex((r) => r[0] === 'a-voc'); rows.splice(i, 1);
  delete world.docs['content_a-voc']; g.cacheMap.clear();
  await p.evaluate(() => { localStorage.removeItem('b5p:content:a-voc'); location.hash = '#/u/a-voc'; });
  await p.waitForSelector('.empty h2', { timeout: 8000 });
  const t = await p.textContent('.empty');
  console.log('   ', t.replace(/\s+/g, ' ').trim());
  assert.match(t, /這個單元目前無法使用/); assert.doesNotMatch(t, /Error|undefined|fetch/i);
});
await step('登出並清除這台裝置：清掉學生資料並回到登入表單', async () => {
  await p.evaluate(() => { location.hash = '#/'; }); await p.waitForSelector('#student-chip');
  await p.click('#student-chip'); await sleep(300); await p.click('[data-logout]');
  await p.waitForSelector('dialog.modal[open]'); await p.locator('dialog.modal[open] .btn.primary').click();
  await p.waitForSelector('.welcome', { timeout: 5000 });
  const left = await p.evaluate(() => Object.keys(localStorage).filter((k) => /^b5p:(student|best|done|outbox)/.test(k)));
  assert.deepEqual(left, []);
});
await step('沒有 JS 錯誤', async () => { assert.equal(p.errors.filter((e) => !/favicon|B5-|404|老師還沒有|loadUnit|renderUnit|route\b|Promise.all|at /.test(e)).length, 0, p.errors.join('\n')); });
await world.close();
process.exit(bad ? 1 : 0);
