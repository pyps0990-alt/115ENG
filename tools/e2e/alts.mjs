// 答案寫法：| 列出所有可接受的寫法、( ) 標出可有可無的字；網站（items.js）與伺服器（Code.gs）要一致
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { expandAlts, fillOk, applyScore } from '../../js/components/items.js';

const gs = fs.readFileSync(new URL('../../apps-script/Code.gs', import.meta.url), 'utf8');
const pick = (name) => { const i = gs.indexOf(`function ${name}(`); let d = 0, j = gs.indexOf('{', i); for (let k = j; k < gs.length; k++) { if (gs[k] === '{') d++; if (gs[k] === '}' && --d === 0) return gs.slice(i, k + 1); } };
const ctx = {}; vm.createContext(ctx);
vm.runInContext(['normAns_', 'expandAlts_', 'fillOk_'].map(pick).join('\n'), ctx);

const cases = [
  ['look forward to|looks forward to', ['look forward to', 'looks forward to']],
  ['look forward to (the)', ['look forward to the', 'look forward to']],
  ['(has been) looking forward to', ['has been looking forward to', 'looking forward to']],
  ['a (big) (red) apple', ['a big red apple', 'a red apple', 'a big apple', 'a apple']],
  ['calm', ['calm']],
  ['', []],
];
for (const [src, want] of cases) {
  assert.deepEqual([...expandAlts(src)].sort(), [...want].sort(), src);
  assert.deepEqual([...ctx.expandAlts_(src)].sort(), [...want].sort(), 'server ' + src);
}
for (const [ans, typed, ok] of [
  ['look forward to (the)|looking forward to', 'Looking forward to', true],
  ['look forward to (the)|looking forward to', 'look forward to the', true],
  ['look forward to (the)|looking forward to', 'look forward', false],
  ['(has been) looking forward to', 'HAS BEEN looking forward to!', true],
  ["it's", 'it’s', true],
]) {
  assert.equal(fillOk({ answer: ans }, typed), ok, `client ${ans} / ${typed}`);
  assert.equal(ctx.fillOk_(ans, typed), ok, `server ${ans} / ${typed}`);
}
console.log('答案寫法測試通過');

// 應用題部分給分：順序一致的單字越多分數越高，全對才是 1
const q = { answer: 'I have lived here for ten years' };
assert.equal(applyScore(q, 'I have lived here for ten years'), 1, '全對 1 分');
assert.equal(applyScore(q, 'i have lived here for ten years.'), 1, '大小寫與標點不影響');
assert.equal(applyScore(q, 'I have lived here for years ten'), 0.86, '兩個字對調：7 個字對 6 個');
assert.equal(applyScore(q, 'I have lived here'), 0.57, '只排了前 4 個字：4/7');
assert.equal(applyScore(q, 'ten years for here lived have I'), 0.29, '整句倒過來：只有 ten years 兩個字的順序仍然對，2/7');
assert.equal(applyScore(q, ''), 0, '沒排任何字 0 分');
const q2 = { answer: 'I like him very much | I like him a lot' };
assert.equal(applyScore(q2, 'I like him a lot'), 1, '另一種可接受寫法也是滿分');
assert.equal(applyScore(q2, 'I like him lot a'), 0.8, '跟最接近的那一種寫法比：5 個字對 4 個');
assert(applyScore({ answer: 'a b c d e f g h i j k l m n o p q r s t' }, 'a b c d e f g h i j k l m n o p q r s u') < 1, '差一個字也不能給滿分');
console.log('應用題部分給分測試通過');
