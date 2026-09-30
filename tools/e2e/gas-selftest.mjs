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

/* ---------- 成績核對與去重 ---------- */
{
  const g2 = createGas();
  const okc = (r) => { assert.equal(r.ok, true, JSON.stringify(r)); return r.data; };
  const gw = (x) => x; void gw;
  okc(g2.api('saveAllSettings', [[], [
    { id: 'r1', title: 'R', type: 'reading', lesson: 1, topic: '', visible: true, disabled: [], questionCount: 5, custom: true },
    { id: 'v1', title: 'V', type: 'vocab', lesson: 1, topic: '', visible: true, disabled: [], questionCount: 4, custom: true }]]));
  const words = ['apple', 'bread', 'candy', 'dance'].map((w, i) => ({ word: w, pos: 'n.', zh: '中' + i, example: `I [${w}] it.`, exampleZh: '我。' }));
  okc(g2.api('saveContent', ['v1', { topic: 't', words }, true]));
  okc(g2.api('saveContent', ['r1', { title: 'T', topic: 't', passage: ['Tea is good.'], questions: [
    { skill: '細節', q: 'Q1?', options: ['Leaves', 'Rocks'], answer: 0, explain: 'x' }, { skill: '細節', q: 'Q2?', options: ['a', 'b'], answer: 1, explain: 'x' }] }, true]));
  const send = (o) => g2.post(Object.assign({ cls: '306', seat: '1', name: '王小明', clientTs: '2026-10-01 10:00:00' }, o));
  const lastCheck = () => { const sh = g2.sheets.get('scores'); return String(sh.rows[sh.getLastRow() - 1][18] || ''); };
  // 課文：正確的成績
  send({ attemptId: 'a1', unit: 'r1', unitTitle: 'R', mode: 'reading', score: 1, total: 2, pct: 50, durationSec: 30,
    details: [{ n: 1, correct: 'A. Leaves', yours: 'A. Leaves', ok: true, points: 1 }, { n: 2, correct: 'B. b', yours: 'A. a', ok: false, points: 0 }] });
  assert.equal(lastCheck(), '', '正常的課文成績不該被標記：' + lastCheck());
  // 課文：學生把答錯的改成答對、分數調高
  send({ attemptId: 'a2', unit: 'r1', unitTitle: 'R', mode: 'reading', score: 2, total: 2, pct: 100, durationSec: 30,
    details: [{ n: 1, correct: 'A. Leaves', yours: 'A. Leaves', ok: true, points: 1 }, { n: 2, correct: 'B. b', yours: 'A. a', ok: true, points: 1 }] });
  assert.match(lastCheck(), /不符/);
  assert.match(lastCheck(), /重算/);
  { const sh = g2.sheets.get('scores'); const r = sh.rows[sh.getLastRow() - 1]; assert.equal(r[8], 1, '課文分數要被伺服器改回 1'); assert.equal(r[10], 50); }
  // 作答時間過短
  send({ attemptId: 'a3', unit: 'r1', unitTitle: 'R', mode: 'reading', score: 1, total: 2, pct: 50, durationSec: 1,
    details: [{ n: 1, correct: 'A. Leaves', yours: 'A. Leaves', ok: true, points: 1 }, { n: 2, correct: 'B. b', yours: 'A. a', ok: false, points: 0 }] });
  assert.match(lastCheck(), /時間過短/);
  // 百分比被改
  send({ attemptId: 'a4', unit: 'r1', unitTitle: 'R', mode: 'reading', score: 1, total: 2, pct: 100, durationSec: 30,
    details: [{ n: 1, correct: 'A. Leaves', yours: 'A. Leaves', ok: true, points: 1 }, { n: 2, correct: 'B. b', yours: 'A. a', ok: false, points: 0 }] });
  assert.match(lastCheck(), /百分比/);
  // 單字：正常（含部分得分）
  send({ attemptId: 'v1a', unit: 'v1', unitTitle: 'V', mode: 'vocab', score: 2.75, total: 3, pct: 92, durationSec: 40, basic: '1/1', advanced: '1/1', mastery: '0.75/1',
    details: [{ stage: '基礎', n: 1, kind: '英→中', correct: '中0', yours: '中0', ok: true, points: 1, word: 'apple' },
      { stage: '進階', n: 1, kind: '中→英', correct: 'bread', yours: 'bread', ok: true, points: 1, word: 'bread' },
      { stage: '精熟', n: 1, kind: '拼字', correct: 'candy', yours: 'candy', ok: true, points: 0.75, hints: 1, word: 'candy' }] });
  assert.equal(lastCheck(), '', '正常的單字成績不該被標記：' + lastCheck());
  // 單字：題庫沒有的字、答錯卻標答對
  send({ attemptId: 'v1b', unit: 'v1', unitTitle: 'V', mode: 'vocab', score: 2, total: 2, pct: 100, durationSec: 40,
    details: [{ stage: '基礎', n: 1, kind: '英→中', correct: '中0', yours: '中3', ok: true, points: 1, word: 'apple' }, { stage: '基礎', n: 2, kind: '中→英', correct: 'zebra', yours: 'zebra', ok: true, points: 1, word: 'zebra' }] });
  assert.match(lastCheck(), /2 題答案與題庫不符/);
  // 管理後台看得到驗證欄
  const rows = okc(g2.api('getScores', [{}]));
  assert.ok(rows.some((r) => /時間過短/.test(r.check)) && rows.some((r) => r.check === ''));
  // 去重：超過 500 筆之後，很久以前的編號還是能認出來（快取清空模擬過期）
  const sh = g2.sheets.get('scores');
  for (let i = 0; i < 700; i++) sh.rows.push(['t', '306', '1', 'x', 'r1', '', '', '', 0, 0, 0, '', '', '', '', 0, '', 'old' + i, '']);
  g2.cacheMap.clear();
  const before = sh.getLastRow();
  const dup = send({ attemptId: 'a1', unit: 'r1', unitTitle: 'R', mode: 'reading', score: 1, total: 2, pct: 50, durationSec: 30, details: [] });
  assert.equal(dup.duplicate, true, '很久以前送過的成績要能認出是重複');
  assert.equal(sh.getLastRow(), before);
  assert.equal(g2.get({ action: 'check', id: 'old3' }).seen, true);
  // 限頻：同一位學生同一單元 10 分鐘內第 9 筆開始回「忙碌」（學生端會稍後重試，不會丟掉）
  for (let i = 0; i < 12; i++) send({ seat: '9', name: '甲', attemptId: 'rl' + i, unit: 'r1', unitTitle: 'R', mode: 'reading', score: 0, total: 2, pct: 0, durationSec: 30, details: [] });
  const limited = send({ seat: '9', name: '甲', attemptId: 'rl-x', unit: 'r1', unitTitle: 'R', mode: 'reading', score: 0, total: 2, pct: 0, durationSec: 30, details: [] });
  assert.equal(limited.busy, true);
  const other = send({ seat: '10', name: '乙', attemptId: 'rl-y', unit: 'r1', unitTitle: 'R', mode: 'reading', score: 0, total: 2, pct: 0, durationSec: 30, details: [] });
  assert.equal(other.ok, true, '其他學生不受影響');
  console.log('成績核對與去重測試通過');
}

