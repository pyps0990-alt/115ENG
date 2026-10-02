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
  grab('var PROMPT_COMMON', '    function copyAiPrompt'),
  grab('function csvToTsv(text)', '    function readTextFile'),
  grab('function serVocab(d)', '    function fillForm'),
].join('\n').replace(/function \$\(id\) \{[^\n]*\n/, '').replace(/\$\('t-example'\)\.onclick = function[\s\S]*?\n    };\n/, '').replace(/function textShow[\s\S]*?\n    }\n    /, '');
const els = { 't-topic': { value: '主題' }, 't-text': { value: '' }, 'imp-report': { innerHTML: '' } };
const ctx = { $: (id) => els[id] || (els[id] = { value: '' }), console, impUnit: () => ({ title: 'U' }) };
vm.createContext(ctx);
vm.runInContext(code + '\nthis.api = { parseVocab, parseTextType, serPattern, serExam, EXAMPLE, validatePE, csvToTsv, serVocab, serReading, splitBlocks, aiPromptFor, VOCAB_EX, READING_EX };', ctx);
const { parseVocab, parseTextType, serPattern, serExam, EXAMPLE, csvToTsv, serVocab, serReading, splitBlocks, aiPromptFor, VOCAB_EX, READING_EX } = ctx.api;
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
assert.deepEqual(e.blocks.map((x) => x.type), ['mc', 'spell', 'phrase', 'cloze', 'bank', 'struct', 'translate', 'essay', 'reading']);
const rd = e.blocks[8];
assert.equal(e.blocks[6].answer.split('|').length, 2);
assert.equal(e.blocks[7].minWords, 120);
assert(e.blocks[7].sample.includes('Last year'));
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
// AI 回覆常見的裝飾：程式碼框、粗體、項目符號、編號、全形符號、標題別名、欄位別名、一行 A. B. C. D.
const messy = [
  '好的，以下是 3 題句型練習：',
  '```',
  '1. 【選擇題】',
  '- **句型**：not only…but also',
  '- **題幹**：Not only ____ the exam, but he also won.',
  '- **選項**：A. passed B. did he pass C. he passed D. has passed',
  '- **正確答案**：B（did he pass）',
  '- **詳解**：Not only 放句首要倒裝。',
  '---',
  '### [填空題]',
  '題目: It was so ____ that we cried.',
  '答案: touching｜moving',
  '提示：（感人的）',
  '解析：so…that。',
  '',
  '**[應用]**',
  '中文：她很快適應了。',
  '單字：adapted ｜ She ｜ quickly',
  '答案：She adapted quickly.',
  '```',
  '希望對你有幫助！',
].join('\n');
els['t-text'].value = messy;
const md = plain(parseTextType('pattern'));
assert(md, 'AI 裝飾過的回覆也要能解析：' + els['imp-report'].innerHTML);
assert.deepEqual(md.items.map((x) => x.type), ['mc', 'fill', 'apply']);
assert.equal(md.items[0].answer, 1);
assert.equal(md.items[0].options.length, 4);
assert.equal(md.items[1].answer, 'touching|moving');
assert.equal(md.items[2].words.length, 3);
// 段考：克漏字／文意選填別名，Q1. 寫法，（1）全形，JSON 包在程式碼框
els['t-text'].value = '```text\n[克漏字]\n標題：A Big Change\n文章：Tom felt (1) at first. (2), he made friends.\n（1）選項：A. lonely B. noisy C. hungry D. proud\n（1）答案：A\n（1）解析：孤單。\n（2）選項：However | Therefore | Besides | Otherwise\n（2）答案：(A) However\n（2）解析：轉折。\n```';
const ex = plain(parseTextType('exam'));
assert(ex, '克漏字別名：' + els['imp-report'].innerHTML);
assert.equal(ex.blocks[0].type, 'cloze');
assert.equal(ex.blocks[0].blanks.length, 2);
assert.equal(ex.blocks[0].blanks[1].answer, 0);
els['t-text'].value = '```json\n' + JSON.stringify({ blocks: [{ type: 'mc', q: 'x ____', options: ['a', 'b'], answer: 1, explain: 'e' }] }) + '\n```';
assert(parseTextType('exam'), 'JSON 包在程式碼框也要能讀');
// 單字片語：Markdown 表格
els['v-text'] = { value: '| 英文 | 詞性 | 中文 | 例句 | 翻譯 |\n|---|---|---|---|---|\n| adapt | v. | 適應 | She [adapted] fast. ; We [adapt]. ; Animals [adapt]. | 她適應。 ; 我們適應。 ; 動物適應。 |\n| big | adj. | 大的 | A [big] dog. ; A [big] city. ; A [big] idea. | 大狗。 ; 大城市。 ; 大想法。 |\n| hot | adj. | 熱的 | A [hot] day. | 熱天。 |\n| cold | adj. | 冷的 | A [cold] day. | 冷天。 |' };
const vt = plain(parseVocab());
assert(vt && vt.words.length === 4, 'Markdown 表格也要能讀：' + els['imp-report'].innerHTML);
// 「給 AI 的完整提示詞」：四種題型都有，格式規則齊全，裡面的範例本身要能通過解析
for (const t of ['vocab', 'reading', 'pattern', 'exam']) {
  const pr = aiPromptFor(t);
  assert(pr.length > 500 && /請在這裡填/.test(pr), t + ' 提示詞要完整');
  if (t === 'pattern' || t === 'exam') {
    assert(/輸出規則/.test(pr) && /____/.test(pr) && pr.includes(EXAMPLE[t].slice(0, 40)), t + ' 提示詞要含規則與範例');
  }
}
assert(/依據.*必填/.test(aiPromptFor('exam')) && /依據.*必填/.test(aiPromptFor('reading')));
// 灰色區塊裡顯示的範例本身要能通過
const rf = splitBlocks('[閱讀]\n' + READING_EX)[0].f;
assert.equal(rf['Q2依據'], 'She felt ashamed');
assert.equal(rf['Q1答案'], 'B');
els['v-text'] = { value: VOCAB_EX + '\nbig | adj. | 大的 | A [big] dog. ; A [big] city. ; A [big] idea. | 大狗。 ; 大城市。 ; 大想法。\nhot | adj. | 熱的 | A [hot] day. ; A [hot] cup. ; A [hot] sun. | 熱天。 ; 熱杯。 ; 熱日。' };
els['v-topic'] = { value: '' };
assert(parseVocab(), '單字範例要能通過：' + els['imp-report'].innerHTML);
console.log('後台文字格式解析測試通過');
