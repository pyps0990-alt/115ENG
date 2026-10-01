// 句型練習、段考複習：學生實際作答一輪，伺服器核對成績：node tools/e2e/types.mjs [輸出資料夾]
import assert from 'node:assert';
import { startWorld, sleep } from './harness.mjs';
const out = process.argv[2] || '/tmp/shots';
const world = await startWorld({ scriptLatency: 100 });
const g = world.gas;
g.api('saveAllSettings', [[], [
  { id: 'l2-pat', title: 'L2 句型練習', type: 'pattern', lesson: 2, topic: '', visible: true, disabled: [], questionCount: 10, custom: true },
  { id: 'l2-exam', title: 'L2 段考複習', type: 'exam', lesson: 2, topic: '', visible: true, disabled: [], questionCount: 10, custom: true },
]]);
const pat = { topic: '倒裝', items: [
  { type: 'mc', tag: 'not only', q: 'Not only ____ the exam, but he also won.', options: ['passed', 'did he pass', 'he passed', 'has passed'], answer: 1, explain: '倒裝。' },
  { type: 'fill', tag: 'so…that', q: 'It was so ____ that we cried.', answer: 'touching|moving', hint: '（感人）', explain: 'so…that。' },
  { type: 'apply', tag: '強調句', zh: '正是她的努力讓她成功。', words: ['that', 'her hard work', 'It', 'made', 'was', 'her', 'succeed'], answer: 'It was her hard work that made her succeed.', explain: '強調句。' },
] };
const exam = { topic: '段考', blocks: [
  { type: 'mc', q: 'Her ____ helped us.', options: ['contribution', 'competition', 'connection', 'conclusion'], answer: 0, explain: '貢獻。' },
  { type: 'spell', q: 'Stay ____ now.', hint: 'c（冷靜）', answer: 'calm', explain: 'calm。' },
  { type: 'reading', title: 'Tea', passage: ['Tea is a drink made from leaves. People enjoy it.', 'It can be hot or cold.'], questions: [
    { key: 'made from leaves', skill: '細節', q: 'What is tea made from?', options: ['Leaves', 'Rocks', 'Milk', 'Sand'], answer: 0, explain: '第一句。' }] },
  { type: 'phrase', q: 'We are ____ seeing you.', hint: '期待', answer: 'looking forward to', explain: 'x' },
  { type: 'bank', title: 'Nap', passage: ['A nap can (1) memory. It is not (2).'], bank: ['boost', 'unproductive', 'delay'], blanks: [{ answer: 0, explain: 'a' }, { answer: 1, explain: 'b' }] },
  { type: 'struct', title: 'Smile', passage: ['Smiles are common. (1) Long ago people rarely smiled.'], bank: ['Things changed over time.', 'Cats sleep.'], blanks: [{ answer: 0, explain: 'c' }] },
  { type: 'cloze', title: 'Change', passage: ['Tom felt (1) at first. (2), he made friends.'], blanks: [
    { options: ['lonely', 'noisy', 'hungry', 'proud'], answer: 0, explain: '孤單。' }, { options: ['However', 'Therefore', 'Besides', 'Otherwise'], answer: 0, explain: '轉折。' }] },
  { type: 'translate', zh: '她決定再試一次。', answer: 'She decided to try again.|She made up her mind to try once more.', explain: 'decide to + V' },
  { type: 'essay', q: '寫一篇短文：你克服困難的經驗。', minWords: 20, sample: 'Last year I was afraid of speaking in public. I practiced every night and finally succeeded.', explain: '內容、段落、文法' },
] };
g.api('saveAllSettings', [[], [
  { id: 'l2-pat', title: 'L2 句型練習', type: 'pattern', lesson: 2, topic: '', visible: true, disabled: [], questionCount: 10, custom: true },
  { id: 'l2-exam', title: 'L2 段考複習', type: 'exam', lesson: 2, topic: '', visible: true, disabled: [], questionCount: 10, custom: true },
  { id: 'l2-drag', title: 'L2 拖動', type: 'pattern', lesson: 2, topic: '', visible: true, disabled: [], questionCount: 1, custom: true },
]]);
g.api('saveContent', ['l2-drag', { items: [{ type: 'apply', zh: '我喜歡蘋果。', words: ['I', 'like', 'red', 'apples', 'a', 'lot'], answer: 'I like red apples a lot.', explain: 'x' }] }, true]);
g.api('saveContent', ['l2-pat', pat, true]);
g.api('saveContent', ['l2-exam', exam, true]);

