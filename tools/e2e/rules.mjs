// Firestore 安全規則測試（在 Firestore 模擬器裡跑真正的 firestore.rules）。
// 需要 Java，以及 firebase-tools、@firebase/rules-unit-testing、firebase（裝在任何資料夾，用 RULES_DEPS 指過去）：
//   mkdir /tmp/rules && cd /tmp/rules && npm i firebase-tools @firebase/rules-unit-testing firebase
//   RULES_DEPS=/tmp/rules /tmp/rules/node_modules/.bin/firebase emulators:exec --only firestore --project demo-b5p "node tools/e2e/rules.mjs"
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const require = createRequire(path.join(process.env.RULES_DEPS || ROOT, 'noop.js'));
const { initializeTestEnvironment, assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const { doc, getDoc, setDoc, updateDoc, getDocs, collection, serverTimestamp } = require('firebase/firestore');

const env = await initializeTestEnvironment({
  projectId: 'demo-b5p',
  firestore: { rules: fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8') },
});
const keyOf = (cls, seat, name) => crypto.createHash('sha256').update(`${cls}|${seat}|${name}`).digest('hex');
const KEY = keyOf('306', '7', '王小明');
const OTHER = keyOf('306', '8', '李小華');

// 名單（老師匯入）
await env.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  await setDoc(doc(db, 'vault', KEY), { cls: '306', seat: '7', name: '王小明' });
  await setDoc(doc(db, 'vault', OTHER), { cls: '306', seat: '8', name: '李小華' });
  await setDoc(doc(db, 'admins', 'teacher@example.com'), { role: 'teacher' });
  await setDoc(doc(db, 'public', 'config'), { json: '{}' });
});

// 跟 js/firebase.js saveScoreToFirestore 寫的一樣
const record = (o = {}) => ({
  cls: '306', seat: '7', unit: 'u1', attemptId: 'a1', key: KEY, name: '王小明', unitTitle: 'U', level: '', mode: 'vocab', review: false,
  score: 3, total: 4, pct: 75, basic: '1/1', advanced: '1/1', mastery: '1/2', wrong: ['x'], durationSec: 60, clientTs: '2026-10-01 10:00:00',
  details: [{ stage: '基礎', kind: '英→中', n: 1, question: '', correct: 'a', yours: 'a', ok: true, open: false, points: 1, hints: 0, word: 'a', err: '', exampleEn: '', exampleZh: '' }],
  createdAt: serverTimestamp(), ...o,
});
const anon = env.unauthenticatedContext().firestore();
const vaultAtt = (key, id) => doc(anon, 'vault', key, 'attempts', id);
const classAtt = (cls, seat, unit, id, db = anon) => doc(db, 'classes', cls, 'seats', seat, 'units', unit, 'attempts', id);

// 學生帳本：自己的紀錄
await assertSucceeds(setDoc(vaultAtt(KEY, 'a1'), record()));
await assertFails(setDoc(vaultAtt(KEY, 'a1'), record({ pct: 100 })), '不能改已經送出的紀錄');
await assertFails(setDoc(vaultAtt(KEY, 'a2'), record({ attemptId: 'a2', key: OTHER })), 'key 要跟帳本一致');
await assertFails(setDoc(vaultAtt(keyOf('999', '1', '不存在'), 'a3'), record({ attemptId: 'a3', key: keyOf('999', '1', '不存在') })), '名單上沒有的人不能寫');
await assertFails(setDoc(vaultAtt(KEY, 'a4'), record({ attemptId: 'a4', hacked: true })), '多出來的欄位');
await assertFails(setDoc(vaultAtt(KEY, 'a5'), record({ attemptId: 'a5', pct: 150 })), '百分比超出範圍');
await assertFails(setDoc(vaultAtt(KEY, 'a6'), record({ attemptId: 'a6', createdAt: new Date('2020-01-01') })), '時間要用伺服器時間');
await assertFails(setDoc(vaultAtt(KEY, 'a7'), record({ attemptId: 'a7', details: Array(151).fill({}) })), '明細最多 150 筆');
await assertFails(setDoc(vaultAtt(KEY, 'a8'), record({ attemptId: 'a8', name: 'x'.repeat(41) })), '姓名太長');
await assertFails(setDoc(vaultAtt(KEY, 'a9'), record({ attemptId: 'a9', score: '3' })), '分數要是數字');
await assertSucceeds(getDocs(collection(anon, 'vault', KEY, 'attempts')));
await assertFails(getDocs(collection(anon, 'vault')), '不能列出名單');
// 檢討紀錄
await assertSucceeds(setDoc(doc(anon, 'vault', KEY, 'reviews', 'u1'), { unit: 'u1', at: serverTimestamp() }));
await assertFails(setDoc(doc(anon, 'vault', KEY, 'reviews', 'u2'), { unit: 'u2', at: new Date() }));

// 班級路徑：名單上的學生、自己的班級座號才能寫
await assertSucceeds(setDoc(classAtt('306', '7', 'u1', 'a1'), record()));
await assertFails(setDoc(classAtt('306', '7', 'u1', 'b1'), (() => { const r = record({ attemptId: 'b1' }); delete r.key; return r; })()), '沒有 key');
await assertFails(setDoc(classAtt('306', '7', 'u1', 'b2'), record({ attemptId: 'b2', key: keyOf('306', '7', '冒名') })), '名單上沒有的 key');
await assertFails(setDoc(classAtt('306', '8', 'u1', 'b3'), record({ attemptId: 'b3', seat: '8' })), '不能寫到別人的座號');
await assertFails(setDoc(classAtt('307', '7', 'u1', 'b4'), record({ attemptId: 'b4', cls: '307' })), '不能寫到別的班');
await assertFails(setDoc(classAtt('306', '7', 'u2', 'b5'), record({ attemptId: 'b5' })), '單元要跟路徑一致');
await assertFails(getDoc(classAtt('306', '7', 'u1', 'a1')), '學生不能讀班級資料');

// 公開設定：大家能讀，只有老師能寫
await assertSucceeds(getDoc(doc(anon, 'public', 'config')));
await assertFails(setDoc(doc(anon, 'public', 'config'), { json: '{"hacked":1}' }));
await assertFails(setDoc(doc(anon, 'vault', keyOf('306', '9', '假學生')), { cls: '306', seat: '9', name: '假學生' }), '學生不能自己加入名單');
const teacher = env.authenticatedContext('t1', { email: 'teacher@example.com', email_verified: true }).firestore();
await assertSucceeds(setDoc(doc(teacher, 'public', 'config'), { json: '{}' }));
await assertSucceeds(getDoc(classAtt('306', '7', 'u1', 'a1', teacher)));
await assertFails(updateDoc(doc(teacher, 'vault', KEY, 'attempts', 'a1'), { pct: 100 }), '老師也不能改學生的作答紀錄');
const stranger = env.authenticatedContext('s1', { email: 'someone@gmail.com', email_verified: true }).firestore();
await assertFails(setDoc(doc(stranger, 'public', 'config'), { json: '{}' }), '不在老師名單的帳號');
await assertFails(getDoc(doc(stranger, 'admins', 'teacher@example.com')), '不能查別人是不是老師');

await env.cleanup();
assert.ok(true);
console.log('Firestore 安全規則測試通過');
