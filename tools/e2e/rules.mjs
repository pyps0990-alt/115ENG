// Firestore 安全規則測試（在 Firestore 模擬器裡跑真正的 firestore.rules）。
// 需要 Java，以及 firebase-tools、@firebase/rules-unit-testing、firebase（裝在任何資料夾，用 RULES_DEPS 指過去）：
//   mkdir /tmp/rules && cd /tmp/rules && npm i firebase-tools @firebase/rules-unit-testing firebase
//   RULES_DEPS=/tmp/rules /tmp/rules/node_modules/.bin/firebase emulators:exec --only firestore --project demo-b5p "node tools/e2e/rules.mjs"
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
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

// 伺服器計分（functions/index.js）寫入的作答紀錄長這樣
const record = (o = {}) => ({
  cls: '306', seat: '7', unit: 'u1', attemptId: 'a1', key: KEY, name: '王小明', unitTitle: 'U', level: '', mode: 'vocab', review: false,
  score: 3, total: 4, pct: 75, wrong: ['x'], durationSec: 60, clientTs: '2026-10-01 10:00:00', details: [], serverGraded: true, check: '',
  createdAt: serverTimestamp(), ...o,
});
const anon = env.unauthenticatedContext().firestore();
const vaultAtt = (key, id, db = anon) => doc(db, 'vault', key, 'attempts', id);
const classAtt = (cls, seat, unit, id, db = anon) => doc(db, 'classes', cls, 'seats', seat, 'units', unit, 'attempts', id);
// 伺服器（管理員權限）寫入一筆
await env.withSecurityRulesDisabled(async (ctx) => {
  await setDoc(vaultAtt(KEY, 'a1', ctx.firestore()), record());
  await setDoc(classAtt('306', '7', 'u1', 'a1', ctx.firestore()), record());
});

// 學生的瀏覽器不能寫作答紀錄（任何路徑、任何內容都不行）：只能交給伺服器計分
await assertFails(setDoc(vaultAtt(KEY, 'a2'), record({ attemptId: 'a2' })), '不能直接寫帳本裡的成績');
await assertFails(setDoc(classAtt('306', '7', 'u1', 'a2'), record({ attemptId: 'a2' })), '不能直接寫班級路徑的成績');
await assertFails(updateDoc(vaultAtt(KEY, 'a1'), { pct: 100 }), '不能改分數');
await assertSucceeds(getDocs(collection(anon, 'vault', KEY, 'attempts')), '學生讀得回自己的紀錄');
await assertFails(getDocs(collection(anon, 'vault')), '不能列出名單');
await assertFails(setDoc(doc(anon, 'vault', KEY, 'meta', 'rate'), { t: 0, n: 0 }), '不能動限頻紀錄');
await assertFails(getDoc(doc(anon, 'private', 'fn')), '讀不到伺服器的通關密語');
// 檢討紀錄
await assertSucceeds(setDoc(doc(anon, 'vault', KEY, 'reviews', 'u1'), { unit: 'u1', at: serverTimestamp() }));
await assertFails(setDoc(doc(anon, 'vault', KEY, 'reviews', 'u2'), { unit: 'u2', at: new Date() }));

// 班級路徑：學生讀不到
await assertFails(getDoc(classAtt('306', '7', 'u1', 'a1')), '學生不能讀班級資料');

// 公開設定：大家能讀，只有老師能寫
await assertSucceeds(getDoc(doc(anon, 'public', 'config')));
await assertFails(setDoc(doc(anon, 'public', 'config'), { json: '{"hacked":1}' }));
await assertFails(setDoc(doc(anon, 'vault', keyOf('306', '9', '假學生')), { cls: '306', seat: '9', name: '假學生' }), '學生不能自己加入名單');
const teacher = env.authenticatedContext('t1', { email: 'teacher@example.com', email_verified: true }).firestore();
await assertSucceeds(setDoc(doc(teacher, 'public', 'config'), { json: '{}' }));
await assertSucceeds(getDoc(classAtt('306', '7', 'u1', 'a1', teacher)));
await assertFails(updateDoc(doc(teacher, 'vault', KEY, 'attempts', 'a1'), { pct: 100 }), '老師也不能改學生的作答紀錄');
await assertFails(setDoc(doc(teacher, 'vault', KEY, 'attempts', 't1'), record({ attemptId: 't1' })), '老師的瀏覽器也不能新增作答紀錄');
const stranger = env.authenticatedContext('s1', { email: 'someone@gmail.com', email_verified: true }).firestore();
await assertFails(setDoc(doc(stranger, 'public', 'config'), { json: '{}' }), '不在老師名單的帳號');
await assertFails(getDoc(doc(stranger, 'admins', 'teacher@example.com')), '不能查別人是不是老師');

await env.cleanup();
assert.ok(true);
console.log('Firestore 安全規則測試通過');
