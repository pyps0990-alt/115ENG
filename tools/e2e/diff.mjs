// 解析裡標出錯誤：單字模式（句子）與字母模式（拼字）、多種正確寫法、HTML 跳脫
import assert from 'node:assert/strict';
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.window = globalThis;
const { diffAnswer } = await import('../../js/components/diff.js');

// 全對：沒有任何標記
let d = diffAnswer('I have lived here', ['I have lived here']);
assert.equal(d.exact, true);
assert(!d.yoursHTML.includes('<mark'));

// 兩個字對調：答案裡有字被標成錯，正確答案裡有字被標成漏掉
d = diffAnswer('I have lived here for years ten', ['I have lived here for ten years']);
assert.equal(d.exact, false);
assert(d.yoursHTML.includes('<mark class="bit-wrong">'), '排錯的字要標出來');
assert(d.correctHTML.includes('<mark class="bit-miss">'), '漏掉的字要標出來');
assert.equal((d.yoursHTML.match(/<mark/g) || []).length, 1, '兩個字對調：只需要標 1 個字（另一個順序是對的）');

// 少了字：答案沒有標記，正確答案標出漏掉的字
d = diffAnswer('I have lived', ['I have lived here for ten years']);
assert(!d.yoursHTML.includes('<mark'));
assert((d.correctHTML.match(/<mark class="bit-miss">/g) || []).length === 4);

// 多了不該有的字
d = diffAnswer('I have really lived here', ['I have lived here']);
assert(d.yoursHTML.includes('<mark class="bit-wrong">really</mark>'));

// 大小寫、標點不影響
d = diffAnswer('i HAVE lived, here.', ['I have lived here']);
assert.equal(d.exact, true);

// 拼字模式：逐字母，標出拼錯與漏掉的字母
d = diffAnswer('advesity', ['adversity']);
assert(d.correctHTML.includes('<mark class="bit-miss">r</mark>'), '漏掉的 r');
assert(!d.yoursHTML.includes('<mark'), '少一個字母：答案裡沒有多餘的字母');
d = diffAnswer('adverxity', ['adversity']);
assert(d.yoursHTML.includes('<mark class="bit-wrong">x</mark>'), '拼錯的 x');
assert(d.correctHTML.includes('<mark class="bit-miss">s</mark>'), '應該是 s');

// 多種寫法：挑最接近的那一種來標，其他寫法接在後面
d = diffAnswer('I like him lot a', ['I like him very much', 'I like him a lot']);
assert(d.correctHTML.includes('/ I like him very much'), '其他寫法接在後面');
assert(d.correctHTML.startsWith('I like him'), '最接近的是 a lot 那一種');

// 沒作答
d = diffAnswer('', ['abc']);
assert.equal(d.yoursHTML, '');

// 學生答案裡的 HTML 要跳脫
d = diffAnswer('<img src=x onerror=alert(1)> here', ['I am here']);
assert(!d.yoursHTML.includes('<img'), '不能把學生輸入的標籤當成 HTML');
assert(d.yoursHTML.includes('&lt;img'));

console.log('解析標示錯誤測試通過');
