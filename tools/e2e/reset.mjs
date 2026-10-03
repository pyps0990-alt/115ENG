// 老師重製單元（題目更新時勾選重製，或刪掉重建）：這台裝置上那個單元的本機紀錄全部清掉，其他單元不動
import assert from 'node:assert/strict';
const mem = new Map();
const api = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
// 像真的 localStorage 一樣：Object.keys 列得出所有鍵
globalThis.localStorage = new Proxy({}, {
  get: (t, k) => api[k],
  ownKeys: () => [...mem.keys()],
  getOwnPropertyDescriptor: (t, k) => (mem.has(k) ? { enumerable: true, configurable: true, value: mem.get(k) } : undefined),
});
globalThis.window = globalThis;
const { store } = await import('../../js/storage.js');
const { progress } = await import('../../js/resume.js');

store.setStudent({ cls: '301', seat: '12', name: '王小明', key: 'k1' });
const fill = (u) => {
  store.setBest(u, 'vocab', 80); store.setDone(u); store.setFirst(u, { mode: 'vocab', details: [] }); store.setReviewed(u);
  store.addWrong(u, 'word'); store.setBag(`${u}:stages`, ['0|word']); store.setLast(u, { basic: 80 });
  progress.save(u, 'vocab', { qi: 1 });
};
const has = (u) => ({
  best: Object.keys(store.best(u)).length > 0, done: store.done(u), first: !!store.first(u), reviewed: store.reviewed(u),
  wrong: store.wrong(u).length > 0, bag: store.bag(`${u}:stages`).length > 0, last: !!store.last(u), resume: progress.has(u),
});
fill('u1'); fill('u2');
store.setTried('u3'); // 做過但沒通過
assert(Object.values(has('u1')).every(Boolean), '重製前都有');

store.resetUnit('u1');
assert(Object.values(has('u1')).every((v) => !v), 'u1 的所有本機紀錄都清掉：' + JSON.stringify(has('u1')));
assert(Object.values(has('u2')).every(Boolean), 'u2 完全不動');
store.resetUnit('u3');
assert.equal(store.tried('u3'), false, '需補考標記也清掉');

// 重製時間：第一次看到不清，之後不一樣才清
assert.equal(store.unitStamp('u2'), null);
store.setUnitStamp('u2', 111);
assert.equal(store.unitStamp('u2'), 111);

// applyHistory：伺服器上已經沒有有效作答的單元，「需補考」標記也要清；排隊中的成績不動
store.setTried('u4'); store.setTried('u5');
localStorage.setItem('b5p:outbox', JSON.stringify([{ unit: 'u5', attemptId: 'a' }]));
store.setSince({ u4: Date.now() + 1000 }); // u4 被重製：之前的作答都不算
store.applyHistory([{ unit: 'u4', pct: 40, clientTs: '2026-01-01 10:00:00', at: Date.now() - 5000, mode: 'vocab', details: [] }], []);
assert.equal(store.tried('u4'), false, '重製之前的未通過作答不算，需補考標記清掉');
assert.equal(store.tried('u5'), true, '還在排隊送出的成績不動');

// 重製之後的新作答照常算
store.setSince({ u6: Date.now() - 10000 });
store.applyHistory([{ unit: 'u6', pct: 40, clientTs: '2026-10-01 10:00:00', at: Date.now(), mode: 'vocab', details: [] }], []);
assert.equal(store.tried('u6'), true, '重製後做的未通過作答要算');

console.log('單元重製測試通過');
