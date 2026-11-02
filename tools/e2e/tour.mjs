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
    assert.match(await t.textContent('dialog.tour-pick'), /看完整教學/);
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

  await step(`${label}：教學頁：9 章、截圖載得出來、搜尋、帶我做一次`, async () => {
    if (rest.isMobile) { await tap('#rail-more'); await sleep(400); await tap('#m-sheet a[href="#help"]'); }
    else await t.click('.rail a[data-view="help"]');
    await t.waitForSelector('#help-view .help-ch');
    assert.equal(await t.locator('#help-view .help-ch').count(), 9);
    const imgs = await t.evaluate(async () => {
      const list = [...document.querySelectorAll('#help-view img')];
      list.forEach((i) => { i.loading = 'eager'; });
      await Promise.all(list.map((i) => (i.complete ? 0 : new Promise((r) => { i.onload = i.onerror = r; }))));
      return { n: list.length, bad: list.filter((i) => !i.naturalWidth).map((i) => i.getAttribute('src')) };
    });
    assert.ok(imgs.n >= 12, '截圖數量 ' + imgs.n); assert.deepEqual(imgs.bad, [], '有截圖載不出來');
    await t.fill('#help-q', '補作');
    await sleep(200);
    const shown = await t.$$eval('#help-view .help-ch h2', (a) => a.map((x) => x.textContent));
    assert.ok(shown.includes('開放與截止') && shown.length < 9, JSON.stringify(shown));
    assert.ok(await t.locator('#help-view mark').count() > 0, '關鍵字要標亮');
    await t.fill('#help-q', '');
    await t.click('#help-view [data-help-tour="roster"]');
    await waitStep(0); await ringOn('教學頁啟動的導覽');
    await t.click('.tour-card [data-tour="stop"]'); await waitStep(-1);
    const overflow = await t.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
    assert.equal(overflow, false, '不能有橫向捲動');
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
for (const [label, preset] of [['帳號上已看過', { welcome: 1 }], ['新帳號', null]]) {
  const ctx = await world.newContext({ viewport: { width: 1280, height: 860 } });
  const t = await world.newPage(ctx, { staff: 'teacher@example.com' });
  await t.addInitScript((p) => { window.__tourAuto = true; window.__fb = window.__fb || {}; window.__fb.docs = window.__fb.docs || {}; if (p) window.__fb.docs['staffPrefs/teacher@example.com'] = { tours: p }; }, preset);
  await t.goto(world.base + '/admin.html');
  await t.waitForSelector('#app-root:not([hidden])', { timeout: 15000 });
  await sleep(2500);
  const open = await t.evaluate(() => !!document.querySelector('dialog.welcome[open]'));
  if (preset) {
    await step(`${label}：換一台電腦也不會再跳出歡迎畫面`, async () => { assert.equal(open, false); assert.ok(await t.evaluate(() => !!window.adminTour.seen().welcome)); });
  } else {
    await step(`${label}：第一次登入出現 3 頁歡迎畫面，最後可以去看完整教學，看過的紀錄存到帳號`, async () => {
      assert.ok(open, '要出現歡迎畫面');
      await t.click('dialog.welcome [data-wc="next"]'); await sleep(300);
      await t.click('dialog.welcome [data-wc="next"]'); await sleep(300);
      assert.match(await t.textContent('dialog.welcome .wc-btns'), /看完整教學/);
      await t.click('dialog.welcome [data-wc="help"]'); await sleep(600);
      assert.equal(await t.evaluate(() => location.hash), '#help');
      const d = await t.evaluate(() => window.__fb.docs['staffPrefs/teacher@example.com']);
      assert.ok(d && d.tours && d.tours.welcome, JSON.stringify(d));
    });
  }
  await ctx.close();
}
await world.close();
console.log(bad ? `${bad} 項失敗` : '引導模式測試通過');
process.exit(bad ? 1 : 0);
