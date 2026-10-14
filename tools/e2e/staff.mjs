// 老師名單只在 teachers 分頁維護，自動同步到 Firestore admins 與 Realtime Database staff；後台操作紀錄（audit 分頁）
//   node tools/e2e/staff.mjs
import assert from 'node:assert'; // 非 strict：Code.gs 在另一個 vm 環境
import { createGas } from './gas-mock.mjs';

const T = 'teacher@example.com';
const g = createGas({ teachers: [T], fsAdmins: ['old.admin@school.tw', T], rtdbStaff: { 'monitor@school,tw': true } });
const ok = (r) => { assert.equal(r.ok, true, JSON.stringify(r)); return r.data; };
const emails = () => g.sheets.get('teachers').rows.slice(1).map((r) => String(r[0]).toLowerCase());

// 1. 第一次同步（老師打開後台）：Firebase 已有、試算表沒有的帳號先補進試算表，誰都不會失去權限
ok(g.api('getAdminData', []));
assert.deepEqual(emails().sort(), [T, 'monitor@school.tw', 'old.admin@school.tw'].sort());
assert.deepEqual([...g.admins].sort(), [T, 'monitor@school.tw', 'old.admin@school.tw'].sort(), 'Firestore admins 補齊');
assert.deepEqual(g.rtdb.staff, { 'teacher@example,com': true, 'monitor@school,tw': true, 'old,admin@school,tw': true }, '監控頁名單：句點換成逗號');
assert.ok(g.sheets.get('teachers').rows.some((r) => r[1] === '從 Firebase 合併'));

// 2. 名單沒變：不再寫 Firebase
const puts = g.calls.rtdbPut;
ok(g.api('getAdminData', []));
assert.equal(g.calls.rtdbPut, puts, '名單沒變不重寫');

// 3. 在試算表刪掉一位、新增一位（大小寫、空白、重複、格式錯的都整理掉）：兩邊跟著改，被刪的人失去權限
const sh = g.sheets.get('teachers');
sh.rows = sh.rows.filter((r) => String(r[0]).toLowerCase() !== 'old.admin@school.tw');
sh.appendRow(['  New.Teacher@School.TW ', '新老師']);
sh.appendRow(['new.teacher@school.tw', '重複']);
sh.appendRow(['不是 email', '']);
assert.equal(g.ctx.isTeacher_('old.admin@school.tw'), true, '同步前快取還在');
ok(g.api('getAdminData', []));
assert.deepEqual([...g.admins].sort(), [T, 'monitor@school.tw', 'new.teacher@school.tw'].sort());
assert.deepEqual(Object.keys(g.rtdb.staff).sort(), ['monitor@school,tw', 'new,teacher@school,tw', 'teacher@example,com']);
assert.equal(g.ctx.isTeacher_('old.admin@school.tw'), false, '移除後立刻失去權限（清掉快取）');
assert.ok(!emails().includes('old.admin@school.tw'), '第一次合併之後，不會再從 Firebase 補回來');

// 4. 監控資料庫還沒建立：Firestore 照樣同步，下次再試監控那份
g.rtdb.down = true;
sh.appendRow(['third@school.tw', '']);
assert.match(g.ctx.syncStaff(), /寫入失敗/);
assert.ok(g.admins.has('third@school.tw'));
g.rtdb.down = false;
ok(g.api('getAdminData', []));
assert.equal(g.rtdb.staff['third@school,tw'], true, '資料庫好了之後補寫');

// 5. 名單是空的：不同步（避免所有人失去權限）
const saved = sh.rows;
sh.rows = [sh.rows[0]];
assert.throws(() => g.ctx.syncStaff_(), /沒有任何老師帳號/);
assert.ok(g.admins.size >= 3, 'Firebase 名單不受影響');
sh.rows = saved;

