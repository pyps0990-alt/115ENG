// 出題設定測試：預設／勾題型自動分段／自訂每段，產生的段落與題型正確；網站（parseQuiz）和 Apps Script（quizCell_）整理結果一致
//   node tools/e2e/quiz-config.mjs
import assert from 'assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const L = await import(pathToFileURL(path.join(root, 'js/levels.js')));
// 從 Code.gs 取出 quizCell_（和它用的 QUIZ_TYPES）單獨執行
const gs = fs.readFileSync(path.join(root, 'apps-script/Code.gs'), 'utf8');
const src = gs.slice(gs.indexOf('var QUIZ_TYPES'), gs.indexOf('// 開放時段：存成'));
const quizCell_ = new Function(`${src}; return quizCell_;`)();

const words = [
  { word: 'shatter', pos: 'v.', zh: '粉碎', examples: [{ ex: 'The news [shattered] our hopes.', zh: '消息粉碎了希望。' }] },
  { word: 'dense', pos: 'adj.', zh: '濃密的', examples: [{ ex: 'A [dense] fog covered the town.', zh: '濃霧籠罩小鎮。' }] },
  { word: 'fiber', pos: 'n.', zh: '纖維', examples: [{ ex: 'Plant [fibers] are strong.', zh: '植物纖維很堅韌。' }] },
  { word: 'soar', pos: 'v.', zh: '高漲', examples: [{ ex: 'Prices [soared] last year.', zh: '物價去年飆漲。' }] },
  { word: 'lay out', pos: 'phr.', type: 'phrase', zh: '清楚說明', examples: [{ ex: 'She [laid out] the plan.', zh: '她清楚說明計畫。' }] },
].map((w) => ({ ...w, example: w.examples[0].ex, exampleZh: w.examples[0].zh }));
const kindOf = (q) => (q.type === 'mc' ? q.dir : q.variant === 'cloze' ? 'clozeSpell' : 'spell');
const kinds = (level) => { const s = new Set(); for (let r = 0; r < 40; r++) level.build(words, words, {}).forEach((q) => s.add(kindOf(q))); return [...s].sort(); };

// 預設：三段，老師關掉的段落不考
assert.deepEqual(L.levelsFor({}).map((l) => l.id), ['basic', 'advanced', 'mastery']);
assert.deepEqual(L.levelsFor({ disabled: ['mastery'] }).map((l) => l.id), ['basic', 'advanced']);
assert.deepEqual(L.levelsFor({ quiz: 'not json' }).map((l) => l.id), ['basic', 'advanced', 'mastery'], '格式錯誤就用預設');

// 純單字填空：只勾例句選字
let lv = L.levelsFor({ quiz: JSON.stringify({ mode: 'auto', types: ['cloze'] }) });
assert.deepEqual(lv.map((l) => [l.id, l.name]), [['advanced', '進階']]);
assert.deepEqual(kinds(lv[0]), ['cloze']);
// 自動分段：選擇＋拼寫（不勾例句）→ 兩段，各段只出勾的題型
lv = L.levelsFor({ quiz: JSON.stringify({ mode: 'auto', types: ['zh2en', 'spell', 'bogus'] }) });
assert.deepEqual(lv.map((l) => l.id), ['basic', 'mastery']);
assert.deepEqual(kinds(lv[0]), ['zh2en']);
assert.deepEqual(kinds(lv[1]), ['spell']);
// 自訂：兩段，段名與題型照設定；段落代號依序 basic、advanced（成績表的三段欄位）
lv = L.levelsFor({ quiz: JSON.stringify({ mode: 'custom', stages: [{ name: '暖身', types: ['en2zh'] }, { name: '挑戰', types: ['cloze', 'clozeSpell'] }] }) });
assert.deepEqual(lv.map((l) => [l.id, l.name]), [['basic', '暖身'], ['advanced', '挑戰']]);
assert.deepEqual(kinds(lv[0]), ['en2zh']);
assert.deepEqual(kinds(lv[1]), ['cloze', 'clozeSpell']);
assert.match(lv[1].items.join(), /提示最多 2 次/, '有拼字題才說明提示扣分');
assert.doesNotMatch(lv[0].items.join(), /提示/);
// 自訂最多 3 段，沒勾題型的段落不算，段名最多 8 個字
lv = L.levelsFor({ quiz: JSON.stringify({ mode: 'custom', stages: [{ name: '一二三四五六七八九十', types: ['cloze'] }, { name: '空', types: [] }, { types: ['spell'] }, { types: ['en2zh'] }, { types: ['zh2en'] }] }) });
assert.deepEqual(lv.map((l) => [l.id, l.name]), [['basic', '一二三四五六七八'], ['advanced', '第 2 段'], ['mastery', '第 3 段']]);

// 每次題數：任何模式都能設，1～100，預設模式也能只設題數
assert.equal(L.quizCount({ quiz: JSON.stringify({ mode: 'auto', types: ['cloze'], count: 12 }) }), 12);
assert.equal(L.quizCount({ quiz: JSON.stringify({ mode: 'default', count: 500 }) }), 100);
assert.equal(L.quizCount({ quiz: JSON.stringify({ mode: 'default' }) }), null);
assert.equal(L.quizCount({}), null);
assert.deepEqual(L.levelsFor({ quiz: JSON.stringify({ mode: 'default', count: 10 }), disabled: ['basic'] }).map((l) => l.id), ['advanced', 'mastery'], '預設模式只設題數，段落照預設');

// 網站和 Apps Script 對同一份設定的整理結果一致
const inputs = [
  { mode: 'auto', types: ['cloze'] },
  { mode: 'auto', types: ['zh2en', 'spell', 'bogus', 'spell'] },
  { mode: 'auto', types: [] },
  { mode: 'custom', stages: [{ name: ' 暖身 ', types: ['en2zh'] }, { name: '空', types: [] }, { name: '挑戰', types: ['cloze', 'x'] }] },
  { mode: 'custom', stages: [] },
  { mode: 'weird' },
  { mode: 'default', annotate: true },
  { mode: 'auto', types: ['cloze'], annotate: true },
  { annotate: 'yes' },
  { mode: 'default', count: 15 },
  { mode: 'default', count: 0 },
  { mode: 'auto', types: ['cloze'], count: '20' },
  { mode: 'custom', stages: [{ types: ['spell'] }], count: 250.7 },
  'not json',
  '',
];
for (const x of inputs) {
  const server = quizCell_(typeof x === 'string' ? x : JSON.stringify(x));
  const site = L.parseQuiz(typeof x === 'string' ? x : JSON.stringify(x));
  assert.deepEqual(server ? JSON.parse(server) : null, site, `一致：${JSON.stringify(x)}`);
}
console.log('出題設定測試通過');
