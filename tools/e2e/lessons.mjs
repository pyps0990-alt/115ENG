// 課次：數字顯示成 L1、L2…；英文（例如 R-X）照原樣顯示、排在數字後面；不能用中文；後台與學生端的處理要一致
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.window = globalThis;
const { lessonLabel, lessonCmp, normLesson } = await import('../../js/types.js');
const { addCustomUnits } = await import('../../js/data.js');

assert.equal(lessonLabel(1), 'L1');
assert.equal(lessonLabel(12), 'L12');
assert.equal(lessonLabel('R-X'), 'R-X');
assert.deepEqual([3, 'R-X', 1, 'A-Z', 2, 10].sort(lessonCmp), [1, 2, 3, 10, 'A-Z', 'R-X'], '數字由小到大、英文排後面');
// R-1、R-2 這類課次：照輸入的內容原樣保留（大小寫不改），英文課次依自然順序排（R-2 在 R-10 前面）
assert.deepEqual(['R-10', 'R-2', 'R-1', 'r-3'].map(normLesson), ['R-10', 'R-2', 'R-1', 'r-3']);
assert.deepEqual(['R-10', 'R-2', 'R-1', 'R-X', 2].map(normLesson).sort(lessonCmp).map(lessonLabel), ['L2', 'R-1', 'R-2', 'R-10', 'R-X']);

// 學生端：數字、英文照留，中文與符號清掉，什麼都不剩當第 1 課
const cases = [[5, 5], ['5', 5], ['  7 ', 7], ['R-X', 'R-X'], ['r x', 'r x'], ['期中', 1], ['R-X期中', 'R-X'], ['', 1], [null, 1], [undefined, 1], [150, 99], ['！！', 1], ['Mid_1', 'Mid_1']];
cases.forEach(([input, want]) => assert.deepEqual(normLesson(input), want, `normLesson(${JSON.stringify(input)})`));

const index = { units: [] };
addCustomUnits(index, { customUnits: [
  { id: 'mid', title: 'Extra', type: 'pattern', lesson: 'R-X' },
  { id: 'a', title: 'A', type: 'vocab', lesson: 3 },
  { id: 'b', title: 'B', type: 'vocab', lesson: '' },
  { id: 'c', title: 'C', type: 'vocab' },
  { id: 'd', title: 'D', type: 'vocab', lesson: '期末' },
] });
assert.deepEqual(Object.fromEntries(index.units.map((u) => [u.id, u.lesson])), { mid: 'R-X', a: 3, b: 1, c: 1, d: 1 });

// Apps Script 的 lessonCell_（直接從 Code.gs 取出來跑），結果要跟學生端一致
const gs = fs.readFileSync(new URL('../../apps-script/Code.gs', import.meta.url), 'utf8');
const i = gs.indexOf('function lessonCell_(');
let d = 0; const j = gs.indexOf('{', i); let end = 0;
for (let k = j; k < gs.length; k++) { if (gs[k] === '{') d++; if (gs[k] === '}' && --d === 0) { end = k + 1; break; } }
const ctx = {}; vm.createContext(ctx); vm.runInContext(gs.slice(i, end), ctx);
cases.forEach(([input, want]) => assert.deepEqual(ctx.lessonCell_(input), want, `lessonCell_(${JSON.stringify(input)})`));

// 後台輸入框的 lessonNum（從 Admin.html 取出來跑）也要一致
const html = fs.readFileSync(new URL('../../apps-script/Admin.html', import.meta.url), 'utf8');
const a = html.indexOf('function lessonNum(');
let dd = 0; const b = html.indexOf('{', a); let e2 = 0;
for (let k = b; k < html.length; k++) { if (html[k] === '{') dd++; if (html[k] === '}' && --dd === 0) { e2 = k + 1; break; } }
const ctx2 = {}; vm.createContext(ctx2); vm.runInContext(html.slice(a, e2), ctx2);
cases.forEach(([input, want]) => assert.deepEqual(ctx2.lessonNum(input), want, `lessonNum(${JSON.stringify(input)})`));
console.log('課次（數字、英文、不能用中文）測試通過');
