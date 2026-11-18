// 句型練習：作答、看答案與解析、複習的每一個畫面都不能出現 undefined／null（正式測驗答案藏起來、交卷後才拿到）：node tools/e2e/pattern-text.mjs
import assert from 'node:assert';
import { startWorld, sleep } from './harness.mjs';
const world = await startWorld({ scriptLatency: 60 });
const g = world.gas;
const unit = (id, title) => ({ id, title, type: 'pattern', lesson: 3, topic: '', visible: true, disabled: [], questionCount: 10, custom: true });
g.api('saveAllSettings', [[], [unit('p-plain', 'L3 句型'), unit('p-learn', 'L3 句型說明')]]);
const items = (tag) => [
  { type: 'mc', tag, q: `${tag} one ____ here.`, options: ['one', 'two', 'three', 'four'], answer: 1, explain: '' },
  { type: 'mc', tag, q: `${tag} two ____ here.`, options: ['one', 'two', 'three', 'four'], answer: 2, explain: '選擇解析' },
  { type: 'fill', tag, q: `${tag} I ____ fast.`, answer: 'run|ran', hint: 'r', explain: '' },
  { type: 'apply', tag, zh: '我跑得快。', words: ['I', 'run', 'fast'], answer: 'I run fast.', explain: '' },
];
const guide = (tag, name) => ({ tag, name, use: '用途', parts: [{ t: '主詞', eg: 'I' }, { t: '動詞', eg: 'run' }],
  examples: [1, 2, 3].map((i) => ({ en: `{0:I} {1:run} fast ${i}.`, zh: '我跑得快。' })), pitfall: '易錯',
  checks: [{ type: 'mc', q: 'Check ____ .', options: ['ok', 'no'], answer: 0, explain: '' }] });
const s1 = g.api('saveContent', ['p-plain', { items: [...items('Alpha'), ...items('Beta')] }, true]);
const s2 = g.api('saveContent', ['p-learn', { items: [...items('Alpha'), ...items('Beta')], guides: [guide('Alpha', '甲句型'), guide('Beta', '乙句型')] }, true]);
assert.ok(s1.ok !== false && s2.ok !== false, JSON.stringify([s1, s2]));

let bad = 0;
const step = async (n, f) => { try { await f(); console.log('✓', n); } catch (e) { bad++; console.log('✗', n, '\n  ', String(e.message).split('\n')[0]); } };
const seen = [];
const scan = async (p, where) => {
  const t = await p.evaluate(() => document.getElementById('app').innerText);
  const m = /[^\n]{0,40}\b(undefined|null|NaN)\b[^\n]{0,40}/.exec(t);
  if (m) seen.push(`${where}：「${m[0].trim()}」`);
};
// 隨便作答：選擇題選第 1 個、填空打 xx、應用題點第一個字
const answerHere = async (p, v) => {
  const opts = v.locator('.opt:not([disabled])');
  if (await opts.count()) { await opts.first().click(); return true; }
  const inp = v.locator('input.fill-input, input[type="text"]:not([disabled])');
  if (await inp.count()) { await inp.first().fill('xx'); const ck = v.locator('[data-check]:not([disabled])'); if (await ck.count()) await ck.first().click(); return true; }
  const chip = v.locator('.chip:not([disabled]), .word-chip:not([disabled]), [data-w]:not([disabled])');
  if (await chip.count()) { await chip.first().click(); return true; }
  return false;
};

const ctx = await world.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
const p = await world.newPage(ctx, { student: true });

await step('一般句型練習（沒有句型說明）：作答 → 交卷 → 看答案與解析，畫面上沒有 undefined', async () => {
  await p.goto(world.base + '/#/u/p-plain'); await p.waitForSelector('[data-start]'); await sleep(400);
  await p.tap('[data-start]');
  for (let i = 0; i < 80; i++) {
    await sleep(300);
    if (await p.locator('.result').count()) break;
    await scan(p, '作答中');
    const host = p.locator('#app');
    await answerHere(p, host);
    const sub = p.locator('[data-submit-all], [data-finish], .q-dock [data-next]:not([hidden]):not([disabled]), [data-next]:not([hidden]):not([disabled])');
    if (await sub.count()) { await sub.first().click().catch(() => {}); continue; }
    const ok = p.locator('dialog.modal[open] [value="ok"]'); if (await ok.count()) await ok.click();
  }
  await p.waitForSelector('.result', { timeout: 15000 });
  await scan(p, '成績畫面');
  const rv = p.locator('.result .btn.primary');
  await rv.first().click(); await sleep(1200);
  await scan(p, '看答案與解析');
  for (let i = 0; i < 20; i++) { const nx = p.locator('[data-next]:not([hidden]):not([disabled])'); if (!(await nx.count())) break; await nx.first().click().catch(() => {}); await sleep(400); await scan(p, '檢討第 ' + (i + 2) + ' 題'); }
});
await step('循序漸進版（有句型說明）：認識 → 檢測 → 驗收 → 每段結果 → 交卷，畫面上沒有 undefined', async () => {
  await p.evaluate(() => { delete document.body.dataset.busy; });
  await p.goto(world.base + '/#/u/p-learn'); await p.reload(); await p.waitForSelector('[data-start]'); await sleep(400);
  await p.tap('[data-start]');
  let done = false;
  for (let i = 0; i < 250 && !done; i++) {
    await sleep(300);
    if (await p.locator('.result').count()) { done = true; break; }
    await scan(p, '循序漸進');
    const v = p.locator('.ln-body:not(.leaving)').last();
    if (await v.locator('[data-m="read"]').count()) { await v.locator('[data-m="read"]').click(); continue; }
    if (await p.locator('.ln-bar [data-go]:not([disabled])').count()) { await p.locator('.ln-bar [data-go]').click(); continue; }
    await answerHere(p, v);
    const next = p.locator('.ln-bar [data-next]:not([disabled])');
    if (await next.count()) await next.click();
  }
  assert.ok(done, '沒有走到成績畫面');
  await scan(p, '循序漸進成績');
});
await step('選擇題答案存成 1、"1"、"B"、"B."、選項原文都認得；認不出來時不顯示 undefined', async () => {
  const r = await p.evaluate(async () => {
    const { mcIndex, flattenPattern, correctText, explainBlockHTML } = await import('/js/components/items.js');
    const o = ['one', 'two', 'three'];
    const bad = flattenPattern([{ type: 'mc', q: 'x ____', options: o, answer: 'Z', explain: '' }])[0];
    return { v: [1, '1', 'B', 'b.', 'two', 'B. two', 7, '', null].map((a) => mcIndex(a, o)), ct: correctText(bad), ex: explainBlockHTML(bad, false) };
  });
  assert.deepEqual(r.v, [1, 1, 1, 1, 1, 1, undefined, undefined, undefined]);
  assert.equal(r.ct, '');
  assert.ok(!/undefined/.test(r.ex), r.ex);
});
await step('沒有任何畫面出現 undefined／null／NaN', async () => { assert.deepEqual(seen, []); });
await world.close();
if (bad) { console.log(bad + ' 項失敗'); process.exit(1); }
console.log('句型練習文字檢查通過');
process.exit(0);
