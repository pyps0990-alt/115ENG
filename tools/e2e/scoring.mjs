// 單字測驗計分：滿分 100、各段平均分配、拼字提示扣分（第 1 次 1 分、第 2 次再 3 分）；進階全部例句選字；例句記憶
//   node tools/e2e/scoring.mjs
import assert from 'node:assert/strict';

const mem = new Map();
globalThis.window = globalThis;
globalThis.document = { createElement: () => ({}) };
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k), key: () => null, length: 0 };
const { weigh, hintDeduction, LEVELS } = await import('../../js/levels.js');
const { buildClozeMC, buildSpell } = await import('../../js/components/question.js');

const stage = (name, n) => ({ level: { name }, qs: Array.from({ length: n }) });
const det = (name, n, opt = {}) => Array.from({ length: n }, (_, i) => ({ stage: name, ok: opt.wrong ? i < n - opt.wrong : true, hints: opt.hintsAt && i === 0 ? opt.hintsAt : 0 }));
const near = (a, b) => Math.abs(a - b) < 1e-6;

// 1. 全對 100 分；三段各 33.3
let stages = [stage('基礎', 10), stage('進階', 10), stage('精熟', 10)];
let d = [...det('基礎', 10), ...det('進階', 10), ...det('精熟', 10)];
let w = weigh(stages, d);
assert.ok(near(w.total, 100));
assert.ok(near(w.max, 100 / 3));
assert.ok(d.every((x) => near(x.points, Math.round((100 / 30) * 1000) / 1000)), '每題 3.333 分');

// 2. 提示扣分：第 1 次扣 1、第 2 次再扣 3
assert.equal(hintDeduction(0), 0); assert.equal(hintDeduction(1), 1); assert.equal(hintDeduction(2), 4);
d = [...det('基礎', 10), ...det('進階', 10), ...det('精熟', 10, { hintsAt: 1 })];
assert.equal(Math.round(weigh(stages, d).total), 99);
d = [...det('基礎', 10), ...det('進階', 10), ...det('精熟', 10, { hintsAt: 2 })];
w = weigh(stages, d);
assert.ok(near(w.total, 100 - 100 / 30), '一題 3.33 分扣 4 分 → 這題 0 分，不會變負的：' + w.total);
assert.equal(d.find((x) => x.hints === 2).points, 0);

// 3. 各段題數不同：段內每題同分，各段滿分仍是 33.3
stages = [stage('基礎', 10), stage('進階', 10), stage('精熟', 11)];
d = [...det('基礎', 10, { wrong: 10 }), ...det('進階', 10), ...det('精熟', 11)];
w = weigh(stages, d);
assert.ok(near(w.stages[0], 0)); assert.ok(near(w.stages[2], 100 / 3));
assert.equal(Math.round(w.total), 67, '基礎全錯：67 分');
// 老師只開兩段：各 50 分
stages = [stage('基礎', 5), stage('精熟', 5)];
d = [...det('基礎', 5), ...det('精熟', 5, { wrong: 5 })];
assert.equal(Math.round(weigh(stages, d).total), 50);
// 明細分數加起來等於總分（伺服器會核對）
stages = [stage('基礎', 7), stage('進階', 9), stage('精熟', 8)];
d = [...det('基礎', 7, { wrong: 2 }), ...det('進階', 9, { wrong: 1 }), ...det('精熟', 8, { hintsAt: 1 })];
w = weigh(stages, d);
assert.ok(Math.abs(d.reduce((a, x) => a + x.points, 0) - Math.round(w.total * 100) / 100) < 0.06);

// 4. 進階全部例句選字
const adv = LEVELS.find((l) => l.id === 'advanced');
const words = ['adapt', 'big', 'cat', 'dog', 'eat'].map((x) => ({ word: x, zh: x, pos: 'n.', examples: [{ ex: `A [${x}] one.` }, { ex: `Two [${x}] here.` }, { ex: `The [${x}] there.` }] }));
for (let i = 0; i < 20; i++) assert.ok(adv.build(words, words).every((q) => q.dir === 'cloze'), '進階全部是例句選字');

// 5. 例句記憶：pickEx 決定考哪一句，三句都考過才重來，而且不連續考同一句
const used = [];
const pickEx = (w, n) => { const seen = used.filter((u) => u.w === w).map((u) => u.i); let free = [...Array(n).keys()].filter((i) => !seen.includes(i)); if (!free.length) free = [...Array(n).keys()].filter((i) => i !== seen.at(-1)); const i = free[0]; used.push({ w, i }); return i; };
const seq = Array.from({ length: 4 }, () => buildClozeMC(words[0], words, null, pickEx).parts.before);
assert.deepEqual(seq.slice(0, 3), ['A ', 'Two ', 'The '], '三句輪流');
const sp = buildSpell(words[1], 'cloze', () => 2);
assert.equal(sp.parts.before, 'The ', '拼字題也照記憶挑句子');
console.log('單字測驗計分與例句記憶測試通過');
