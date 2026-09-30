// 直接測試 Code.gs 的儲存邏輯（不需要瀏覽器）：node tools/e2e/gas-selftest.mjs
import assert from 'node:assert'; // 非 strict：Code.gs 在另一個 vm 環境，陣列的原型不同
import { createGas } from './gas-mock.mjs';

const published = {};
const g = createGas({ onFirestoreCommit: (body) => body.writes.forEach((w) => { published[w.update.name.split('/public/')[1]] = JSON.parse(w.update.fields.json.stringValue); }) });
const ok = (r) => { assert.equal(r.ok, true, JSON.stringify(r)); return r.data; };

// 沒權限的帳號
assert.equal(g.api('getAdminData', [], 'stranger@example.com').ok, false);

// 空白開始
let d = ok(g.api('getAdminData', []));
assert.deepEqual(d.units, []); assert.deepEqual(d.customUnits, []);
assert.ok(d.config && d.config.units, 'getAdminData 要回傳 config');

// 新增兩個單元並儲存（帶瀏覽器算的時間）
const t0 = new Date().toISOString();
const custom = [
  { id: 'l1-voc', title: 'L1 單字', type: 'vocab', lesson: 1, topic: '', visible: true, disabled: [], questionCount: 10, custom: true, openAt: '', closeAt: '' },
  { id: 'l1-reading', title: 'L1 課文', type: 'reading', lesson: 1, topic: '', visible: true, disabled: ['reading'], questionCount: 5, custom: true, openAt: '2026-10-01T08:00', closeAt: '' },
];
let r = ok(g.api('saveAllSettings', [[], custom, { now: t0 }]));
assert.equal(r.syncError, '');
assert.equal(r.config.units['l1-voc'].since, t0, '新單元的建立時間要沿用瀏覽器傳來的時間');
assert.equal(r.config.units['l1-reading'].openAt, '2026-10-01T08:00');
assert.equal(r.config.customUnits.length, 2);
assert.ok(published.config, '伺服器要把設定寫進 Firestore');
assert.deepEqual(published.config.customUnits.map((u) => u.id), ['l1-voc', 'l1-reading']);

// 瀏覽器傳來的時間差太多就不採用
const far = '2020-01-01T00:00:00.000Z';
r = ok(g.api('saveAllSettings', [[], custom.concat([{ id: 'x', title: 'X', type: 'vocab', lesson: 2, custom: true }]), { now: far }]));
assert.notEqual(r.config.units.x.since, far);
r = ok(g.api('saveAllSettings', [[], custom, { now: t0 }])); // x 刪除
assert.equal(r.config.units.x, undefined);

// 存單字內容：一次 commit 同時寫題目與設定
const words = ['apple', 'bread', 'candy', 'dance', 'eagle'].map((w, i) => ({ word: w, pos: 'n.', zh: '字' + i, example: `I like [${w}] a lot.`, exampleZh: '我喜歡。' }));
const vocab = { topic: 'Food', words };
g.calls.commit.length = 0;
const t1 = new Date().toISOString();
r = ok(g.api('saveContent', ['l1-voc', vocab, true, { now: t1 }]));
assert.equal(r.count, 5);
assert.equal(g.calls.commit.length, 1, '題目與設定要在同一個 commit');
assert.equal(g.calls.commit[0].writes.length, 2);
assert.equal(published['content_l1-voc'].v, t1);
assert.deepEqual(published['content_l1-voc'].data, vocab);
assert.equal(r.config.content['l1-voc'].updated, t1);
assert.equal(r.config.content['l1-voc'].count, 5);
assert.equal(r.config.content['l1-voc'].topic, 'Food');
assert.equal(r.config.units['l1-voc'].since, t1, '重製進度時 since 要等於這次的時間');

// 內容分頁多了 count / topic 欄，且 getAdminData 不用讀題目內容
const sh = g.sheets.get('content');
assert.deepEqual(sh.rows[0].slice(0, 6), ['id', 'json', 'updated', 'updatedBy', 'count', 'topic']);
assert.equal(sh.rows[1][4], 5);
d = ok(g.api('getAdminData', []));
assert.equal(d.content[0].count, 5);
assert.equal(d.config.content['l1-voc'].updated, t1);

// 讀回內容
const got = ok(g.api('getContent', ['l1-voc']));
assert.deepEqual(got.data, vocab);

// 不重製進度
const t2 = new Date(Date.now() + 1000).toISOString();
r = ok(g.api('saveContent', ['l1-voc', vocab, false, { now: t2 }]));
assert.equal(r.config.units['l1-voc'].since, t1, '不重製時 since 不變');
assert.equal(r.config.content['l1-voc'].updated, t2);

// 課文
const reading = { title: 'T', topic: 'Tea', passage: ['Tea is a drink made from leaves.'], questions: [{ q: 'What is tea?', options: ['A', 'B'], answer: 0, explain: 'x' }] };
r = ok(g.api('saveContent', ['l1-reading', reading, true, null]));
assert.equal(r.count, 1);
assert.equal(r.config.content['l1-reading'].topic, 'Tea');

// 舊資料（沒有 count/topic 欄）自動補齊
const old = g.sheets.get('content');
old.rows[1] = old.rows[1].slice(0, 4);
old.rows[0] = old.rows[0].slice(0, 4);
d = ok(g.api('getAdminData', []));
assert.equal(d.content.find((x) => x.id === 'l1-voc').count, 5);
assert.equal(old.rows[1][5], 'Food');
assert.equal(old.rows[0][4], 'count');

// 補作時間
r = ok(g.api('saveExtensions', [[{ unit: 'l1-voc', cls: '306', seat: '07', until: '2026-10-05T18:00', note: '病假' }, { unit: 'l1-voc', cls: '3', seat: '1', until: '2026-10-05T18:00' }], null]));
assert.deepEqual(r.config.ext, { 'l1-voc': { '306-7': '2026-10-05T18:00' } });

// 刪除題目
r = ok(g.api('deleteContent', ['l1-reading', true, { now: new Date().toISOString() }]));
assert.equal(r.config.content['l1-reading'], undefined);
assert.equal(ok(g.api('getContent', ['l1-reading'])), null);

// 學生端讀取（GET）
assert.equal(g.get({ action: 'config' }).units['l1-voc'].visible, true);
assert.equal(g.get({ action: 'content', unit: 'l1-voc' }).ok, true);

// 效率：存內容時讀試算表的次數要很少
g.calls.sheetReads = 0;
ok(g.api('saveContent', ['l1-voc', vocab, true, { now: new Date().toISOString() }]));
console.log('saveContent 讀試算表次數：', g.calls.sheetReads);
assert.ok(g.calls.sheetReads <= 22, '讀試算表次數太多：' + g.calls.sheetReads);
console.log('Code.gs 儲存邏輯測試全部通過');
