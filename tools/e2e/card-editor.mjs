// 後台題目卡片編輯：單字片語、句型練習一題一張卡片直接改；改了就寫回文字框，檢查、儲存照舊；可以切回「貼上文字」：node tools/e2e/card-editor.mjs
import assert from 'node:assert';
import { startWorld, sleep } from './harness.mjs';
const world = await startWorld({ scriptLatency: 40 });
const g = world.gas;
const unit = (id, type) => ({ id, title: id, type, lesson: 1, topic: '', visible: true, disabled: [], questionCount: 4, custom: true });
g.api('saveAllSettings', [[], [unit('v1', 'vocab'), unit('p1', 'pattern'), unit('r1', 'reading')]]);
g.api('saveContent', ['r1', { title: 'Tea', topic: 'Tea', passage: ['Tea is good for you and many people drink it.'], questions: [{ skill: '細節', q: 'What is tea?', options: ['Good', 'Bad', 'Cold', 'Old'], answer: 0, explain: '解析', key: 'Tea is good for you' }] }, true]);
const ex = (w) => [1, 2, 3].map((i) => ({ ex: `Sentence ${i} with [${w}] here.`, zh: `第 ${i} 句。` }));
g.api('saveContent', ['v1', { topic: 'T', words: ['apple', 'banana', 'cherry', 'dates'].map((w) => ({ word: w, pos: 'n.', zh: '字' + w, examples: ex(w) })) }, true]);
g.api('saveContent', ['p1', { items: [
  { type: 'mc', tag: 'so…that', q: 'It was so ____ that we stayed in.', options: ['cold', 'colder', 'coldly', 'coldest'], answer: 0, explain: '解析一' },
  { type: 'fill', tag: 'so…that', q: 'She was so ____ that she cried.', answer: 'sad|upset', hint: '難過', explain: '解析二' },
  { type: 'apply', tag: 'so…that', zh: '他太累了，所以睡著了。', words: ['He', 'was', 'so', 'tired', 'that', 'he', 'slept'], answer: 'He was so tired that he slept.', explain: '解析三' },
] }, true]);

let bad = 0;
const step = async (n, f) => { try { await f(); console.log('✓', n); } catch (e) { bad++; console.log('✗', n, '\n  ', String(e.message).split('\n')[0]); } };
const ctx = await world.newContext({ viewport: { width: 1280, height: 900 } });
const t = await world.newPage(ctx, { staff: 'teacher@example.com' });
const errs = []; t.on('pageerror', (e) => errs.push(e.message));
const open = async (id) => {
  await t.goto(world.base + `/admin.html#unit/${id}/content`); await sleep(2500);
  await t.click('[data-uc="edit"]'); await sleep(1500);
};
const ta = (id) => t.evaluate((i) => document.getElementById(i).value, id);
const vCards = '.ced[data-for="v-text"] .ced-card';
const pCards = '.ced[data-for="t-text"] .ced-card';

