// 端對端冒煙測試：node tools/e2e/smoke.mjs
// 1) 學生端各頁面沒有錯誤、沒有橫向捲動   2) 老師儲存 → 學生同步的速度與正確性（含失敗情境）
import assert from 'node:assert';
import { startWorld, sleep } from './harness.mjs';

const results = [];
const step = async (name, fn) => {
  const t = Date.now();
  try { await fn(); results.push(['✓', name, Date.now() - t]); console.log(`✓ ${name} (${Date.now() - t}ms)`); }
  catch (e) { results.push(['✗', name, Date.now() - t, e]); console.log(`✗ ${name}\n   ${String(e.message).split('\n').join('\n   ')}`); }
};

const world = await startWorld({ scriptLatency: 1200 });
const g = world.gas;
const okApi = (name, args) => { const r = g.api(name, args); assert.equal(r.ok, true, JSON.stringify(r)); return r.data; };

// ---- 預先建立老師的資料：2 個單字單元、1 個課文單元（1 個隱藏）
const unitsSeed = [
  { id: 'l1-voc', title: 'L1 單字片語', type: 'vocab', lesson: 1, topic: '', visible: true, disabled: [], questionCount: 5, custom: true },
  { id: 'l1-reading', title: 'L1 課文理解', type: 'reading', lesson: 1, topic: '', visible: true, disabled: [], questionCount: 5, custom: true },
  { id: 'l2-voc', title: 'L2 單字片語', type: 'vocab', lesson: 2, topic: '', visible: true, disabled: [], questionCount: 5, custom: true },
];
okApi('saveAllSettings', [[], unitsSeed]);
const words = ['apple', 'bread', 'candy', 'dance', 'eagle', 'flame'].map((w, i) => ({ word: w, pos: 'n.', zh: '中文' + i, example: `I like [${w}] a lot.`, exampleZh: '我很喜歡。' }));
okApi('saveContent', ['l1-voc', { topic: 'Food', words }, true]);
okApi('saveContent', ['l2-voc', { topic: 'Sports', words }, true]);
okApi('saveContent', ['l1-reading', { title: 'Tea', topic: 'Tea time', passage: ['Tea is a drink made from leaves. People all over the world enjoy it every day.'], questions: [
  { ref: '1-1', skill: '細節', q: 'What is tea made from?', options: ['Leaves', 'Rocks', 'Milk', 'Sand'], answer: 0, explain: '第一句。' },
  { ref: '1-1', skill: '主旨', q: 'Who enjoys tea?', options: ['Nobody', 'Only kids', 'People worldwide', 'Cats'], answer: 2, explain: '第二句。' },
] }, true]);
world.gas.calls.commit.length = 0;

const ctx = await world.newContext();

// ================= 學生端 =================
const pagesToCheck = ['/', '/#/privacy', '/#/teacher', '/#/diag', '/#/u/l1-voc', '/#/u/l1-reading', '/#/u/not-exist', '/admin.html'];
for (const w of [360, 768, 1280]) {
  await step(`各頁面沒有錯誤、沒有橫向捲動（寬 ${w}）`, async () => {
    const c = await world.newContext({ viewport: { width: w, height: 800 } });
    const problems = [];
    for (const url of pagesToCheck) {
      const p = await world.newPage(c, { student: !url.includes('teacher') && !url.includes('admin') });
      await p.goto(world.base + url);
      await sleep(900);
      const over = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (over > 0) problems.push(`${url}：橫向溢出 ${over}px`);
      const fatal = p.errors.filter((e) => !/favicon/.test(e));
      if (fatal.length) problems.push(`${url}：${fatal.join(' | ')}`);
      await p.close();
    }
    await c.close();
    assert.equal(problems.length, 0, problems.join('\n'));
  });
}