/* ---------- 成績單：自動建立、新單元欄位、名單同步 ---------- */
{
  const g3 = createGas();
  const ok3 = (r) => { assert.equal(r.ok, true, JSON.stringify(r)); return r.data; };
  const unit = (id, lesson) => ({ id, title: '單元' + id, type: 'vocab', lesson, topic: '', visible: true, disabled: [], questionCount: 4, custom: true });
  ok3(g3.api('saveAllSettings', [[], [unit('u1', 1)]]));
  // 名單同步：分頁自動建立、學生依座號排序、單元欄位齊全
  let r = ok3(g3.api('syncGradebookRoster', ['306', [{ seat: '3', name: '丙' }, { seat: '01', name: '甲' }, { seat: '2', name: '乙' }]]));
  assert.equal(r.added, 3);
  const gb = g3.sheets.get('成績單 306');
  assert.deepEqual(gb.rows.slice(0, 4).map((x) => x.slice(0, 3).join('|')), ['班級|座號|姓名', '306|1|甲', '306|2|乙', '306|3|丙']);
  assert.equal(gb.rows[0][3], 'u1');
  // 學生交卷：分數填進正確的格子
  g3.post({ cls: '306', seat: '2', name: '乙', unit: 'u1', unitTitle: 'U', mode: 'vocab', score: 3, total: 4, pct: 75, durationSec: 90, attemptId: 'g1', details: [] });
  assert.equal(gb.rows[2][3], 75);
  // 老師新增單元：所有成績單馬上多一欄，不用等有人交卷
  ok3(g3.api('saveAllSettings', [[], [unit('u1', 1), unit('u2', 2)]]));
  assert.equal(gb.rows[0][4], 'u2', '新單元應該立刻出現在成績單');
  assert.equal(gb.rows[2][3], 75, '原本的分數不變');
  // 重複同步不會重複新增學生，也不動分數
  r = ok3(g3.api('syncGradebookRoster', ['306', [{ seat: '1', name: '甲' }, { seat: '4', name: '丁' }]]));
  assert.equal(r.added, 1); assert.equal(r.total, 4);
  assert.equal(gb.rows[2][3], 75);
  assert.deepEqual(gb.rows.slice(1).map((x) => x[1]), [1, 2, 3, 4]);
  // 沒有建立過的班級，第一筆成績進來時自動建立成績單並補上學生
  g3.post({ cls: '312', seat: '5', name: '戊', unit: 'u2', unitTitle: 'U', mode: 'vocab', score: 4, total: 4, pct: 100, durationSec: 90, attemptId: 'g2', details: [] });
  const gb2 = g3.sheets.get('成績單 312');
  assert.ok(gb2, '第一筆成績進來要自動建立成績單');
  assert.equal(gb2.rows[1][2], '戊'); assert.equal(gb2.rows[1][4], 100);
  // 一次同步所有班級（讀 Firestore 的學生資料）
  global.__vault = [{ cls: '302', seat: '1', name: 'A' }, { cls: '302', seat: '2', name: 'B' }, { cls: '306', seat: '1', name: '甲' }];
  const all = ok3(g3.api('syncAllGradebooks', []));
  assert.equal(all.classes, 2); assert.ok(g3.sheets.get('成績單 302'));
  assert.equal(g3.sheets.get('成績單 302').rows.length, 3);
  console.log('成績單自動化測試通過');
}
