// 學生實際作答一輪（單字、課文），檢查有沒有錯誤並截圖：node tools/e2e/quiz.mjs [輸出資料夾]
import assert from 'node:assert';
import { startWorld, sleep } from './harness.mjs';
const out = process.argv[2] || '/tmp/shots';
const world = await startWorld({ scriptLatency: 200 });
const g = world.gas;
g.api('saveAllSettings', [[], [
  { id: 'l1-voc', title: 'L1 單字片語', type: 'vocab', lesson: 1, topic: '', visible: true, disabled: [], questionCount: 4, custom: true },
  { id: 'l1-reading', title: 'L1 課文理解', type: 'reading', lesson: 1, topic: '', visible: true, disabled: [], questionCount: 5, custom: true },
]]);
const words = ['apple', 'bread', 'candy', 'dance', 'eagle', 'flame', 'grape', 'honey'].map((w, i) => ({ word: w, pos: 'n.', zh: '中文' + i, example: `I like [${w}] a lot.`, exampleZh: '我很喜歡。' }));
g.api('saveContent', ['l1-voc', { topic: 'Food', words }, true]);
g.api('saveContent', ['l1-reading', { title: 'Tea', topic: 'Tea', passage: ['Tea is a drink made from leaves. People all over the world enjoy it every day.', 'It can be hot or cold, sweet or plain.'], questions: [
  { skill: '細節', q: 'What is tea made from?', options: ['Leaves', 'Rocks', 'Milk', 'Sand'], answer: 0, explain: '第一句。', ref: '1-1', key: 'made from leaves' },
  { skill: '主旨', q: 'Who enjoys tea?', options: ['Nobody', 'Only kids', 'People worldwide', 'Cats'], answer: 2, explain: '第二句。' },
] }, true]);
const scoreBodies = [];
const origPost = world.gas.post.bind(world.gas);
world.gas.post = (b) => { const j = JSON.parse(b); if (!j.api) scoreBodies.push(j); return origPost(b); };

const results = [];
const step = async (name, fn) => { try { await fn(); console.log('✓', name); results.push(1); } catch (e) { console.log('✗', name, '\n  ', String(e.message).split('\n').join('\n   ')); } };

for (const [label, w, h] of [['m', 390, 844], ['d', 1280, 800]]) {
  const ctx = await world.newContext({ viewport: { width: w, height: h } });
  const p = await world.newPage(ctx, { student: true });
  const shot = async (n) => { await sleep(400); await p.screenshot({ path: `${out}/q${label}-${n}.png`, fullPage: true }); };
  await step(`[${label}] 課文：作答 → 交卷 → 成績 → 檢討`, async () => {
    await p.goto(world.base + '/#/u/l1-reading'); await p.waitForSelector('[data-start]');
    await p.click('[data-start]'); await p.waitForSelector('.pq');
    await shot('r1-questions');
    await p.click('.pq[data-q="0"] .opt[data-i="0"]'); await p.click('.pq[data-q="1"] .opt[data-i="1"]');
    await p.click('[data-submit-btn]');
    await p.waitForSelector('dialog.modal[open]'); await shot('r1b-confirm');
    await p.locator('dialog.modal[open] .btn.primary').click();
    await p.waitForSelector('.result', { timeout: 8000 });
    await shot('r2-result');
    await p.getByRole('button', { name: /開始檢討/ }).click(); await sleep(400);
    await shot('r3-review');
    for (let i = 0; i < 4 && await p.locator('.review-bar, .rv-card').count(); i++) {
      const nx = p.locator('[data-next]'); if (!(await nx.count())) break;
      await nx.first().click(); await sleep(250);
    }
    await shot('r4-after-review');
  });
  await step(`[${label}] 單字：三段作答 → 成績`, async () => {
    await p.goto(world.base + '/#/u/l1-voc'); await p.waitForSelector('[data-start]');
    await p.click('[data-start]');
    let done = false;
    for (let i = 0; i < 80 && !done; i++) {
      await sleep(180);
      if (await p.locator('.result').count()) { done = true; break; }
      if (await p.locator('[data-continue]').count()) { await shot('v-between'); await p.click('[data-continue]'); continue; }
      if (await p.locator('[data-next]:not([hidden])').count()) { await p.click('[data-next]'); continue; }
      const opts = p.locator('.opt:not([disabled])');
      if (await opts.count()) { await opts.first().click(); continue; }
      const spell = p.locator('.spell-input');
      if (await spell.count()) {
        if (i % 5 === 0) await shot('v-spell');
        await spell.fill('zzzzzzzz'); await p.keyboard.press('Enter');
        const chk = p.locator('[data-check]'); if (await chk.count()) await chk.click().catch(() => {});
      }
    }
    assert.ok(done, '沒有走到成績畫面');
    await shot('v-result');
  });
  await step(`[${label}] 作答過程沒有錯誤`, async () => {
    const bad = p.errors.filter((e) => !/favicon/.test(e));
    assert.equal(bad.length, 0, bad.join('\n'));
  });
  await ctx.close();
}
await sleep(1500);
console.log('伺服器核對結果：', JSON.stringify((g.sheets.get('scores')?.rows || []).slice(1).map((r) => [r[4], r[9], r[18]])));
console.log('成績送到伺服器：', scoreBodies.length, '筆；scores 分頁列數：', g.sheets.get('scores') ? g.sheets.get('scores').getLastRow() - 1 : 0);
await world.close();