// 學生登入 + 首頁
const studentPage = await world.newPage(ctx, { student: true });
await step('學生首頁顯示 3 個單元', async () => {
  await studentPage.goto(world.base + '/');
  await studentPage.waitForSelector('.unit-tile');
  assert.equal(await studentPage.locator('.unit-tile').count(), 3);
  assert.ok(await studentPage.evaluate(() => window.__fb.log.some((x) => x[0] === 'initializeFirestore' && /LongPolling/.test(x[1]))), '要開啟自動偵測長輪詢');
});
await step('學生不會載入登入元件（firebase-auth）', async () => {
  await sleep(1500);
  assert.ok(!(await studentPage.evaluate(() => window.__fb.log.some((x) => x[0] === 'getAuth'))), '學生端不該初始化 Auth');
});
await step('即時監聽：沒有操作時不連線（避免檢測工具記成逾時錯誤），一有操作就建立', async () => {
  await sleep(1200);
  assert.ok(!(await studentPage.evaluate(() => window.__fb.log.some((x) => x[0] === 'onSnapshot'))), '還沒有任何操作，不該先連即時監聽');
  await studentPage.evaluate(() => window.dispatchEvent(new Event('pointerdown')));
});
await step('即時監聽已建立（public/config）', async () => {
  await studentPage.waitForFunction(() => window.__fb.log.some((x) => x[0] === 'onSnapshot' && x[1] === 'public/config'), null, { timeout: 5000 });
});
await step('打開單字單元可以開始測驗', async () => {
  await studentPage.click('.unit-tile[data-id="l1-voc"]');
  await studentPage.waitForSelector('#stage', { timeout: 5000 });
  await sleep(500);
  assert.equal(studentPage.errors.length, 0, studentPage.errors.join('\n'));
  await studentPage.goto(world.base + '/');
  await studentPage.waitForSelector('.unit-tile');
  // 真人一定會點或滑動：這時才建立即時監聽
  await studentPage.evaluate(() => window.dispatchEvent(new Event('pointerdown')));
  await studentPage.waitForFunction(() => window.__fb.log.some((x) => x[0] === 'onSnapshot' && x[1] === 'public/config'), null, { timeout: 5000 });
});

// ================= 老師後台：儲存 → 學生同步 =================
const teacherPage = await world.newPage(ctx, { staff: 'teacher@example.com' });
await step('老師後台載入（單元清單、快速同步可用）', async () => {
  await teacherPage.goto(world.base + '/admin.html');
  await teacherPage.waitForSelector('#units tr[data-i]', { timeout: 15000 });
  assert.equal(await teacherPage.locator('#units tr[data-i]').count(), 3);
  assert.ok(await teacherPage.evaluate(() => typeof window.fastPublish === 'function'));
  assert.ok(await teacherPage.evaluate(() => cfgBase && cfgBase.units && cfgBase.units['l1-voc']));
});

const waitTileGone = (id) => studentPage.waitForFunction((i) => !document.querySelector(`.unit-tile[data-id="${i}"]`), id, { timeout: 15000, polling: 25 });
const waitTile = (id) => studentPage.waitForSelector(`.unit-tile[data-id="${id}"]`, { timeout: 15000 });

await step('取消勾選「顯示」→ 學生首頁的單元很快消失', async () => {
  const before = world.directWrites;
  await teacherPage.locator('#units tr').filter({ hasText: 'L2' }).locator('input[data-k="visible"]').uncheck();
  const t0 = Date.now();
  await teacherPage.click('#save');
  await waitTileGone('l2-voc');
  const studentMs = Date.now() - t0;
  await teacherPage.waitForFunction(() => /^✓ 已儲存/.test(document.getElementById('msg').textContent), null, { timeout: 15000 });
  const totalMs = Date.now() - t0;
  console.log(`   學生看到變化：${studentMs}ms；老師看到「✓ 已儲存」：${totalMs}ms（假的 Apps Script 延遲 1200ms×2）`);
  assert.ok(world.directWrites > before, '要走瀏覽器直接寫入');
  assert.ok(studentMs < 1500, `學生同步太慢：${studentMs}ms`);
  const msg = await teacherPage.textContent('#msg');
  assert.match(msg, /學生網站已即時更新/);
  // 伺服器最後確認的版本和瀏覽器算的一致：學生的設定沒有被覆蓋成別的樣子
  await sleep(300);
  assert.equal(await studentPage.locator('.unit-tile').count(), 2);
  const cfg = JSON.parse(world.docs.config);
  assert.equal(cfg.units['l2-voc'].visible, false);
});