await step('單字：打開編輯就是卡片，一個字一張，例句一句一列', async () => {
  await open('v1');
  assert.equal(await t.locator(vCards).count(), 4);
  assert.equal(await t.isVisible('#v-text'), false, '文字框收起來');
  const first = t.locator(vCards).first();
  assert.equal(await first.locator('[data-f="en"]').inputValue(), 'apple');
  assert.equal(await first.locator('.ced-ex').count(), 3);
  assert.match(await first.locator('.ced-cnt').textContent(), /3 \/ 5/);
});
await step('單字：改中文、加一句例句、刪一句，文字框跟著變', async () => {
  const first = t.locator(vCards).first();
  await first.locator('[data-f="zh"]').fill('蘋果');
  assert.match(await ta('v-text'), /^apple \| n\. \| 蘋果 \|/);
  await first.locator('[data-act="addex"]').click();
  await first.locator('.ced-ex').nth(3).locator('[data-f="s"]').fill('I like [apple] pie.');
  await first.locator('.ced-ex').nth(3).locator('[data-f="z"]').fill('我喜歡蘋果派。');
  const line = (await ta('v-text')).split('\n')[0];
  assert.match(line, /Sentence 3 with \[apple\] here\. ; I like \[apple\] pie\. \| 第 1 句。 ; 第 2 句。 ; 第 3 句。 ; 我喜歡蘋果派。$/);
  await first.locator('.ced-ex').nth(0).locator('[data-act="delex"]').click();
  assert.doesNotMatch((await ta('v-text')).split('\n')[0], /Sentence 1/);
  assert.match((await ta('v-text')).split('\n')[0], /\| 第 2 句。 ; 第 3 句。 ; 我喜歡蘋果派。$/, '翻譯跟著同一句刪掉');
});
await step('單字：往下移、刪除（要確認）、新增', async () => {
  await t.locator(vCards).first().locator('[data-act="down"]').click();
  assert.match((await ta('v-text')).split('\n')[1], /^apple/);
  await t.locator(vCards).last().locator('[data-act="del"]').click();
  await t.waitForSelector('dialog[open]'); await t.click('dialog.ask[open] [data-a="1"]'); await sleep(400);
  assert.equal(await t.locator(vCards).count(), 3);
  await t.click('.ced[data-for="v-text"] [data-add]');
  assert.equal(await t.locator(vCards).count(), 4);
  assert.equal(await t.evaluate(() => document.activeElement.dataset.f), 'en', '新卡片的英文欄已經可以打字');
  await t.keyboard.type('grape');
  assert.match(await ta('v-text'), /\ngrape$/);
});
await step('單字：預覽與檢查照舊；點問題跳到那一張卡片', async () => {
  await t.click('#imp-check'); await sleep(600);
  const jump = t.locator('.lint .jump[data-line]').first();
  assert.ok(await jump.count(), '新增的空單字要被抓出來');
  await jump.click(); await sleep(300);
  assert.equal(await t.evaluate(() => !!document.querySelector('.ced-card.flash-box')), true, '跳到卡片並標出來');
});
await step('單字：AI 等程式直接改文字框，卡片自動重畫；切到貼上文字、再切回卡片', async () => {
  await t.evaluate(() => { document.getElementById('v-text').value = 'kiwi | n. | 奇異果 | I eat a [kiwi]. | 我吃奇異果。'; });
  assert.equal(await t.locator(vCards).count(), 1);
  await t.click('.ced[data-for="v-text"] [data-m="text"]');
  assert.equal(await t.isVisible('#v-text'), true);
  assert.equal(await t.locator(vCards).first().isVisible(), false);
  await t.fill('#v-text', 'kiwi | n. | 奇異果\nlemon | n. | 檸檬');
  await t.click('.ced[data-for="v-text"] [data-m="cards"]');
  assert.equal(await t.locator(vCards).count(), 2);
});
await step('句型：選擇、填空、應用各一張卡片；點字母換正確答案', async () => {
  await t.evaluate(() => localStorage.setItem('b5a:editMode', 'cards'));
  await open('p1');
  assert.equal(await t.locator(pCards).count(), 3);
  const mc = t.locator(pCards).first();
  assert.equal(await mc.locator('.ced-opt').count(), 4);
  assert.equal(await mc.locator('.ced-opt.on [data-f="opt"]').inputValue(), 'cold');
  await mc.locator('.ced-key').nth(2).click();
  assert.match(await ta('t-text'), /答案：C/);
  assert.equal(await t.locator(pCards).first().locator('.ced-opt.on [data-f="opt"]').inputValue(), 'coldly');
  await t.locator(pCards).first().locator('.ced-key').nth(0).click();
  const fill = t.locator(pCards).nth(1);
  assert.equal(await fill.locator('[data-f="answer"]').inputValue(), 'sad|upset');
  const ap = t.locator(pCards).nth(2);
  assert.equal(await ap.locator('[data-f="answer"]').inputValue(), 'He was so tired that he slept.');
});
await step('句型：新增一題選擇題、改題型，檢查後可以儲存', async () => {
  await t.click('.ced[data-for="t-text"] [data-add="mc"]');
  const nw = t.locator(pCards).last();
  assert.equal(await nw.locator('[data-f="tag"]').inputValue(), 'so…that', '句型沿用上一題');
  await nw.locator('[data-f="q"]').fill('The box was so ____ that I could not lift it.');
  for (const [k, v] of [[0, 'heavy'], [1, 'heavily'], [2, 'heavier'], [3, 'heaviest']]) await nw.locator('[data-f="opt"]').nth(k).fill(v);
  await nw.locator('.ced-key').nth(0).click();
  await t.locator(pCards).last().locator('[data-f="explain"]').fill('so + 形容詞 + that。');
  await t.locator(pCards).nth(1).locator('[data-act="kind"][data-k="mc"]').click();
  assert.equal(await t.locator(pCards).nth(1).locator('.ced-opt.on [data-f="opt"]').inputValue(), 'sad|upset', '原本的答案變成選項 A');
  await t.locator(pCards).nth(1).locator('[data-act="kind"][data-k="fill"]').click();
  await t.locator(pCards).nth(1).locator('[data-f="answer"]').fill('sad|upset');
  await t.click('#imp-check'); await sleep(800);
  assert.equal(await t.locator('.lint li.err').count(), 0, await t.textContent('#imp-report'));
  assert.equal(await t.isDisabled('#imp-save'), false, '檢查通過可以儲存');
});
await step('第一題前面有其他文字：停在貼上文字並說明', async () => {
  await t.evaluate(() => { document.getElementById('t-text').value = '這是我的題目\n[選擇]\n題目：a ____\n選項：x | y\n答案：A'; });
  assert.equal(await t.isVisible('#t-text'), true);
  assert.match(await t.textContent('.ced[data-for="t-text"] .ced-why'), /第一題前面/);
});
await step('課文理解：改表單裡的題目，下方「批次貼上文字格式」跟著同步；按「填入表單」不會被蓋回去', async () => {
  await open('r1');
  await t.locator('#r-bulk-box summary').click();
  assert.match(await ta('r-bulk'), /Q1：What is tea\?/, '一打開就是目前的內容');
  await t.locator('#r-qs .q-text').first().fill('Why do people drink tea?');
  await sleep(500);
  assert.match(await ta('r-bulk'), /Q1：Why do people drink tea\?/);
  await t.locator('#r-qs input[type=radio]').nth(1).check(); await sleep(500);
  assert.match(await ta('r-bulk'), /Q1答案：B/);
  await t.fill('#r-bulk', (await ta('r-bulk')).replace('Why do people drink tea?', 'Is tea good?'));
  await t.click('#r-bulk-go'); await sleep(800);
  assert.equal(await t.locator('#r-qs .q-text').first().inputValue(), 'Is tea good?', '文字套回表單');
  assert.match(await ta('r-bulk'), /Is tea good\?/);
  assert.match(await t.textContent('#r-bulk-msg'), /已填入/, '填入表單的結果訊息還在');
});
await step('沒有 JS 錯誤', async () => { assert.deepEqual(errs, []); });
await world.close();
if (bad) { console.log(bad + ' 項失敗'); process.exit(1); }
console.log('卡片編輯測試通過');
process.exit(0);