const bad1 = JSON.stringify(g.api('saveContent', ['l2-pat', { items: [{ type: 'apply', zh: '好', words: ['a', 'b', 'c'], answer: 'a b d' }] }, true]));
assert(/排成/.test(bad1), '伺服器要擋掉單字對不上答案的應用題：' + bad1);
const bad2 = JSON.stringify(g.api('saveContent', ['l2-exam', { blocks: [{ type: 'cloze', passage: ['none'], blanks: [{ options: ['a', 'b'], answer: 0 }] }] }, true]));
assert(/空格/.test(bad2), '綜合題文章缺空格要擋：' + bad2);
const bad3 = JSON.stringify(g.api('saveContent', ['l2-exam', { blocks: [{ type: 'reading', passage: ['Tea is good.'], questions: [{ q: 'x?', options: ['a', 'b'], answer: 0 }] }] }, true]));
assert(/原文依據/.test(bad3), '閱讀題沒有原文依據要擋：' + bad3);
const bad4 = JSON.stringify(g.api('saveContent', ['l2-exam', { blocks: [{ type: 'reading', passage: ['Tea is good.'], questions: [{ q: 'x?', options: ['a', 'b'], answer: 0, key: 'not here' }] }] }, true]));
assert(/找不到/.test(bad4), '關鍵字句不在文章裡要擋：' + bad4);
let fails = 0;
const step = async (name, fn) => { try { await fn(); console.log('✓', name); } catch (e) { fails++; console.log('✗', name, '\n  ', String(e.message).split('\n').join('\n   ')); } };
for (const [label, w, h] of [['m', 390, 844], ['d', 1280, 800]]) {
  const ctx = await world.newContext({ viewport: { width: w, height: h } });
  const p = await world.newPage(ctx, { student: true });
  const shot = async (n) => { await sleep(300); await p.screenshot({ path: `${out}/t${label}-${n}.png`, fullPage: true }); };
  await step(`[${label}] 首頁有四類卡片標籤`, async () => {
    await p.goto(world.base + '/'); await p.waitForSelector('.unit-tile');
    const t = await p.locator('.unit-tile').allTextContents();
    assert(t.some((x) => x.includes('句型練習')) && t.some((x) => x.includes('段考複習')), t.join('|'));
    await shot('home');
  });
  await step(`[${label}] 句型練習：選擇、填空、應用 → 成績`, async () => {
    await p.goto(world.base + '/#/u/l2-pat'); await p.waitForSelector('[data-start]');
    await p.click('[data-start]');
    let done = false;
    for (let i = 0; i < 60 && !done; i++) {
      await sleep(200);
      if (await p.locator('.result').count()) { done = true; break; }
      if (await p.locator('[data-next]:not([hidden])').count()) { await p.click('[data-next]'); continue; }
      const opts = p.locator('.opt:not([disabled])');
      if (await opts.count()) { await opts.nth(1).click(); continue; }
      const fill = p.locator('.fill-input:not([disabled])');
      if (await fill.count()) { await fill.fill('touching'); await p.keyboard.press('Enter'); if (i === 3) await shot('pat-fill'); continue; }
      const words = p.locator('.chip-word:not([disabled])');
      if (await words.count()) {
        await shot('pat-apply');
        for (const t of ['It', 'was', 'her hard work', 'that', 'made', 'her', 'succeed']) await p.locator('.bank .chip-word:not([disabled])', { hasText: new RegExp('^' + t + '$') }).first().click();
        await p.locator('[data-check]').click();
      }
    }
    assert.ok(done, '沒有走到成績畫面'); await shot('pat-result');
  });
  await step(`[${label}] 應用題：拖動排列、調整順序、拖回、不自動排序`, async () => {
    await p.goto(world.base + '/#/u/l2-drag'); await p.waitForSelector('[data-start]');
    await p.click('[data-start]'); await p.waitForSelector('.bank .chip-word');
    const chip = (t, where) => p.locator(`${where} .chip-word`, { hasText: new RegExp('^' + t + '$') }).first();
    const lineText = async () => (await p.locator('.build-line .chip-word').allTextContents()).join(' ');
    const bankBefore = (await p.locator('.bank .chip-word').allTextContents()).join(' ');
    const drag = async (from, toX, toY) => {
      const b = await from.boundingBox();
      await p.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await p.mouse.down();
      await p.mouse.move(b.x + b.width / 2 + 20, b.y + b.height / 2 - 20, { steps: 3 });
      await p.mouse.move(toX, toY, { steps: 8 });
      return async () => p.mouse.up();
    };
    const lb = async () => (await p.locator('.build-line').boundingBox());
    // 依序拖進：like、I（放到最前面）、apples
    let r = await lb();
    await (await drag(chip('like', '.bank'), r.x + 20, r.y + r.height / 2))();
    assert.equal(await lineText(), 'like');
    r = await lb();
    await (await drag(chip('I', '.bank'), r.x + 4, r.y + r.height / 2))();
    assert.equal(await lineText(), 'I like');
    r = await lb();
    await (await drag(chip('apples', '.bank'), r.x + r.width - 4, r.y + r.height / 2))();
    assert.equal(await lineText(), 'I like apples');
    // 點一下加 red 到最後，再把 red 拖到 apples 前面
    await chip('red', '.bank').click();
    assert.equal(await lineText(), 'I like apples red');
    const apples = await chip('apples', '.build-line').boundingBox();
    await (await drag(chip('red', '.build-line'), apples.x + 3, apples.y + apples.height / 2))();
    assert.equal(await lineText(), 'I like red apples');
    // 拖出句子＝拿掉
    const bk = await p.locator('.bank').boundingBox();
    await (await drag(chip('apples', '.build-line'), bk.x + 10, bk.y + bk.height - 4))();
    assert.equal(await lineText(), 'I like red');
    await chip('apples', '.bank').click();
    await chip('a', '.bank').click(); await chip('lot', '.bank').click();
    assert.equal(await lineText(), 'I like red apples a lot');
    assert.equal((await p.locator('.bank .chip-word').allTextContents()).join(' '), bankBefore, '下方單字順序不可改變');
    await p.locator('[data-check]').click();
    await p.waitForSelector('.build-line.ok');
    await shot('drag-ok');
    await p.locator('[data-next]:not([hidden])').click(); await p.waitForSelector('.result', { timeout: 8000 });
  });
  await step(`[${label}] 句型練習：錯題重練（不計成績）`, async () => {
    const q2 = await world.newContext({ viewport: { width: w, height: h } });
    const p2 = await world.newPage(q2, { student: true });
    await p2.goto(world.base + '/#/u/l2-drag'); await p2.waitForSelector('[data-start]');
    await p2.click('[data-start]'); await p2.waitForSelector('.bank .chip-word');
    for (const t of ['lot', 'a', 'I']) await p2.locator('.bank .chip-word:not([disabled])', { hasText: new RegExp('^' + t + '$') }).first().click();
    await p2.locator('[data-check]').click(); await p2.waitForSelector('.build-line.no');
    await p2.locator('[data-next]:not([hidden])').click(); await p2.waitForSelector('.result');
    await p2.getByRole('button', { name: /重練錯的 1 題/ }).click();
    await p2.waitForSelector('.bank .chip-word');
    assert.match(await p2.locator('.level-chip').textContent(), /錯題重練/);
    for (const t of ['I', 'like', 'red', 'apples', 'a', 'lot']) await p2.locator('.bank .chip-word:not([disabled])', { hasText: new RegExp('^' + t + '$') }).first().click();
    await p2.locator('[data-check]').click(); await p2.waitForSelector('.build-line.ok');
    await p2.locator('[data-next]:not([hidden])').click(); await p2.waitForSelector('.result');
    assert.match(await p2.locator('.result').textContent(), /不計入成績/);
    assert.equal(p2.errors.filter((e) => !/favicon/.test(e)).length, 0, p2.errors.join('\n'));
    await q2.close();
  });
  await step(`[${label}] 段考複習：一頁作答 → 交卷 → 成績 → 檢討`, async () => {
    await p.goto(world.base + '/#/u/l2-exam'); await p.waitForSelector('[data-start]');
    await p.click('[data-start]'); await p.waitForSelector('.exam-body');
    await shot('exam-page');
    // 題號導覽：看作答狀態、點題號前往
    await p.click('[data-nav-btn]'); await p.waitForSelector('.exam-nav:not([hidden])');
    assert.equal(await p.locator('.en-chip').count(), 11, '每題一個題號');
    assert.equal(await p.locator('.en-chip.done').count(), 0, '一開始都沒作答');
    await p.locator('.pq[data-id="b0"] .opt').first().click();
    assert.equal(await p.locator('.en-chip.done').count(), 1, '作答後題號變色');
    await p.locator('.en-chip[data-go="b8"]').click();
    await sleep(900);
    const inView = await p.evaluate(() => { const r = document.querySelector('.pq[data-id="b8"]').getBoundingClientRect(); return r.top < window.innerHeight && r.bottom > 0; });
    assert(inView, '點題號要捲到那一題');
    await shot('exam-nav');
    if (await p.locator('.exam-nav:not([hidden])').count()) await p.click('[data-nav-close]');
    await p.locator('.pq[data-id="b0"] .opt').first().click();
    await p.locator('.pq[data-id="b1"] [data-spell]').fill('calm');
    await p.locator('.pq[data-id="b2.0"] .opt').nth(1).click(); // 故意答錯
    await p.locator('.pq[data-id="b3"] [data-spell]').fill('Looking Forward To');
    await p.locator('.pq[data-id="b4.0"] select').selectOption('0');
    await p.locator('.pq[data-id="b4.1"] select').selectOption('1');
    await p.locator('.pq[data-id="b5.0"] select').selectOption('0');
    await p.locator('.pq[data-id="b6.0"] .opt').first().click();
    await p.locator('.pq[data-id="b6.1"] .opt').first().click();
    await p.locator('.pq[data-id="b7"] [data-open]').fill('She decided to try again.');
    await p.locator('.pq[data-id="b8"] [data-open]').fill('I once failed a test but I studied harder and passed the next one. It taught me never to give up easily.');
    assert.match(await p.locator('[data-count]').textContent(), /9 \/ 9・寫作 2 \/ 2/);
    assert.match(await p.locator('.pq[data-id="b8"] [data-wc]').textContent(), /^2\d \/ 20 字/);
    await p.click('[data-submit-btn]'); await p.waitForSelector('dialog.modal[open]');
    await p.locator('dialog.modal[open] .btn.primary').click();
    await p.waitForSelector('.result', { timeout: 8000 });
    assert.match(await p.locator('.result').textContent(), /8 \/ 9/);
    assert.match(await p.locator('.result').textContent(), /寫作題（不計分/);
    assert.match(await p.locator('.writing-sum').textContent(), /She decided to try again/);
    await shot('exam-result');
    await p.getByRole('button', { name: /開始檢討/ }).click(); await sleep(400);
    const rvc = await p.locator('.rv-pq, .rv-card').count(); assert(rvc >= 1, 'rv-card=' + rvc + ' ' + (await p.locator('#stage').innerHTML()).slice(0, 600));
    assert.equal(await p.locator('mark.evidence').count(), 1, '檢討時要標亮原文依據');
    assert.match(await p.locator('mark.evidence').textContent(), /made from leaves/);
    await p.locator('[data-next]').first().click(); await sleep(300);
    assert.equal(await p.locator('.open-rv').count(), 1, '檢討要有翻譯對照');
    assert.match(await p.locator('.open-rv').textContent(), /評分重點/);
    await shot('exam-review');
  });
  await step(`[${label}] 段考複習：錯題重練（不計成績）`, async () => {
    const c3 = await world.newContext({ viewport: { width: w, height: h } });
    const p3 = await world.newPage(c3, { student: true });
    await p3.goto(world.base + '/#/u/l2-exam'); await p3.waitForSelector('[data-start]');
    await p3.click('[data-start]'); await p3.waitForSelector('.exam-body');
    await p3.locator('.pq[data-id="b0"] .opt').nth(1).click(); // 答錯
    await p3.locator('.pq[data-id="b1"] [data-spell]').fill('calm'); // 答對
    await p3.click('[data-submit-btn]'); await p3.waitForSelector('dialog.modal[open]');
    await p3.locator('dialog.modal[open] .btn.primary').click(); await p3.waitForSelector('.result', { timeout: 8000 });
    await sleep(900);
    const before = g.sheets.get('scores').getLastRow();
    await p3.getByRole('button', { name: /重練錯的/ }).click(); await p3.waitForSelector('.exam-body');
    assert.match(await p3.locator('.exam-body .eyebrow').first().textContent(), /錯題重練/);
    const left = await p3.locator('.exam-body .pq').count();
    assert(left >= 1 && left < 12, '只剩錯的題目：' + left);
    await p3.locator('.pq[data-id="b0"] .opt').first().click();
    await p3.click('[data-submit-btn]'); await p3.waitForSelector('dialog.modal[open]');
    await p3.locator('dialog.modal[open] .btn.primary').click(); await p3.waitForSelector('.result');
    assert.match(await p3.locator('.result').textContent(), /錯題重練完成/);
    await sleep(900);
    assert.equal(g.sheets.get('scores').getLastRow(), before, '重練不能送出成績');
    assert.equal(p3.errors.filter((e) => !/favicon/.test(e)).length, 0, p3.errors.join('\n'));
    await c3.close();
  });
  await step(`[${label}] 沒有錯誤`, async () => {
    const bad = p.errors.filter((e) => !/favicon/.test(e));
    assert.equal(bad.length, 0, bad.join('\n'));
  });
  await ctx.close();
}
await sleep(1200);
const rows = (g.sheets.get('scores')?.rows || []).slice(1).map((r) => [r[4], r[7], r[8], r[9], r[18]]);
console.log('scores:', JSON.stringify(rows));
assert(rows.length >= 4, '成績沒有送到伺服器');
assert(rows.every((r) => !r[4].replace('作答時間過短', '')), '伺服器核對不應標記問題：' + JSON.stringify(rows));
await world.close();
process.exit(fails ? 1 : 0);
