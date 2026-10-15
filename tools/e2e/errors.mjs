// 答錯原因分析：看學生選到／拼成的字和正確的字是什麼關係，不是一律「意思混淆」
//   node tools/e2e/errors.mjs
import assert from 'node:assert/strict';

globalThis.window = globalThis;
globalThis.document = { createElement: () => ({}) };
const { classifyError, errorOf, explainWrong } = await import('../../js/components/question.js');

const pool = [
  { word: 'compelling', pos: 'adj.', zh: '扣人心弦的；令人信服的', example: 'The police found [compelling] evidence.' },
  { word: 'validity', pos: 'n.', zh: '有效性；正確性', example: 'They questioned the [validity] of the test.' },
  { word: 'compiling', pos: 'v.', zh: '編纂', example: 'She is [compiling] a list.' },
  { word: 'adapt', pos: 'v.', zh: '適應', example: 'Animals [adapt] fast.' },
  { word: 'adopt', pos: 'v.', zh: '採用；收養', example: 'They [adopt] a plan.' },
  { word: 'big', pos: 'adj.', zh: '大的', example: 'A [big] dog.' },
  { word: 'large', pos: 'adj.', zh: '大的；寬廣的', example: 'A [large] room.' },
  { word: 'convincing', pos: 'adj.', zh: '有說服力的', example: 'A [convincing] argument.' },
  { word: 'take off', type: 'phrase', pos: 'phr.', zh: '起飛', example: 'The plane will [take off].' },
];
const w = (x) => pool.find((p) => p.word === x);
const mc = (dir, word, chosen) => classifyError({ type: 'mc', dir, word: w(word) }, chosen, pool);
const spell = (word, typed) => classifyError({ type: 'spell', word: w(word), answer: word }, typed, pool);

// 截圖那題：compelling（形容詞）選成 validity（名詞）——完全不同的字，不是「意思混淆」
assert.equal(mc('cloze', 'compelling', 'validity'), '詞性不合');
assert.equal(mc('cloze', 'compelling', 'compiling'), '形近混淆');
assert.equal(mc('cloze', 'compelling', 'convincing'), '句意不合', '同詞性、意思對不上');
assert.equal(mc('cloze', 'compelling', 'take off'), '詞性不合', '片語和形容詞');
assert.equal(mc('zh2en', 'adapt', 'adopt'), '形近混淆');
assert.equal(mc('zh2en', 'big', 'large'), '意思相近');
assert.equal(mc('en2zh', 'adapt', '有效性；正確性'), '不熟悉', '英→中選到不相關的意思');
assert.equal(mc('cloze', 'compelling', ''), '未作答');
assert.equal(spell('adapt', 'adopt'), '形近混淆');
assert.equal(spell('large', 'big'), '意思相近');
assert.equal(spell('adapt', 'adabt'), '拼字錯誤');
assert.equal(spell('adapt', 'adapted'), '詞形錯誤');

// 逐題檢討：舊紀錄的選擇題都記成「意思混淆」，重新判斷並寫出兩個字的差別
let r = errorOf({ kind: '例句選字', word: 'compelling', yours: 'validity', err: '意思混淆' }, pool);
assert.equal(r.err, '詞性不合');
assert.match(r.tip, /空格需要形容詞，你選的 validity 是名詞/);
r = errorOf({ kind: '中→英', word: 'adapt', yours: 'adopt', err: '意思混淆' }, pool);
assert.equal(r.err, '形近混淆');
assert.match(r.tip, /adopt（採用；收養）；adapt（適應）/);
r = errorOf({ kind: '例句選字', word: 'compelling', yours: 'convincing', err: '意思混淆' }, pool);
assert.match(r.tip, /放在這裡不合適/);
assert.doesNotMatch(r.tip, /意思不通/, '近義字不說「意思不通」');
r = errorOf({ kind: '拼字', word: 'adapt', yours: 'adabt', err: '拼字錯誤' }, pool);
assert.equal(r.err, '拼字錯誤');
r = errorOf({ kind: '例句選字', word: '不在清單的字', yours: 'x', err: '意思混淆' }, pool);
assert.equal(r.err, '意思混淆', '找不到字就沿用原本的紀錄');

// 作答當下（精簡）：錯誤類型＋每個選項的詞性與意思，不寫解題步驟；檢討（完整）才有說明與答案卡
const cq = { type: 'mc', dir: 'cloze', word: w('compelling'), options: ['validity', 'compelling'], answer: 1, parts: { before: 'The police found ', answer: 'compelling', after: ' evidence.' } };
const x = explainWrong(cq, 'validity', pool);
assert.equal(x.err, '詞性不合');
assert.match(x.html, /op-you/, '標出學生選的');
assert.match(x.html, /validity[\s\S]*名詞/, '選項附詞性');
assert.doesNotMatch(x.html, /xp-answer|wt-step|xp-yours/, '作答中不顯示解題步驟與答案卡');
const xf = explainWrong(cq, 'validity', pool, 'full');
assert.equal(xf.err, '詞性不合');
assert.match(xf.html, /空格需要形容詞/);
assert.ok(xf.html.indexOf('xp-answer') > xf.html.indexOf('op-list'), '答案卡在最後');
// 沒有選項清單的舊題目也能顯示
assert.match(explainWrong({ ...cq, options: undefined }, 'validity', pool).html, /compelling/);
console.log('答錯原因分析測試通過');