await step('重新勾選顯示 → 單元回來', async () => {
  await teacherPage.locator('#units tr').filter({ hasText: 'L2' }).locator('input[data-k="visible"]').check();
  const t0 = Date.now();
  await teacherPage.click('#save');
  const tClick = Date.now();
  await waitTile('l2-voc');
  console.log(`   學生看到變化：${Date.now() - t0}ms（寫入事件：${world.log.filter((x) => x.t >= tClick - 50).map((x) => `${x.from}+${x.t - t0}ms`).join('、') || '尚無'}）`);
  await teacherPage.waitForFunction(() => /^✓ 已儲存/.test(document.getElementById('msg').textContent), null, { timeout: 15000 });
});

await step('匯入內容 → 學生的設定與題目同步（同一個請求）', async () => {
  await teacherPage.click('nav button[data-tab="import"]');
  await teacherPage.selectOption('#imp-unit', 'l2-voc');
  await teacherPage.fill('#v-text', ['grape\tn.\t葡萄\tI ate a [grape].\t我吃了葡萄。', 'peach\tn.\t桃子\tThe [peach] is sweet.\t桃子很甜。', 'lemon\tn.\t檸檬\tA [lemon] is sour.\t檸檬很酸。', 'melon\tn.\t哈密瓜\tWe shared a [melon].\t我們分著吃。'].join('\n'));
  await teacherPage.click('#imp-check');
  await teacherPage.waitForFunction(() => !document.getElementById('imp-save').disabled);
  const before = world.log.length;
  const t0 = Date.now();
  await teacherPage.click('#imp-save');
  await teacherPage.waitForFunction(() => /^✓ 已儲存/.test(document.getElementById('imp-msg').textContent), null, { timeout: 15000 });
  console.log(`   老師看到「✓ 已儲存」：${Date.now() - t0}ms`);
  const first = world.log.slice(before).find((x) => x.from === 'teacher-browser');
  assert.ok(first, '瀏覽器要先寫入');
  const cfg = JSON.parse(world.docs.config);
  const doc = JSON.parse(world.docs['content_l2-voc']);
  assert.equal(doc.data.words.length, 4);
  assert.equal(cfg.content['l2-voc'].updated, doc.v, '設定裡的版本要和題目文件一致');
  assert.equal(cfg.content['l2-voc'].count, 4);
  // 學生打開這個單元看到的是新題目
  await studentPage.evaluate(() => { location.hash = '#/u/l2-voc'; });
  await studentPage.waitForSelector('#stage', { timeout: 8000 });
});

await step('學生在首頁時，老師改單元設定 → 首頁不會閃爍重畫兩次', async () => {
  await studentPage.evaluate(() => { location.hash = '#/'; });
  await studentPage.waitForSelector('.unit-tile');
  await sleep(500);
  await studentPage.evaluate(() => { window.__redraws = 0; new MutationObserver(() => { window.__redraws++; }).observe(document.getElementById('lessons'), { childList: true, subtree: false }); });
  await teacherPage.click('nav button[data-tab="settings"]');
  await teacherPage.locator('#units tr').filter({ hasText: 'l1-voc' }).locator('input[data-k="visible"]').uncheck();
  await teacherPage.click('#save');
  await teacherPage.waitForFunction(() => /^✓ 已儲存/.test(document.getElementById('msg').textContent), null, { timeout: 15000 });
  await sleep(600);
  const redraws = await studentPage.evaluate(() => window.__redraws);
  assert.ok(redraws <= 1, `首頁重畫了 ${redraws} 次（瀏覽器與伺服器先後寫入的同一份設定不該重畫兩次）`);
  await teacherPage.locator('#units tr').filter({ hasText: 'l1-voc' }).locator('input[data-k="visible"]').check();
  await teacherPage.click('#save');
  await teacherPage.waitForFunction(() => /^✓ 已儲存/.test(document.getElementById('msg').textContent), null, { timeout: 15000 });
});

