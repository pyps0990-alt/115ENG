// 錯誤分析結果接進出題：簽章與 Python 一致、不當選項被排除、課外選項加進來並能在解析裡認出
//   node tools/e2e/analysis.mjs
import assert from 'node:assert/strict';

globalThis.window = globalThis;
globalThis.document = { createElement: () => ({}) };
globalThis.localStorage = { getItem: () => null, setItem() {} };
const { analysisSig } = await import('../../js/data.js');
const { buildClozeMC, explainWrong, classifyError, errorOf } = await import('../../js/components/question.js');

// 1. 簽章：和 tools/brain/brain.py 的 signature 算出來一樣（同一份固定資料）
const fixture = [
  { word: 'adapt', examples: [{ ex: 'She [adapted] fast.' }, { ex: 'We must [adapt].' }] },
  { word: 'big', example: 'A [big] dog.' },
  { word: 'lay out', examples: [{ ex: '' }, { ex: 'They [lay out] a plan.' }] },
];
assert.equal(analysisSig(fixture), '1471021736', '網站與 Python 的簽章要一致');
assert.notEqual(analysisSig([{ ...fixture[0], examples: [{ ex: 'She [adapted] quickly.' }, fixture[0].examples[1]] }, fixture[1], fixture[2]]), '1471021736', '例句改過簽章會變');

// 2. 出題：不當選項排除、課外選項加入
const mk = (word, pos, zh, ex) => ({ word, pos, zh, type: 'word', example: ex });
const pool = [
  mk('compelling', 'adj.', '令人信服的', 'The police found [compelling] evidence.'),
  mk('objective', 'adj. / n.', '客觀的', 'A [objective] view.'),
  mk('extensive', 'adj.', '廣泛的', 'An [extensive] search.'),
  mk('validity', 'n.', '有效性', 'The [validity] of tests.'),
  mk('predict', 'v.', '預測', 'We [predict] rain.'),
  mk('plain', 'adj.', '清楚的', 'A [plain] meal.'),
];
const EXTRA_WORDS = ['ordinary', 'physical', 'typical', 'vital'];
const analysis = {
  unsafe: { compelling: [['objective', 'extensive']] },
  extra: { compelling: [EXTRA_WORDS.map((w) => ({ word: w, form: w, pos: 'adj.', zh: '某某的', level: 3 }))] },
};
const counts = [0, 0, 0, 0];
for (let i = 0; i < 600; i++) {
  const q = buildClozeMC(pool[0], pool, analysis);
  assert.equal(q.options.length, 4);
  assert.ok(!q.options.includes('objective') && !q.options.includes('extensive'), '不當選項不出現：' + q.options);
  const n = q.options.filter((o) => EXTRA_WORDS.includes(o)).length;
  assert.ok(n <= 3, '每題最多 3 個課外選項：' + q.options);
  assert.equal(q.extras.length, n);
  counts[n]++;
}
// 不定時混入：大約一半的題目有課外選項，有的時候是 1、2、3 個
assert.ok(counts[0] > 200 && counts[0] < 400, '約一半沒有課外選項：' + counts);
assert.ok(counts[1] > 0 && counts[2] > 0 && counts[3] > 0, '1、2、3 個都會出現：' + counts);
// 沒有分析結果：和原本一樣（只有單元裡的字）
const plainQ = buildClozeMC(pool[0], pool);
assert.ok(plainQ.options.every((o) => pool.some((w) => w.example.includes(`[${o}]`))));
assert.deepEqual(plainQ.extras, []);
// 同單元字不夠時，不當選項勉強補上（不能少於 4 個選項）
const tiny = pool.slice(0, 4);
const q4 = buildClozeMC(tiny[0], tiny, { unsafe: { compelling: [['objective', 'extensive', 'validity']] }, extra: {} });
assert.equal(q4.options.length, 4);

// 3. 答錯解析：課外選項認得出意思與詞性
const q = buildClozeMC(pool[0], pool, { unsafe: {}, extra: { compelling: [[{ word: 'bank', form: 'bank', pos: 'n.', zh: '銀行', level: 3 }]] } });
q.options = ['compelling', 'bank', 'plain', 'predict']; q.answer = 0; q.extras = [{ form: 'bank', word: 'bank', zh: '銀行', pos: 'n.' }];
assert.equal(classifyError(q, 'bank', pool), '詞性不合');
const x = explainWrong(q, 'bank', pool);
assert.match(x.html, /銀行/);
// 逐題檢討（存在紀錄裡的 extras）
const r = errorOf({ kind: '例句選字', word: 'compelling', yours: 'bank', err: '意思混淆', extras: q.extras }, pool);
assert.equal(r.err, '詞性不合');
console.log('錯誤分析接進出題測試通過');
