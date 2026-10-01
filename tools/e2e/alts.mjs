// 答案寫法：| 列出所有可接受的寫法、( ) 標出可有可無的字；網站（items.js）與伺服器（Code.gs）要一致
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { expandAlts, fillOk } from '../../js/components/items.js';

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
