// 句型練習循序漸進版：有句型說明的單元走「認識 → 檢測 → 驗收」，每段伺服器批改，各句型平均配分：node tools/e2e/learn.mjs
import assert from 'node:assert';
import { startWorld, sleep } from './harness.mjs';
const world = await startWorld({ scriptLatency: 100 });
const g = world.gas;
g.api('saveAllSettings', [[], [{ id: 'l3-pat', title: 'L3 句型', type: 'pattern', lesson: 3, topic: '', visible: true, disabled: [], questionCount: 10, custom: true }]]);
// 句型 A 的正確答案都是第 2 個選項，句型 B 都是第 1 個；測試一律選第 2 個 → A 全對、B 全錯 → 50 分
const mk = (tag, word, ans) => [1, 2, 3, 4].map((i) => ({ type: 'mc', tag, q: `${word} ${i} ____ here.`, options: ['one', 'two', 'three', 'four'], answer: ans, explain: '解析' }));
const guide = (tag, name) => ({ tag, name, use: '用途', parts: [{ t: '主詞', eg: 'I' }, { t: '動詞', eg: 'run' }],
  examples: [1, 2, 3].map((i) => ({ en: `{0:I} {1:run} fast ${i}.`, zh: '我跑得快。' })), pitfall: '易錯',
  checks: [{ type: 'mc', q: 'Check ____ .', options: ['ok', 'no'], answer: 0, explain: '檢測解析' }] });
const res = g.api('saveContent', ['l3-pat', { items: [...mk('Alpha', 'AAA', 1), ...mk('Beta', 'BBB', 0)], guides: [guide('Alpha', '甲句型'), guide('Beta', '乙句型')] }, true]);
assert(!/錯|error/i.test(JSON.stringify(res)) || res.ok !== false, JSON.stringify(res));

const ctx = await world.newContext({ viewport: { width: 390, height: 844 } });
const p = await world.newPage(ctx, { student: true });
const answerCalls = [];
p.on('request', (r) => { if (/cloudfunctions/.test(r.url()) && /"op":"answer"/.test(r.postData() || '')) answerCalls.push(JSON.parse(r.postData()).qid); });
await p.goto(world.base + '/#/u/l3-pat'); await p.waitForSelector('[data-start]');
assert.match(await p.locator('.gate-card, main').first().textContent(), /2<\/b>|2 個句型/);
await p.click('[data-start]');
let done = false, sawMode = false, sawSection = 0;
for (let i = 0; i < 200 && !done; i++) {
  await sleep(350);
  if (await p.locator('.result').count()) { done = true; break; }
  const v = p.locator('.ln-body:not(.leaving)').last();
  if (await v.locator('[data-m="read"]').count()) { sawMode = true; await v.locator('[data-m="read"]').click(); continue; }
  if (await p.locator('.ln-sec').count() && await p.locator('.ln-bar [data-go]').count()) { sawSection++; await p.locator('.ln-bar [data-go]').click(); continue; }
  if (await p.locator('.ln-bar [data-go]:not([disabled])').count()) { await p.locator('.ln-bar [data-go]').click(); continue; }
  const opts = v.locator('.opt:not([disabled])');
  if (await opts.count()) {
    const stem = await v.textContent();
    const isCheck = /Check/.test(stem);
    await opts.nth(isCheck ? 0 : 1).click();
    if (isCheck) continue;
  }
  const next = p.locator('.ln-bar [data-next]:not([disabled])');
  if (await next.count()) await next.click();
}
assert.ok(done, '沒有走到成績畫面');
assert.ok(sawMode, '第一次要選認識卡的模式');
assert.equal(sawSection, 2, '每個句型做完都要看到這段的結果');
assert.ok(answerCalls.length >= 4 && answerCalls.length <= 6, '每段 2～3 題交給伺服器批改：' + answerCalls.length);
const txt = await p.locator('.result').textContent();
assert.match(txt, /50%|50 \/ 100/, '各句型平均配分：A 全對、B 全錯應該 50 分：' + txt.slice(0, 200));
const prefs = await p.evaluate(() => localStorage.getItem('b5p:learnPrefs'));
assert.match(prefs, /"mode":"read"/, '模式要記住：' + prefs);
// 通過後複習：題目上方有「看說明」，打開後顯示這個句型的說明
g.api('saveAllSettings', [[], [{ id: 'l3-pat', title: 'L3 句型', type: 'pattern', lesson: 3, topic: '', visible: true, disabled: [], questionCount: 10, custom: true }, { id: 'l3-b', title: 'L3 單句型', type: 'pattern', lesson: 3, topic: '', visible: true, disabled: [], questionCount: 10, custom: true }]]);
g.api('saveContent', ['l3-b', { items: mk('Alpha', 'AAA', 1), guides: [guide('Alpha', '甲句型')] }, true]);
await p.goto(world.base + '/#/u/l3-b'); await p.waitForSelector('[data-start]'); await p.click('[data-start]');
for (let i = 0; i < 120; i++) {
  await sleep(300);
  if (await p.locator('.result').count()) break;
  if (await p.locator('.ln-bar [data-go]:not([disabled])').count()) { await p.locator('.ln-bar [data-go]').click(); continue; }
  const v = p.locator('.ln-body:not(.leaving)').last();
  const opts = v.locator('.opt:not([disabled])');
  if (await opts.count()) { const isCheck = /Check/.test(await v.textContent()); await opts.nth(isCheck ? 0 : 1).click(); if (isCheck) continue; }
  const nx = p.locator('.ln-bar [data-next]:not([disabled])'); if (await nx.count()) await nx.click();
}
assert.match(await p.locator('.result').textContent(), /100/);
await p.goto(world.base + '/#/u/l3-b'); await p.reload(); await p.waitForSelector('[data-start]:not([disabled])');
await p.click('[data-start]');
await p.waitForSelector('.ln-peek', { timeout: 8000 });
assert.equal(await p.locator('.ln-body').count(), 0, '複習不是循序漸進版');
await p.locator('.ln-peek summary').click();
assert.match(await p.locator('.ln-peek').textContent(), /甲句型[\s\S]*用途[\s\S]*易錯/);
await world.close();
console.log('句型練習循序漸進版測試通過');
