// 單字分配：全部單字一次考到、各段平均、片語分散、每次複習換階段
import assert from 'node:assert/strict';
const mem = new Map();
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k), key: (i) => [...mem.keys()][i], get length() { return mem.size; } };
globalThis.window = globalThis;
const { partitionWords, stageSizes } = await import('../../js/levels.js');

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
console.log('單字分配測試通過');
