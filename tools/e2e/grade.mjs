// 伺服器計分（js/grade.js）要跟網站判斷的一模一樣：用網站自己的出題程式產生題目、模擬作答，比對兩邊算出來的分數；
// 再模擬竄改（把答錯改成答對、改分數、刪掉答錯的題目、重複作答），伺服器都要以題庫為準。
//   node tools/e2e/grade.mjs
import assert from 'node:assert/strict';
import { gradeSubmission } from '../../js/grade.js';
import { levelsFor, stageSizes, weigh, PER_TEST } from '../../js/levels.js';
import { promptText, answerText } from '../../js/components/question.js';
import { flattenPattern, correctText, judge, applyScore } from '../../js/components/items.js';
import { lettersOf } from '../../js/util.js';

const words = Array.from({ length: 36 }, (_, i) => ({
  word: i % 6 === 5 ? `look after${i}` : `word${String.fromCharCode(97 + (i % 26))}${i}`,
  type: i % 6 === 5 ? 'phrase' : 'word', pos: 'v.', zh: `意思${i}`,
  examples: [{ ex: `They will [wordform${i}] it tomorrow.`, zh: `例句${i}` }, { ex: `She [wordx${i}] every day.`, zh: `例句b${i}` }],
}));
const config = { units: { u1: {}, u2: { quiz: JSON.stringify({ mode: 'custom', stages: [{ name: '甲', types: ['en2zh', 'cloze'] }, { name: '乙', types: ['spell', 'clozeSpell'] }], count: 20 }) } } };

// 照 js/modes/vocab.js 的 answered() 產生明細；right(q) 決定這題答對與否
function takeVocab(unit, right) {
  const levels = levelsFor(config.units[unit]);
  const per = Math.min(words.length, (JSON.parse(config.units[unit].quiz || '{}').count) || PER_TEST);
  const sizes = stageSizes(per, levels.length);
  let k = 0;
  const stages = levels.map((lv, i) => { const ws = words.slice(k, k + sizes[i]); k += sizes[i]; return { level: lv, qs: lv.build(ws, words, {}) }; });
  const details = [];
  stages.forEach((s) => s.qs.forEach((q, qi) => {
    const ok = right(q);
    const correct = answerText(q);
    const wrongAns = q.type === 'mc' ? q.options.find((o) => o !== correct) : 'zzzz';
    const yours = ok ? (q.type === 'mc' ? correct : lettersOf(correct)) : wrongAns;
    const hints = q.type === 'spell' && ok && qi % 3 === 0 ? 1 : 0;
    const clozeQ = (q.type === 'mc' && q.dir === 'cloze') || (q.type === 'spell' && q.variant === 'cloze');
    details.push({ stage: s.level.name, n: qi + 1, kind: q.type === 'mc' ? (q.dir === 'en2zh' ? '英→中' : q.dir === 'cloze' ? '例句選字' : '中→英') : (q.variant === 'cloze' ? '例句拼寫' : '拼字'),
      q: promptText(q), correct, yours, ok, points: ok ? 1 : 0, hints, word: q.word.word, exampleEn: clozeQ ? `${q.parts.before}[${q.parts.answer}]${q.parts.after}` : '' });
  }));
  const w = weigh(stages, details);
  return { sub: { unit, mode: 'vocab', details, pct: Math.round(w.total) }, expect: w };
}

