// 修正一筆作答紀錄（學生用錯帳號作答）：改到另一位學生、改到別班、刪除；Firestore 兩份、試算表各分頁、成績單一起改：node tools/e2e/fix-attempt.mjs
import assert from 'node:assert';
import { createGas, keyOf } from './gas-mock.mjs';

global.__fsDocs = new Map();
const g = createGas();
g.cacheMap.set('fn-secret', 'e2e-secret');
const A = { cls: '306', seat: '20', name: '陳奕嘉' }, B = { cls: '306', seat: '21', name: '王小明' }, C = { cls: '307', seat: '5', name: '林小華' };
const unit = 'l1-voc';
const submit = (who, attemptId, pct) => {
  const d = { ...who, unit, unitTitle: 'L1 單字', level: '基礎', mode: 'vocab', score: pct / 10, total: 10, pct, attemptId, key: keyOf(who.cls, who.seat, who.name),
    details: [{ stage: '基礎', kind: 'mc', n: 1, q: 'apple', correct: '蘋果', yours: '蘋果', ok: true, word: 'apple' }, { stage: '基礎', kind: 'mc', n: 2, q: 'egg', correct: '蛋', yours: '魚', ok: false, word: 'egg' }],
    serverGraded: true, sig: 'e2e-secret', serverCheck: '' };
  assert.equal(g.post(d).ok, true);
  const fields = Object.fromEntries(Object.entries({ ...who, unit, attemptId, key: d.key, pct }).map(([k, v]) => [k, typeof v === 'number' ? { integerValue: String(v) } : { stringValue: String(v) }]));
  global.__fsDocs.set(`classes/${who.cls}/seats/${who.seat}/units/${unit}/attempts/${attemptId}`, fields);
  global.__fsDocs.set(`vault/${d.key}/attempts/${attemptId}`, fields);
};
submit(A, 'att-aaa111', 90);
submit(A, 'att-bbb222', 40);
submit(B, 'att-ccc333', 50);
const ok = (r) => { assert.equal(r.ok, true, JSON.stringify(r)); return r.data; };
ok(g.api('getScores', [{}])); // 整理 inbox

const sheet = (n) => (g.ss.getSheetByName(n) || { rows: [] }).rows.slice(1).filter((r) => r.length && r.some((v) => v !== ''));
const scoreOf = (id, n = 'scores') => sheet(n).find((r) => r[17] === id);
const cell = (cls, seat) => { const sh = g.ss.getSheetByName('成績單 ' + cls); const head = sh.rows[0]; const c = head.indexOf(unit); const r = sh.rows.slice(1).find((x) => String(x[1]).replace(/^0+(?=\d)/, '') === seat); return r ? r[c] : undefined; };
const has = (p) => global.__fsDocs.has(p);
const fsName = (who, id) => global.__fsDocs.get(`classes/${who.cls}/seats/${who.seat}/units/${unit}/attempts/${id}`);
let bad = 0;
const step = (n, f) => { try { f(); console.log('✓', n); } catch (e) { bad++; console.log('✗', n, '\n  ', String(e.message).split('\n')[0]); } };

step('一開始：成績單是每人最高分', () => { assert.equal(cell('306', '20'), 90); assert.equal(cell('306', '21'), 50); });

step('改到同班另一位學生：Firestore 兩份搬家、試算表改名、兩人的成績單重新取最高分', () => {
  const r = ok(g.api('fixAttempt', ['att-aaa111', { ...A, unit }, B]));
  assert.equal(r.firestore, 2);
  assert.ok(!has(`classes/306/seats/20/units/${unit}/attempts/att-aaa111`) && !has(`vault/${keyOf(A.cls, A.seat, A.name)}/attempts/att-aaa111`), '舊的刪掉');
  assert.equal(fsName(B, 'att-aaa111').name.stringValue, '王小明');
  assert.equal(global.__fsDocs.get(`vault/${keyOf(B.cls, B.seat, B.name)}/attempts/att-aaa111`).key.stringValue, keyOf(B.cls, B.seat, B.name));
  const row = scoreOf('att-aaa111'); assert.deepEqual([row[1], row[2], row[3]], ['306', '21', '王小明']);
  const crow = scoreOf('att-aaa111', '班級 306'); assert.deepEqual([crow[2], crow[3]], ['21', '王小明']);
  assert.ok(sheet('details').filter((r) => r[1] === 'att-aaa111').every((r) => r[3] === '21' && r[4] === '王小明'));
  assert.equal(cell('306', '20'), 40, '原本的學生剩 40');
  assert.equal(cell('306', '21'), 90, '新的學生變 90');
});

step('改到別班：舊班級分頁少一列、新班級分頁多一列，新班級成績單有分數', () => {
  ok(g.api('fixAttempt', ['att-bbb222', { ...A, unit }, C]));
  assert.ok(!scoreOf('att-bbb222', '班級 306'));
  assert.deepEqual(scoreOf('att-bbb222', '班級 307').slice(1, 4), ['307', '5', '林小華']);
  assert.equal(cell('306', '20'), '', '原本的學生沒有成績了');
  assert.equal(cell('307', '5'), 40);
  assert.ok(fsName(C, 'att-bbb222'));
});

step('刪除一筆：各處都刪掉，成績單取剩下的最高分', () => {
  ok(g.api('fixAttempt', ['att-ccc333', { ...B, unit }, null]));
  assert.ok(!scoreOf('att-ccc333') && !scoreOf('att-ccc333', '班級 306'));
  assert.equal(sheet('details').filter((r) => r[1] === 'att-ccc333').length, 0);
  assert.ok(!has(`classes/306/seats/21/units/${unit}/attempts/att-ccc333`) && !has(`vault/${keyOf(B.cls, B.seat, B.name)}/attempts/att-ccc333`));
  assert.equal(cell('306', '21'), 90, '王小明剩搬過來的那筆 90');
});

step('同一筆不會被定時同步重新寫回去（記錄編號沒變）', () => {
  assert.equal(sheet('scores').filter((r) => r[17] === 'att-aaa111').length, 1);
});

step('擋掉錯誤的操作', () => {
  assert.equal(g.api('fixAttempt', ['att-aaa111', { ...B, unit }, B]).ok, false, '改到同一個人');
  assert.equal(g.api('fixAttempt', ['att-nothere', { ...B, unit }, null]).ok, false, '找不到這筆');
  assert.equal(g.api('fixAttempt', ['att-aaa111', { ...B, unit }, A], 'stranger@example.com').ok, false, '不是老師');
  assert.equal(g.api('fixAttempt', ['bad id!', { ...B, unit }, null]).ok, false, '編號格式');
});

step('操作紀錄', () => {
  const log = sheet('audit').map((r) => r[2]);
  assert.equal(log.filter((x) => x === '成績改到另一位學生').length, 2);
  assert.equal(log.filter((x) => x === '刪除一筆成績').length, 1);
});

if (bad) { console.log(bad + ' 項失敗'); process.exit(1); }
console.log('成績修正測試通過');
