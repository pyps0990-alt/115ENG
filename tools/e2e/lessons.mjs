// 課次：1、2、3… 顯示成 L1、L2…；課次 0 是 R-X（放段考），顯示成 R-X、排在最後面；後台與學生端都不能把 0 變成第 1 課
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.window = globalThis;
const { lessonLabel, lessonOrder } = await import('../../js/types.js');
const { addCustomUnits } = await import('../../js/data.js');

assert.equal(lessonLabel(1), 'L1');
assert.equal(lessonLabel(12), 'L12');
assert.equal(lessonLabel(0), 'R-X');
assert.equal(lessonLabel('0'), 'R-X');
assert.deepEqual([3, 0, 1, 2].sort((a, b) => lessonOrder(a) - lessonOrder(b)), [1, 2, 3, 0], 'R-X 排最後');

// 學生端讀進來的單元：lesson 0 保留，空白或亂填當第 1 課
const index = { units: [] };
addCustomUnits(index, { customUnits: [
  { id: 'mid', title: 'Midterm', type: 'exam', lesson: 0 },
  { id: 'a', title: 'A', type: 'vocab', lesson: 3 },
  { id: 'b', title: 'B', type: 'vocab', lesson: '' },
  { id: 'c', title: 'C', type: 'vocab' },
  { id: 'd', title: 'D', type: 'vocab', lesson: 'x' },
] });
const by = Object.fromEntries(index.units.map((u) => [u.id, u.lesson]));
assert.deepEqual(by, { mid: 0, a: 3, b: 1, c: 1, d: 1 });

// Apps Script 的 lessonCell_（直接從 Code.gs 取出來跑）
const gs = fs.readFileSync(new URL('../../apps-script/Code.gs', import.meta.url), 'utf8');
const i = gs.indexOf('function lessonCell_(');
let d = 0; let j = gs.indexOf('{', i); let end = 0;
for (let k = j; k < gs.length; k++) { if (gs[k] === '{') d++; if (gs[k] === '}' && --d === 0) { end = k + 1; break; } }
const ctx = {}; vm.createContext(ctx); vm.runInContext(gs.slice(i, end), ctx);
assert.equal(ctx.lessonCell_(0), 0, '0 = R-X 要保留');
assert.equal(ctx.lessonCell_('0'), 0);
assert.equal(ctx.lessonCell_(5), 5);
assert.equal(ctx.lessonCell_(''), 1, '空白當第 1 課');
assert.equal(ctx.lessonCell_(null), 1);
assert.equal(ctx.lessonCell_('abc'), 1);
assert.equal(ctx.lessonCell_(250), 99, '上限 99');
assert.equal(ctx.lessonCell_(-3), 1, '負數當第 1 課，不會變成 R-X');
console.log('課次與 R-X 測試通過');