for (const unit of ['u1', 'u2']) {
  for (let t = 0; t < 30; t++) {
    const { sub, expect } = takeVocab(unit, () => Math.random() < 0.7);
    const g = gradeSubmission(sub, { words }, config);
    assert.ok(Math.abs(g.score - expect.total) < 0.01, `${unit} 誠實作答：伺服器 ${g.score}、網站 ${expect.total}`);
    assert.deepEqual(g.details.map((d) => d.ok), sub.details.map((d) => d.ok), '每題對錯一樣');
    assert.deepEqual(g.flags, [], `誠實作答不應有警告：${g.flags}`);
  }
  // 竄改：答錯的題目把 ok 改成 true、分數改成 100
  const { sub, expect } = takeVocab(unit, () => Math.random() < 0.5);
  const forged = { ...sub, pct: 100, details: sub.details.map((d) => ({ ...d, ok: true, points: 99 })) };
  const g = gradeSubmission(forged, { words }, config);
  assert.ok(Math.abs(g.score - expect.total) < 0.01, '改對錯、改分數無效');
  assert.match(g.flags[0], /以伺服器重算為準/);
  // 竄改：刪掉答錯的題目（想讓每題分數變高）
  const onlyRight = { ...sub, details: sub.details.filter((d) => d.ok) };
  const g2 = gradeSubmission(onlyRight, { words }, config);
  assert.ok(Math.abs(g2.score - expect.total) < 0.01, `刪掉答錯的題目無效：${g2.score} vs ${expect.total}`);
  assert.ok(g2.flags.some((f) => /少了/.test(f)));
  // 竄改：同一個答對的字重複送很多次
  const r = sub.details.find((d) => d.ok);
  const dupd = { ...sub, details: [...sub.details, r, r, r] };
  assert.ok(gradeSubmission(dupd, { words }, config).score <= expect.total + 0.01, '重複作答不加分');
  // 竄改：把作答改成正確答案但題目亂寫（題庫找不到）
  const fake = { ...sub, details: sub.details.map((d, i) => (i < 10 ? { ...d, word: `nope${i}`, ok: true } : d)) };
  assert.ok(gradeSubmission(fake, { words }, config).flags.some((f) => /題庫找不到/.test(f)));
}

// 課文理解
const reading = { questions: Array.from({ length: 5 }, (_, i) => ({ q: `Q${i}?`, options: ['a', 'b', 'c', 'd'], answer: i % 4, skill: '細節' })) };
const K = ['A', 'B', 'C', 'D'];
const rd = (ans) => ({ unit: 'r', mode: 'reading', pct: 100, details: reading.questions.map((q, i) => ({ n: i + 1, yours: ans[i] == null ? '' : `${K[ans[i]]}. ${q.options[ans[i]]}`, ok: true })) });
let g = gradeSubmission(rd([0, 1, 2, 0, null]), reading, {});
assert.equal(g.score, 3); assert.equal(g.total, 5); assert.equal(g.pct, 60);
g = gradeSubmission({ ...rd([0, 1, 2, 3, 0]), details: rd([0, 1, 2, 3, 0]).details.slice(0, 2) }, reading, {});
assert.equal(g.score, 2, '刪題無效'); assert.equal(g.total, 5);

// 句型練習
const items = [{ type: 'mc', q: 'He ____ here.', options: ['is', 'are', 'am', 'be'], answer: 0 }, { type: 'fill', q: 'I ____ (go) yesterday.', answer: 'went' },
  { type: 'apply', zh: '我喜歡蘋果', words: ['apples', 'I', 'like'], answer: 'I like apples.' }, { type: 'mc', q: 'She ____ tall.', options: ['is', 'are', 'am', 'be'], answer: 0 }];
const pqs = flattenPattern(items);
const cfgP = { units: { p: { questionCount: 3 } } };
const pd = (ys) => ({ unit: 'p', mode: 'pattern', pct: 100, details: ys.map(([id, y]) => ({ word: id, yours: y, ok: true, points: 1 })) });
g = gradeSubmission(pd([['i0', 'A. is'], ['i1', 'went'], ['i2', 'I like apples']]), { items }, cfgP);
const expectP = [judge(pqs[0], 'A. is') ? 1 : 0, judge(pqs[1], 'went') ? 1 : 0, applyScore(pqs[2], 'I like apples')].reduce((a, b) => a + b, 0);
assert.equal(g.score, Math.round(expectP * 100) / 100); assert.equal(g.total, 3);
g = gradeSubmission(pd([['i0', 'B. are'], ['i1', 'go'], ['i2', 'apples I like']]), { items }, cfgP);
assert.ok(g.score < 1, '答錯就是答錯'); assert.equal(correctText(pqs[0]), 'A. is');
assert.equal(gradeSubmission({ unit: 'x', mode: 'vocab', details: [] }, { questions: [] }, {}), null, '題型和題庫對不上');
console.log('伺服器計分測試通過');
