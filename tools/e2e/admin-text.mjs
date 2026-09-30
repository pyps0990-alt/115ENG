// 老師後台「句型練習／段考複習」文字格式：解析、序列化、往返一致，以及錯誤提示
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const html = fs.readFileSync(new URL('../../apps-script/Admin.html', import.meta.url), 'utf8');
const grab = (a, b) => { const i = html.indexOf(a), j = html.indexOf(b, i); assert(i > 0 && j > i, a); return html.slice(i, j); };
const code = [
  grab('function esc(s)', '\n    function $(id)'),
  grab('function countOf(type, d)', '\n    var TABS'),
  grab('function words_(s)', '\n    function parseReading'),
  grab('var HELP = {', "    $('ai-text').onclick"),
].join('\n').replace(/function \$\(id\) \{[^\n]*\n/, '').replace(/\$\('t-example'\)\.onclick = function[\s\S]*?\n    };\n/, '').replace(/function textShow[\s\S]*?\n    }\n    /, '');
const els = { 't-topic': { value: '主題' }, 't-text': { value: '' }, 'imp-report': { innerHTML: '' } };
const ctx = { $: (id) => els[id] || (els[id] = { value: '' }), console };
vm.createContext(ctx);
vm.runInContext(code + '\nthis.api = { parseTextType, serPattern, serExam, EXAMPLE, validatePE };', ctx);
const { parseTextType, serPattern, serExam, EXAMPLE } = ctx.api;
const plain = (o) => JSON.parse(JSON.stringify(o));

for (const type of ['pattern', 'exam']) {
  els['t-text'].value = EXAMPLE[type];
  const d = plain(parseTextType(type));
  assert(d, type + ' 範例應該通過\n' + els['imp-report'].innerHTML);
  const text = type === 'pattern' ? serPattern(d) : serExam(d);
  els['t-text'].value = text;
  const d2 = plain(parseTextType(type));
  assert.deepEqual(d2, d, type + ' 往返不一致');
  // JSON 也能貼
  els['t-text'].value = JSON.stringify(d);
  assert.deepEqual(plain(parseTextType(type)), d, type + ' JSON 匯入不一致');
}
els['t-text'].value = EXAMPLE.pattern;
const p = plain(parseTextType('pattern'));
assert.deepEqual(p.items.map((x) => x.type), ['mc', 'fill', 'apply']);
assert.equal(p.items[0].answer, 1);
assert.equal(p.items[2].words.length, 7);
els['t-text'].value = EXAMPLE.exam;
const e = plain(parseTextType('exam'));
assert.deepEqual(e.blocks.map((x) => x.type), ['mc', 'spell', 'reading', 'cloze']);
assert.equal(e.blocks[2].passage.length, 2);
assert.equal(e.blocks[2].questions.length, 2);
assert.equal(e.blocks[3].blanks.length, 2);

// 錯誤：應用題單字對不上答案、綜合題文章缺空格、選擇題沒答案
els['t-text'].value = '[應用]\n中文：好\n單字：a | b | c\n答案：a b d';
assert.equal(parseTextType('pattern'), null);
assert.match(els['imp-report'].innerHTML, /剛好能排成/);
els['t-text'].value = '[綜合]\n文章：No blanks here.\n(1)選項：a | b\n(1)答案：A';
assert.equal(parseTextType('exam'), null);
assert.match(els['imp-report'].innerHTML, /找不到空格/);
els['t-text'].value = '[選擇]\n題目：x ____\n選項：a | b\n答案：Z';
assert.equal(parseTextType('pattern'), null);
els['t-text'].value = '[拼寫]\n題目：x ____\n答案：y';
assert.equal(parseTextType('pattern'), null, '句型練習不接受拼寫');
console.log('後台文字格式解析測試通過');
