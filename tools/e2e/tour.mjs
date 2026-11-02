// 後台引導模式：每個導覽在電腦版與手機版都走得完，框得到該框的東西，動作步驟要真的按了才往下：node tools/e2e/tour.mjs
import assert from 'node:assert';
import { startWorld, sleep } from './harness.mjs';

const world = await startWorld({ scriptLatency: 50 });
const g = world.gas;
g.api('saveAllSettings', [[], [{ id: 'l1-voc', title: 'L1 單字', type: 'vocab', lesson: 1, topic: '', visible: true, disabled: [], questionCount: 4, custom: true }]]);
g.api('saveContent', ['l1-voc', { topic: 't', words: ['apple', 'bread', 'candy', 'dance'].map((w) => ({ word: w, pos: 'n.', zh: '字', example: `I [${w}] it.`, exampleZh: '我。' })) }, true]);

let bad = 0;
const step = async (n, f) => { try { await f(); console.log('✓', n); } catch (e) { bad++; console.log('✗', n, '\n  ', e.message.split('\n')[0]); } };

for (const [label, vp] of [['電腦', { width: 1280, height: 860 }], ['手機', { width: 390, height: 844, isMobile: true, hasTouch: true }]]) {
  const { width, height, ...rest } = vp;
  const ctx = await world.newContext({ viewport: { width, height }, ...rest });
  const t = await world.newPage(ctx, { staff: 'teacher@example.com' });
  await t.addInitScript(() => {
    const now = Date.now();
    window.__fb = window.__fb || {};
    window.__fb.attempts = [{ id: 'z1', attemptId: 'z1', cls: '306', seat: '1', name: '甲', unit: 'l1-voc', mode: 'vocab', pct: 40, score: 4, total: 10, review: false, serverGraded: true, check: '作答時間過短', wrong: ['apple'], createdAt: { toMillis: () => now - 60000 } }];
  });
  await t.goto(world.base + '/admin.html');
  await t.waitForSelector('#app-root:not([hidden])', { timeout: 15000 });
  await sleep(800);
  const st = () => t.evaluate(() => { const a = window.adminTour.active(); const r = document.querySelector('.tour-ring'); return a ? { step: a.step, id: a.id, ring: !r.hidden, title: document.querySelector('.tour-title').textContent } : null; });
  const waitStep = async (n, ms = 8000) => {
    try { await t.waitForFunction((k) => { const a = window.adminTour.active(); return k < 0 ? !a : a && a.step === k; }, n, { timeout: ms }); }
    catch (e) { const d = await t.evaluate(() => ({ a: window.adminTour.active(), hash: location.hash, msg: document.getElementById('msg').textContent, nu: document.getElementById('nu-msg').textContent, title: (document.querySelector('.tour-title') || {}).textContent })); throw new Error(`等第 ${n} 步逾時：${JSON.stringify(d)}`); }
    await sleep(350);
  };
  const next = () => t.click('.tour-card [data-tour="next"]');
  const ringOn = async (why) => { const s = await st(); assert.ok(s && s.ring, `${why}：應該框出目標（${s && s.title}）`); };
  const tap = (sel) => (rest.hasTouch ? t.tap(sel) : t.click(sel));

  await step(`${label}：自動化測試的瀏覽器不自動跳出導覽`, async () => { assert.equal(await st(), null); });

  await step(`${label}：從選單打開「使用導覽」，列出 5 個導覽`, async () => {
    if (rest.isMobile) { await tap('#rail-more'); await sleep(400); await tap('#m-sheet .m-item:has-text("使用導覽")'); }
    else { await t.click('#who-btn'); await sleep(200); await t.click('#tour-open'); }
    await t.waitForSelector('dialog.tour-pick[open]');
    assert.equal(await t.locator('dialog.tour-pick .tour-item').count(), 5);
    await t.click('dialog.tour-pick [data-pick="intro"]');
    await waitStep(0);
  });

  await step(`${label}：認識後台 4 步，每步都框得到`, async () => {
    for (let i = 0; i < 4; i++) { await waitStep(i); await ringOn(`第 ${i + 1} 步`); await next(); }
    await waitStep(-1);
    assert.ok(await t.evaluate(() => !!window.adminTour.seen().intro), '要記住看過了');
  });

  await step(`${label}：出一份題目（新增單元 → 建立 → 選方式 → 檢查儲存 → 開放給學生）`, async () => {
    await t.evaluate(() => { location.hash = '#overview'; }); await sleep(400);
    await t.evaluate(() => window.adminTour.start('create'));
    await t.waitForFunction(() => { const a = window.adminTour.active(); const c = document.querySelector('.tour-card'); return a && (a.step === 1 || (!c.hidden && /新增單元/.test(c.querySelector('.tour-title').textContent))); });
    await sleep(300);
    const s0 = await st();
    if (s0.step === 0) { await ringOn('新增單元'); assert.match(await t.textContent('.tour-card'), /請按框起來的地方/); await tap('#ulist-add'); }
    await waitStep(1); await ringOn('填單元資料');
    await t.fill('#nu2-title', 'L9 導覽單字');
    await t.click('#nu2-go');
    await waitStep(2, 15000); await ringOn('放進題目');
    await t.click('.uc-way[data-uc="paste"]');
    await waitStep(3); await ringOn('檢查後儲存');
    await next(); await waitStep(4); await ringOn('開放給學生');
    await next(); await waitStep(-1);
  });

  await step(`${label}：看成績（點卡片 → 各班 → 需要確認 → 還沒通過）`, async () => {
    await t.evaluate(() => { location.hash = '#overview'; }); await sleep(400);
    await t.evaluate(() => window.adminTour.start('scores'));
    await waitStep(0); await ringOn('各單元');
    await t.click('#sc-view .sc-card[data-sc="l1-voc"]');
    for (let i = 1; i < 4; i++) { await waitStep(i); await ringOn(`第 ${i + 1} 步`); await next(); }
    await waitStep(-1);
  });

  await step(`${label}：匯入學生名單 3 步`, async () => {
    await t.evaluate(() => window.adminTour.start('roster'));
    for (let i = 0; i < 3; i++) { await waitStep(i); await ringOn(`第 ${i + 1} 步`); await next(); }
    await waitStep(-1);
  });

  await step(`${label}：用 AI 出題（打開編輯 → AI 按鈕 → 檢查儲存 → AI 設定）`, async () => {
    await t.evaluate(() => { location.hash = '#unit/l1-voc/content'; }); await sleep(600);
    await t.evaluate(() => window.adminTour.start('ai'));
    await waitStep(0); await ringOn('打開題目編輯');
    await t.click('[data-uc="edit"]');
    await waitStep(1); await ringOn('AI 按鈕');
    assert.match(await t.textContent('.tour-text'), /單字/, '單字單元要說明單字的 AI 按鈕');
    for (let i = 1; i < 4; i++) { await waitStep(i); await ringOn(`第 ${i + 1} 步`); await next(); }
    await waitStep(-1);
  });

  await step(`${label}：隨時可以結束（×、Esc）`, async () => {
    await t.evaluate(() => window.adminTour.start('roster')); await waitStep(0);
    await t.click('.tour-card [data-tour="stop"]'); await waitStep(-1);
    await t.evaluate(() => window.adminTour.start('roster')); await waitStep(0);
    await t.keyboard.press('Escape'); await waitStep(-1);
    assert.ok(await t.evaluate(() => document.querySelector('.tour-ring').hidden && document.querySelector('.tour-card').hidden));
  });
  await t.screenshot({ path: `/tmp/shots/tour-${label}.png` }).catch(() => {});
  await step(`${label}：沒有 JS 錯誤`, async () => { const e = t.errors.filter((x) => !/favicon|404/.test(x)); assert.equal(e.length, 0, e.join('\n')); });
  await ctx.close();
}
// 看過的導覽記在帳號上：別台電腦看過就不再自動跳；在這台看完會存回帳號
for (const [label, preset] of [['帳號上已看過', { intro: 1 }], ['新帳號', null]]) {
  const ctx = await world.newContext({ viewport: { width: 1280, height: 860 } });
  const t = await world.newPage(ctx, { staff: 'teacher@example.com' });
  await t.addInitScript((p) => { window.__tourAuto = true; window.__fb = window.__fb || {}; window.__fb.docs = window.__fb.docs || {}; if (p) window.__fb.docs['staffPrefs/teacher@example.com'] = { tours: p }; }, preset);
  await t.goto(world.base + '/admin.html');
  await t.waitForSelector('#app-root:not([hidden])', { timeout: 15000 });
  await sleep(2500);
  const a = await t.evaluate(() => window.adminTour.active());
  if (preset) {
    await step(`${label}：換一台電腦也不會再跳出「認識後台」`, async () => { assert.equal(a, null); assert.ok(await t.evaluate(() => !!window.adminTour.seen().intro)); });
  } else {
    await step(`${label}：第一次登入自動跳出「認識後台」，結束後存到帳號`, async () => {
      assert.ok(a && a.id === 'intro', JSON.stringify(a));
      await t.click('.tour-card [data-tour="stop"]'); await sleep(500);
      const d = await t.evaluate(() => window.__fb.docs['staffPrefs/teacher@example.com']);
      assert.ok(d && d.tours && d.tours.intro, JSON.stringify(d));
    });
  }
  await ctx.close();
}
await world.close();
console.log(bad ? `${bad} 項失敗` : '引導模式測試通過');
process.exit(bad ? 1 : 0);
