// 測驗中途存檔（繼續上次）：綁定同一位學生與同一種測驗、3 天後失效、題目存成 JSON 再讀回內容不變、段考不存
import assert from 'node:assert/strict';
const mem = new Map();
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k), key: (i) => [...mem.keys()][i], get length() { return mem.size; } };
globalThis.window = globalThis;
const { store } = await import('../../js/storage.js');
const { progress } = await import('../../js/resume.js');
const { LEVELS, partitionWords } = await import('../../js/levels.js');

const alice = { cls: '301', seat: '12', name: '王小明', key: 'k1' };
const bob = { cls: '301', seat: '13', name: '李小華', key: 'k2' };

// 沒登入就不存
progress.save('u1', 'vocab', { qi: 1 });
assert.equal(progress.load('u1', 'vocab'), null, '沒有學生身分時不存也不讀');

// 存、讀
store.setStudent(alice);
progress.save('u1', 'vocab', { qi: 3, details: [{ ok: true }] });
assert.deepEqual(progress.load('u1', 'vocab'), { qi: 3, details: [{ ok: true }] });

// 綁定測驗種類
assert.equal(progress.load('u1', 'pattern'), null, '不同測驗種類不能讀到');

// 綁定學生：共用平板換人不會看到上一位的進度
store.setStudent(bob);
assert.equal(progress.load('u1', 'vocab'), null, '換成別的學生看不到');
store.setStudent(alice);
assert.notEqual(progress.load('u1', 'vocab'), null, '換回來還在');

// 3 天後失效
const raw = JSON.parse(mem.get('b5p:resume:u1'));
raw.at = Date.now() - 3 * 86400000 - 1000;
mem.set('b5p:resume:u1', JSON.stringify(raw));
assert.equal(progress.load('u1', 'vocab'), null, '超過 3 天不能續做');

// 清除
progress.save('u2', 'reading', { answers: [0, null, 2] });
assert.deepEqual(progress.load('u2', 'reading'), { answers: [0, null, 2] });
progress.clear('u2');
assert.equal(progress.load('u2', 'reading'), null);

// 壞資料不會讓網站壞掉
mem.set('b5p:resume:u3', '{不是 JSON');
assert.equal(progress.load('u3', 'vocab'), null);

// 單字題目存成 JSON 再讀回，內容要完全一樣（續做才會是同一份題目）
const words = Array.from({ length: 30 }, (_, i) => ({
  word: i < 4 ? `look after ${i}` : `word${i}`, type: i < 4 ? 'phrase' : 'word', pos: 'n.', zh: `意思${i}`,
  example: `This is [${i < 4 ? `look after ${i}` : `word${i}`}] in a sentence.`, exampleZh: '例句',
}));
const groups = partitionWords(words, 3, 'u1');
const levels = LEVELS;
let checked = 0;
levels.forEach((level, i) => {
  if (!groups[i] || !groups[i].length) return;
  const qs = level.build(groups[i], words);
  const stages = [{ levelId: level.id, qs, points: 1.5, wrong: [{ q: qs[0], yours: 'x', xp: '說明' }], finished: false }];
  progress.save('u1', 'vocab', { si: 0, qi: 2, done: 2, streak: 1, bestStreak: 2, details: [], inCard: false, elapsed: 5000, stages });
  const back = progress.load('u1', 'vocab');
  assert.deepEqual(back.stages[0].qs, JSON.parse(JSON.stringify(qs)), `${level.id}：題目存成 JSON 再讀回要一樣`);
  assert.equal(back.stages[0].levelId, level.id);
  assert(levels.some((l) => l.id === back.stages[0].levelId), '讀回後能用代號找到階段');
  checked += qs.length;
});
assert(checked > 0);

console.log('測驗中途存檔測試通過');
