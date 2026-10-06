// 單字分配：全部單字一次考到、各段平均、片語分散、每次複習換階段
import assert from 'node:assert/strict';
const mem = new Map();
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k), key: (i) => [...mem.keys()][i], get length() { return mem.size; } };
globalThis.window = globalThis;
const { partitionWords, stageSizes, pickWords, PER_TEST } = await import('../../js/levels.js');

assert.deepEqual(stageSizes(27, 3), [9, 9, 9]);
assert.deepEqual(stageSizes(28, 3), [10, 9, 9]);
assert.deepEqual(stageSizes(30, 3), [10, 10, 10]);
assert.deepEqual(stageSizes(5, 3), [2, 2, 1]);
assert.deepEqual(stageSizes(9, 1), [9]);

const mk = (n, ph) => Array.from({ length: n }, (_, i) => ({ word: (i < ph ? 'phrase one ' : 'word') + i, type: i < ph ? 'phrase' : 'word' }));
for (const [n, ph] of [[27, 3], [30, 5], [22, 2], [9, 0], [4, 1]]) {
  mem.clear();
  const all = mk(n, ph);
  let prev = null;
  for (let round = 0; round < 6; round++) {
    const g = partitionWords(all, 3, 'u1');
    const flat = g.flat().map((w) => w.word);
    assert.equal(flat.length, n, '每個字都要出現');
    assert.equal(new Set(flat).size, n, '不能重複');
    const sizes = g.map((x) => x.length).sort((a, b) => b - a);
    if (round === 0) assert.deepEqual(sizes, stageSizes(n, 3), `首次分配平均 n=${n}`);
    if (round === 0 && ph >= 3) assert(g.every((x) => x.some((w) => w.type === 'phrase')), '片語平均分散在各段');
    const where = new Map(g.flatMap((x, s) => x.map((w) => [w.word, s])));
    if (prev && n >= 6) for (const [w, s] of where) assert.notEqual(s, prev.get(w), `複習時 ${w} 必須換到別的階段 (round ${round})`);
    prev = where;
  }
}
// 只開兩段、或老師改了單字
mem.clear();
const base = mk(24, 3);
partitionWords(base, 3, 'u2');
const changed = base.slice(3).concat(mk(6, 0).map((w) => ({ ...w, word: 'new' + w.word })));
const g2 = partitionWords(changed, 3, 'u2');
assert.equal(g2.flat().length, 27);
assert.equal(partitionWords(base, 1, 'u3')[0].length, 24);
// 超過 30 個字：每次抽 30 個，上次沒考到的優先、片語照比例，兩次輪完全部；30 個以內全部考
{
  mem.clear();
  assert.equal(PER_TEST, 30);
  const small = mk(30, 4);
  assert.equal(pickWords(small, 's1'), small, '30 個以內不抽題');
  const big = mk(50, 5);
  const p1 = pickWords(big, 'b1');
  assert.equal(p1.length, 30); assert.equal(new Set(p1).size, 30);
  assert.equal(p1.filter((w) => w.type === 'phrase').length, 3, '片語照比例（5/50 × 30 = 3）');
  const p2 = pickWords(big, 'b1');
  assert.equal(p2.length, 30);
  const rest = big.filter((w) => !p1.includes(w));
  assert.ok(rest.every((w) => p2.includes(w)), '第二次一定包含上次沒考到的 20 個');
  assert.equal(new Set([...p1, ...p2]).size, 50, '兩次就輪完全部');
  // 新的一輪：第三次優先考第二次沒抽到的字
  const p3 = pickWords(big, 'b1');
  const notIn2 = big.filter((w) => !p2.includes(w));
  assert.ok(notIn2.every((w) => p3.includes(w)), '新一輪從上次沒抽到的開始');
  // 抽出來的字照樣能分成三段
  const g = partitionWords(p3, 3, 'b1');
  assert.deepEqual(g.map((x) => x.length), [10, 10, 10]);
}
console.log('單字分配測試通過');
