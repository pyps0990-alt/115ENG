// 課文理解錯誤分析的文章定位：答案依據（關鍵字句、依據句）、題目關鍵字找得到正確的字；文章拆字後依據整句包在一個 .ev 裡
//   node tools/e2e/reading-analysis.mjs
import assert from 'assert/strict';
import { pathToFileURL, fileURLToPath } from 'url';
import path from 'path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const A = await import(pathToFileURL(path.join(root, 'js/components/annotate.js')));
const paras = [
  'Friendship is one of the most valuable things in life. Good friends support us when we face difficulties.',
  'Many teenagers believe that having a large number of friends is important. In fact, research shows that a few close friends bring more happiness than many casual ones.',
];
// 關鍵字句（引號、標點不影響）
assert.deepEqual(A.rangeOfKey(paras, 'a few close friends bring more happiness'), { p: 1, f: 17, t: 23 });
assert.deepEqual(A.rangeOfKey(paras, 'Good friends support us'), { p: 0, f: 10, t: 13 });
assert.equal(A.rangeOfKey(paras, 'not in the passage at all'), null);
// 依據句：第 2 段第 2 句
assert.deepEqual(A.rangeOfRef(paras, '2-2'), { p: 1, f: 12, t: 27 });
assert.equal(A.rangeOfRef(paras, '9-1'), null);
// 題目關鍵字：單複數、-ing 也算
const hits = A.keywordHits(paras, ['friend', 'happiness']);
assert.ok(hits[0].has(11) && hits[1].has(9) && hits[1].has(20) && hits[1].has(23) && !hits[0].has(0), '朋友 friends、快樂 happiness；Friendship 不算');
// 拆字：依據整句只有一個 .ev，範圍內的空白也在裡面
const html = A.paraHTML(1, paras[1], { ev: { p: 1, f: 17, t: 23 } });
assert.equal((html.match(/class="ev"/g) || []).length, 1);
const ev = html.slice(html.indexOf('class="ev"'), html.indexOf('</span></span>', html.indexOf('class="ev"')));
assert.equal((ev.match(/class="w/g) || []).length, 7, '依據 7 個字');
assert.equal((ev.match(/class="sp"/g) || []).length, 6, '字之間的 6 個空白在依據裡');
console.log('課文理解錯誤分析定位測試通過');
