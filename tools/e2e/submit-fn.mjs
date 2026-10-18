// 伺服器計分 Cloud Function（functions/index.js）整合測試：在模擬器裡送成績，確認名單檢查、重算分數、重複送出、限頻。
//   npx firebase emulators:exec --only functions,firestore --project demo-b5p "node tools/e2e/submit-fn.mjs"
//   （先執行 node tools/copy-site-to-functions.mjs，並在 functions/ 裡 npm i）
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../functions/package.json', import.meta.url));
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
initializeApp({ projectId: 'demo-b5p' });
const db = getFirestore();
const URL_ = 'http://127.0.0.1:5001/demo-b5p/asia-east1/submit';
const key = (c, s, n) => crypto.createHash('sha256').update(`${c}|${s}|${n}`).digest('hex');
const KEY = key('306', '7', '王小明');
await db.doc(`vault/${KEY}`).set({ cls: '306', seat: '7', name: '王小明' });
const reading = { questions: Array.from({ length: 4 }, (_, i) => ({ q: `Q${i}?`, options: ['a', 'b', 'c', 'd'], answer: i % 4 })) };
await db.doc('public/content_r1').set({ json: JSON.stringify({ v: '1', data: reading }) });
await db.doc('public/config').set({ json: JSON.stringify({ units: {} }) });
const K = ['A', 'B', 'C', 'D'];
const body = (o = {}) => ({ cls: '306', seat: '7', name: '王小明', key: KEY, unit: 'r1', mode: 'reading', attemptId: `att-${Math.random().toString(36).slice(2)}`,
  score: 4, total: 4, pct: 100, durationSec: 120, clientTs: '2026-10-18 12:00:00', unitTitle: 'R1', level: '課文理解',
  details: reading.questions.map((q, i) => ({ n: i + 1, yours: `${K[i === 3 ? 0 : q.answer]}. ${q.options[i === 3 ? 0 : q.answer]}`, ok: true, points: 1 })), ...o });
const post = async (b) => { const r = await fetch(URL_, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(b) }); return { status: r.status, j: await r.json() }; };

let b = body();
let r = await post(b);
assert.equal(r.status, 200, JSON.stringify(r.j)); assert.equal(r.j.score, 3, '偽造 4/4，伺服器重算成 3/4'); assert.equal(r.j.pct, 75);
const saved = (await db.doc(`classes/306/seats/7/units/r1/attempts/${b.attemptId}`).get()).data();
assert.equal(saved.score, 3); assert.equal(saved.serverGraded, true); assert.match(saved.check, /以伺服器重算為準/);
assert.ok((await db.doc(`vault/${KEY}/attempts/${b.attemptId}`).get()).exists, '學生帳本也有一份');
r = await post(b); assert.equal(r.j.duplicate, true, '同一筆再送一次＝重複');
const seen = await (await fetch(`${URL_}?check=${b.attemptId}&key=${KEY}`)).json(); assert.equal(seen.seen, true);
r = await post(body({ name: '冒名' })); assert.equal(r.status, 403, '姓名不對');
r = await post(body({ key: key('306', '8', '李小華') })); assert.equal(r.status, 403, 'key 和姓名不符');
r = await post(body({ mode: 'vocab' })); assert.equal(r.status, 400, '題型和題庫不符');
r = await post(body({ unit: 'nope' })); assert.equal(r.status, 404);
r = await post(body({ integrity: { away: 2, awaySec: 31, paste: 1 }, durationSec: 2 }));
const all = (await db.collection(`vault/${KEY}/attempts`).get()).docs.map((x) => x.data());
const withIg = all.find((x) => x.integrity);
assert.ok(withIg && /離開作答畫面 2 次（共 31 秒）/.test(withIg.check) && /作答時間過短/.test(withIg.check) && /試圖貼上 1 次/.test(withIg.check), withIg && withIg.check);
// 限頻：10 分鐘內第 21 筆以後回忙碌
let busy = 0;
for (let i = 0; i < 20; i++) { r = await post(body()); if (r.status === 429) busy++; }
assert.ok(busy > 0, '超過限頻要回忙碌');
console.log('伺服器計分 Cloud Function 測試通過');