// 6. 操作紀錄：誰、做了什麼
const words = ['apple', 'bread', 'candy', 'dance'].map((w) => ({ word: w, pos: 'n.', zh: w, example: `I like [${w}].`, exampleZh: '我喜歡。' }));
ok(g.api('saveCustomUnits', [[{ id: 'u1', title: 'U1', type: 'vocab', lesson: 1 }, { id: 'u2', title: 'U2', type: 'vocab', lesson: 1 }]]));
ok(g.api('saveContent', ['u1', { topic: 't', words }, true, null]));
ok(g.api('deleteContent', ['u1', false, null]));
ok(g.api('saveCustomUnits', [[{ id: 'u1', title: 'U1', type: 'vocab', lesson: 1 }]]));
ok(g.api('setAiSettings', ['secret-key-123', 'gemini-x', {}]));
const log = g.sheets.get('audit').rows;
assert.deepEqual(log[0], ['time', 'email', 'action', 'target', 'detail']);
const acts = log.slice(1).map((r) => r[2] + '|' + r[3]);
for (const a of ['同步老師名單|', '儲存題目|u1', '刪除題目|u1', '刪除單元|u2', '修改 AI 設定|']) assert.ok(acts.includes(a), '缺少紀錄 ' + a + '：' + acts.join(', '));
assert.ok(log.slice(1).every((r) => r[1]), '每筆都有帳號');
assert.ok(log.find((r) => r[3] === 'u1' && r[2] === '儲存題目')[1] === T, '記下操作的老師');
assert.ok(!JSON.stringify(log).includes('secret-key-123'), '不記金鑰內容');

// 7. 錯誤分析引擎：Apps Script 代為呼叫 Space 的 Gradio API（金鑰不給瀏覽器）
{
  const words = ['apple', 'bread', 'candy', 'dance'].map((w) => ({ word: w, pos: 'n.', zh: w, example: `I like [${w}].`, exampleZh: '我喜歡。' }));
  ok(g.api('saveContent', ['u1', { topic: 't', words }, false, null]));
  const seen = [];
  global.__space = (name, data) => {
    seen.push([name, data]);
    return name === 'start' ? JSON.stringify({ job: 'job-1', ahead: 0 })
      : JSON.stringify({ status: 'done', result: { sig: 'x', words: {}, pairs: {} }, seconds: 3 });
  };
  assert.deepEqual(ok(g.api('getBrainConfig', [])), { url: '', hasKey: false });
  assert.throws(() => g.ctx.brainStart('u1'), /權限|網址|金鑰/);
  const cfg = ok(g.api('setBrainConfig', ['https://abc-b5-brain.hf.space/', 'secret-key']));
  assert.deepEqual(cfg, { url: 'https://abc-b5-brain.hf.space', hasKey: true }, '金鑰不回傳給瀏覽器');
  assert.match(String(g.api('setBrainConfig', ['https://evil.example.com', '']).error), /hf\.space/, '網址只收 hf.space');
  const s = ok(g.api('brainStart', ['u1']));
  assert.equal(s.job, 'job-1');
  assert.equal(seen[0][0], 'start');
  assert.equal(seen[0][1][0], 'secret-key', '金鑰由 Apps Script 帶給 Space');
  assert.equal(seen[0][1][1], 'u1');
  assert.deepEqual(JSON.parse(seen[0][1][2]).words.map((w) => w.word), ['apple', 'bread', 'candy', 'dance'], '題目從 Firebase 讀出送去分析');
  const j = ok(g.api('brainJob', ['job-1']));
  assert.equal(j.status, 'done');
  // Space 回報錯誤、或沒開機
  global.__space = () => JSON.stringify({ error: '金鑰不正確' });
  assert.match(String(g.api('brainStart', ['u1']).error), /金鑰不正確/);
  global.__spaceDown = true;
  assert.match(String(g.api('brainJob', ['job-1']).error), /沒有回應|醒來/);
  global.__spaceDown = false;
  assert.ok(g.sheets.get('audit').rows.some((r) => r[2] === '錯誤分析' && r[3] === 'u1'));
}
console.log('老師名單同步與操作紀錄測試通過');
