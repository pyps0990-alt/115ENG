// 後台讀成績偶爾被拒（憑證過期、App Check 驗證失敗）：自動換新憑證重試，不會顯示「讀不到成績」；
// 一直被拒時說明是暫時的、會自動再試，回到分頁時自動重讀：node tools/e2e/admin-perm.mjs
import assert from 'node:assert';
import { startWorld, sleep } from './harness.mjs';
const world = await startWorld({ scriptLatency: 40 });
const g = world.gas;
g.api('saveAllSettings', [[], [{ id: 'u1', title: 'L1 單字', type: 'vocab', lesson: 1, topic: '', visible: true, disabled: [], questionCount: 4, custom: true }]]);
let bad = 0;
const step = async (n, f) => { try { await f(); console.log('✓', n); } catch (e) { bad++; console.log('✗', n, '\n  ', String(e.message).split('\n')[0]); } };
const attempt = { unit: 'u1', mode: 'vocab', pct: 90, cls: '306', seat: '1', name: '王小明', clientTs: '2026-11-04 10:00:00', createdAt: { toMillis: () => Date.now() - 3600000 } };

const open = async (deny) => {
  const ctx = await world.newContext({ viewport: { width: 1280, height: 900 } });
  const t = await world.newPage(ctx, { staff: 'teacher@example.com' });
  await t.addInitScript(([n, a]) => { window.__fb = window.__fb || {}; window.__fb.denyAttempts = n; window.__fb.attempts = [{ ...a, createdAt: { toMillis: () => Date.now() - 3600000 } }]; }, [deny, attempt]);
  await t.goto(world.base + '/admin.html#overview');
  await t.waitForSelector('#app-root:not([hidden])', { timeout: 15000 });
  return t;
};
const sysText = (t) => t.evaluate(() => document.body.innerText);

await step('讀成績被拒 2 次（憑證過期）：自動換新憑證重試，最後讀到，不顯示錯誤', async () => {
  const t = await open(2);
  await t.waitForFunction(() => window.__fb.denyAttempts === 0, null, { timeout: 15000 });
  await sleep(4500);
  const txt = await sysText(t);
  assert.doesNotMatch(txt, /讀不到成績/);
  const log = await t.evaluate(() => window.__fb.log.filter((x) => x[0] === 'appCheckToken').length);
  assert.ok(log >= 1, '有換新 App Check 憑證');
  await t.context().close();
});
await step('一直被拒：說明是暫時的、會自動再試；回到分頁時自動重讀成功', async () => {
  const t = await open(3);
  await t.waitForFunction(() => /讀不到成績/.test(document.body.innerText), null, { timeout: 20000 });
  assert.match(await sysText(t), /暫時沒有讀取權限（已自動重試/);
  await t.evaluate(() => { window.__fb.denyAttempts = 0; Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
  await t.waitForFunction(() => !/讀不到成績/.test(document.body.innerText), null, { timeout: 15000 });
  await t.context().close();
});
await step('閒置超過 10 分鐘再回到後台：先換新憑證，再重新抓成績', async () => {
  const t = await open(0);
  await t.waitForFunction(() => (window.__fb.log || []).some((x) => x[1] === '**/attempts'), null, { timeout: 15000 });
  await sleep(1500);
  const before = await t.evaluate(() => window.__fb.log.filter((x) => x[1] === '**/attempts' || x[0] === 'appCheckToken').length);
  await t.evaluate(() => {
    const vis = (v) => { Object.defineProperty(document, 'visibilityState', { value: v, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); };
    vis('hidden');
    const real = Date.now; Date.now = () => real() + 11 * 60000; // 假裝過了 11 分鐘
    vis('visible');
  });
  await t.waitForFunction((n) => window.__fb.log.filter((x) => x[1] === '**/attempts' || x[0] === 'appCheckToken').length >= n + 2, before, { timeout: 10000 });
  await t.context().close();
});
await step('讀完整版題目被拒：不會退回沒有答案的公開版，改問 Apps Script 拿完整題目', async () => {
  g.api('saveAllSettings', [[], [{ id: 'u1', title: 'L1 單字', type: 'vocab', lesson: 1, topic: '', visible: true, disabled: [], questionCount: 4, custom: true }, { id: 'r1', title: 'L1 閱讀', type: 'reading', lesson: 1, topic: '', visible: true, disabled: [], questionCount: 4, custom: true }]]);
  g.api('saveContent', ['r1', { title: 'Tea', topic: 'Tea', passage: ['Tea is a drink made from leaves.'], questions: [{ ref: '1-1', skill: '細節', q: 'What is tea made from?', options: ['Leaves', 'Rocks'], answer: 0, explain: '第一句。', key: 'made from leaves' }] }, true]);
  const ctx = await world.newContext({ viewport: { width: 1280, height: 900 } });
  const t = await world.newPage(ctx, { staff: 'teacher@example.com' });
  await t.addInitScript(() => { window.__fb = window.__fb || {}; window.__fb.denySecure = true; });
  await t.goto(world.base + '/admin.html#unit/r1/content');
  await t.waitForSelector('#app-root:not([hidden])', { timeout: 15000 }); await sleep(2500);
  const d = await t.evaluate(() => new Promise((ok) => window.fbPublic('content_r1').then(() => ok('public'), (e) => ok('rejected:' + e.code))));
  assert.equal(d, 'rejected:permission-denied', '完整版被拒時要丟出錯誤，不能拿公開版');
  await t.getByRole('button', { name: /編輯題目/ }).first().click(); await sleep(1500);
  await t.waitForFunction(() => document.getElementById('r-passage').value, null, { timeout: 15000 });
  const ans = await t.evaluate(() => { const r = document.querySelector('#r-qs input[type=radio]:checked'); return r ? r.value : null; });
  assert.equal(ans, '0', '編輯畫面的答案還在（從 Apps Script 拿到完整題目）');
  await ctx.close();
});
await world.close?.();
if (bad) { console.log(bad + ' 項失敗'); process.exit(1); }
console.log('後台讀成績權限重試測試通過');
process.exit(0);