await step('試算表儲存失敗 → 顯示錯誤，學生網站還原成試算表的樣子', async () => {
  world.scriptFail = true;
  await teacherPage.locator('#units tr').filter({ hasText: 'L2' }).locator('input[data-k="visible"]').uncheck();
  await teacherPage.click('#save');
  await teacherPage.waitForFunction(() => /儲存失敗/.test(document.getElementById('msg').textContent), null, { timeout: 15000 });
  world.scriptFail = false;
  await sleep(2600); // 還原：重新讀取試算表 → 寫回
  const cfg = JSON.parse(world.docs.config);
  assert.equal(cfg.units['l2-voc'].visible, true, '學生網站要還原成試算表現在的樣子');
  assert.equal(await studentPage.locator('.unit-tile').count(), 3);
  // 恢復畫面上的勾選狀態以便後面的測試
  await teacherPage.reload(); await teacherPage.waitForSelector('#units tr[data-i]');
});

await step('Firestore 規則還沒更新（403）→ 退回原本的流程，仍然儲存成功並給提示', async () => {
  world.rulesAllowStaffWrite = false;
  await teacherPage.locator('#units tr').filter({ hasText: 'L2' }).locator('input[data-k="visible"]').uncheck();
  await teacherPage.click('#save');
  await teacherPage.waitForFunction(() => /firestore\.rules/.test(document.getElementById('msg').textContent) || /^✓ 已儲存/.test(document.getElementById('msg').textContent), null, { timeout: 20000 });
  const cfg = JSON.parse(world.docs.config);
  assert.equal(cfg.units['l2-voc'].visible, false, '伺服器仍要把設定寫給學生');
  world.rulesAllowStaffWrite = true;
});

await step('快速連按兩次儲存：第二次被擋住並提示，不會互相蓋掉', async () => {
  await teacherPage.locator('#units tr').filter({ hasText: 'L2' }).locator('input[data-k="visible"]').check();
  await teacherPage.evaluate(() => { document.getElementById('save').click(); document.getElementById('save').click(); });
  await teacherPage.waitForFunction(() => /^✓ 已儲存/.test(document.getElementById('msg').textContent) || /還沒完成/.test(document.getElementById('msg').textContent), null, { timeout: 15000 });
  await teacherPage.waitForFunction(() => /^✓ 已儲存/.test(document.getElementById('msg').textContent), null, { timeout: 15000 });
  assert.equal(JSON.parse(world.docs.config).units['l2-voc'].visible, true);
});

await step('補作時間儲存', async () => {
  await teacherPage.evaluate(() => { exts = [{ unit: 'l1-voc', cls: '306', seat: '20', until: '2026-12-31T23:00', note: '' }]; exRender(); });
  const t0 = Date.now();
  await teacherPage.click('#ex-save');
  await teacherPage.waitForFunction(() => /^✓ 已儲存/.test(document.getElementById('ex-msg').textContent), null, { timeout: 15000 });
  console.log(`   ${Date.now() - t0}ms`);
  assert.equal(JSON.parse(world.docs.config).ext['l1-voc']['306-20'], '2026-12-31T23:00');
});

await step('清除單元題目', async () => {
  await teacherPage.click('nav button[data-tab="import"]');
  await teacherPage.selectOption('#imp-unit', 'l2-voc');
  teacherPage.once('dialog', (d) => d.accept());
  await teacherPage.click('#imp-reset');
  await teacherPage.waitForFunction(() => /已清除/.test(document.getElementById('imp-msg').textContent), null, { timeout: 15000 });
  assert.equal(JSON.parse(world.docs.config).content['l2-voc'], undefined);
});

await step('整個過程沒有 JS 錯誤', async () => {
  const bad = [...studentPage.errors, ...teacherPage.errors].filter((e) => !/403|PERMISSION|Failed to load resource/.test(e));
  assert.equal(bad.length, 0, bad.join('\n'));
});

await world.close();
const failed = results.filter((r) => r[0] === '✗');
console.log(`\n${results.length - failed.length}/${results.length} 通過`);
process.exit(failed.length ? 1 : 0);
