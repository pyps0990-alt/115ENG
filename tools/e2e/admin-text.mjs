// 老師後台「句型練習／段考複習」文字格式：解析、序列化、往返一致，以及錯誤提示
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const html = fs.readFileSync(new URL('../../apps-script/Admin.html', import.meta.url), 'utf8');
const grab = (a, b) => { const i = html.indexOf(a), j = html.indexOf(b, i); assert(i > 0 && j > i, a); return html.slice(i, j); };
const code = [
  grab('function esc(s)', '\n    function $(id)'),
  grab('function countOf(type, d)', '\n    var TABS'),
  grab('function normQ(s)', '\n    function refreshRefs').replace(/function refreshRefs[^]*/, ''),
  grab('function words_(s)', '\n    function parseReading'),
  grab('var HELP = {', "    $('ai-text').onclick"),
  grab('function reEsc(x)', '    function words_'),
  grab('function csvToTsv(text)', '    function readTextFile'),
  grab('function serVocab(d)', '    function fillForm'),
].join('\n').replace(/function \$\(id\) \{[^\n]*\n/, '').replace(/\$\('t-example'\)\.onclick = function[\s\S]*?\n    };\n/, '').replace(/function textShow[\s\S]*?\n    }\n    /, '');
const els = { 't-topic': { value: '主題' }, 't-text': { value: '' }, 'imp-report': { innerHTML: '' } };
const ctx = { $: (id) => els[id] || (els[id] = { value: '' }), console, impUnit: () => ({ title: 'U' }) };
vm.createContext(ctx);
vm.runInContext(code + '\nthis.api = { parseVocab, parseTextType, serPattern, serExam, EXAMPLE, validatePE, csvToTsv, serVocab, serReading, splitBlocks };', ctx);
const { parseVocab, parseTextType, serPattern, serExam, EXAMPLE, csvToTsv, serVocab, serReading, splitBlocks } = ctx.api;
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
assert.deepEqual(e.blocks.map((x) => x.type), ['mc', 'spell', 'phrase', 'cloze', 'bank', 'struct', 'reading']);
const rd = e.blocks[6];
assert.equal(rd.passage.length, 2);
assert.equal(rd.questions.length, 2);
assert.equal(e.blocks[3].blanks.length, 2);
assert.equal(e.blocks[4].bank.length, 6);
assert.deepEqual(e.blocks[4].blanks.map((b) => b.answer), [0, 1, 2]);
assert.deepEqual(e.blocks[5].blanks.map((b) => b.answer), [0, 2]);
els['t-text'].value = '[選填]\n文章：x (1)\n字庫：a | b\n(1)答案：C';
assert.equal(parseTextType('exam'), null, '答案超出字庫要擋');

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
// CSV：引號、逗號、欄位內換行
assert.equal(csvToTsv('apple,n.,蘋果,"I like [apples], a lot.",我喜歡\n"b,c",v.,"兩\n行",x [y],z\n'), 'apple\tn.\t蘋果\tI like [apples], a lot.\t我喜歡\nb,c\tv.\t兩 行\tx [y]\tz');
assert.equal(serVocab({ words: [{ word: 'a', pos: 'n.', zh: '甲', example: 'x [a]', exampleZh: '乙' }] }), 'a\tn.\t甲\tx [a]\t乙');
// 課文理解：匯出文字可以再讀回來
const rdata = { title: 'T', passage: ['One two.', 'Three four.'], questions: [{ skill: '細節', q: 'Q?', options: ['a', 'b', 'c', 'd'], answer: 2, explain: 'e', key: 'Three four' }, { skill: '主旨', q: 'R?', options: ['a', 'b'], answer: 0, ref: '1-1' }] };
const txt = serReading(rdata);
const f = splitBlocks('[閱讀]\n' + txt)[0].f;
assert.equal(f['Q1依據'], 'Three four');
assert.equal(f['Q2依據句'], '1-1');
assert.equal(f['Q1答案'], 'C');
// 單字片語：每個字 3 句例句＋3 句翻譯
const ph = html.match(/id="v-text"[^>]*placeholder="([^"]*)"/)[1].replace(/&#9;/g, '\t').replace(/&#10;/g, '\n');
els['v-text'] = { value: ph + '\nadapt | v. | 適應 | She [adapted] fast. ; We must [adapt]. ; Animals [adapt]. | 她很快適應。 ; 我們必須適應。 ; 動物適應。\nbig | adj. | 大的 | A [big] dog. ; A [big] city. ; A [big] idea. | 大狗。 ; 大城市。 ; 大想法。' };
els['v-topic'] = { value: '' };
const vd = plain(parseVocab());
assert(vd && vd.words.length === 4, '範例（兩行）加兩行共 4 個字：' + els['imp-report'].innerHTML);
assert.equal(vd.words[0].examples.length, 3);
assert.equal(vd.words[1].type, 'phrase');
assert.equal(vd.words[1].examples[2].zh, '市場很快反彈。');
assert.match(els['imp-report'].innerHTML, /建議每個單元：?單字|建議每個單元 20/);
console.log('後台文字格式解析測試通過');
