// 伺服器計分與收成績（Firebase Cloud Functions，asia-east1）。
//   POST /submit   學生交卷：確認是名單上的學生 → 依老師的題庫重新判斷對錯、重算分數（js/grade.js，跟網站同一套判斷）
//                  → 寫進 Firestore（班級路徑與學生帳本兩份）→ 轉送 Apps Script 更新試算表 → 回覆伺服器算出的分數。
//   GET  /submit?check=<attemptId>&key=<帳本 key>   這筆成績伺服器收到了沒（學生端讀不到回應時確認用）
//   POST { op: 'key' }      課文理解、句型練習的完整題目（答案、解析）：只給交過這個單元的學生（檢討、複習、錯題重練用）
//   POST { op: 'answer' }   句型練習正式測驗的一題：伺服器判斷並記下（第一次作答就鎖定），回傳這一題的答案與解析
// 課文理解、句型練習的答案不公開（js/answers.js）：完整題目在 secure/content_<單元>，只有老師和這個函式讀得到
// 學生的瀏覽器不能直接寫成績（firestore.rules 擋掉），學生送來的分數、對錯一律不採用。
// 部署：npx firebase deploy --only functions（predeploy 會先把網站的 js/ 複製到 functions/site/）
import { onRequest } from 'firebase-functions/v2/https';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { createHash } from 'node:crypto';
import { gradeSubmission } from './site/grade.js';
import { flattenPattern, judge, applyScore } from './site/components/items.js';

initializeApp();
const db = getFirestore();

const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbw1KgAc6VsJkFM-ADUJY3NHWt4Y4KYDlUjppRlzKB__HRHEwPzgxfK0GXkMKaF9x1Ny/exec';
const ORIGINS = ['https://eng-3385e.web.app', 'https://eng-3385e.firebaseapp.com', 'http://localhost:5173'];
const RATE_WINDOW_MS = 10 * 60 * 1000; // 同一位學生 10 分鐘內最多 RATE_MAX 筆（正常使用遠低於這個數字）
const RATE_MAX = 20;
const MODES = ['vocab', 'reading', 'pattern'];

const clean = (s, max) => String(s == null ? '' : s).trim().slice(0, max);
const num = (v, lo = 0, hi = 1e6) => Math.max(lo, Math.min(hi, Number(v) || 0));
const studentKey = (cls, seat, name) => createHash('sha256').update(`${clean(cls, 8)}|${clean(seat, 4)}|${clean(name, 40).replace(/\s+/g, '')}`, 'utf8').digest('hex');

// 公開設定與題庫（老師儲存時才會變）：每個執行個體快取 60 秒
const cache = new Map();
async function publicJson(id) {
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < 60000) return hit.v;
  const snap = await db.doc(`public/${id}`).get();
  let v = null;
  try { v = snap.exists ? JSON.parse(snap.get('json')) : null; } catch { v = null; }
  cache.set(id, { at: Date.now(), v });
  return v;
}
// 題目：先讀完整版（secure，含答案）；還沒分開存的舊題目才讀公開版
async function contentJson(unit) {
  const id = `content_${unit}`;
  const hit = cache.get(`s:${id}`);
  if (hit && Date.now() - hit.at < 60000) return hit.v;
  const snap = await db.doc(`secure/${id}`).get();
  let v = null;
  try { v = snap.exists ? JSON.parse(snap.get('json')) : null; } catch { v = null; }
  if (!v) v = await publicJson(id);
  cache.set(`s:${id}`, { at: Date.now(), v });
  return v;
}
// 轉送 Apps Script 用的通關密語（存在 Firestore private/fn，規則不讓任何人讀；Apps Script 用專案擁有者權限讀同一份）
let secretP = null;
const fnSecret = () => (secretP = secretP || db.doc('private/fn').get().then((s) => String((s.exists && s.get('secret')) || '')).catch(() => { secretP = null; return ''; }));

// 跟 js/firebase.js 以前直接寫入時一樣的欄位與長度限制
function cleanDetails(list) {
  return (Array.isArray(list) ? list : []).slice(0, 150).map((x) => ({
    stage: clean(x.stage, 20), kind: clean(x.kind, 20), n: Number(x.n) || 0,
    question: clean(x.q ?? x.question, 300), correct: clean(x.correct, x.open ? 800 : 200), yours: clean(x.yours, x.open ? 3000 : 200),
    ok: !!x.ok, open: !!x.open, points: Number(x.points) || 0, hints: Number(x.hints) || 0,
    word: clean(x.word, 80), err: clean(x.err, 20), exampleEn: clean(x.exampleEn, 200), exampleZh: clean(x.exampleZh, 200),
    ...(Array.isArray(x.options) ? { options: x.options.slice(0, 6).map((o) => clean(o, 200)) } : {}),
    ...(Number.isInteger(x.exIdx) ? { exIdx: x.exIdx } : {}),
    ...(Array.isArray(x.extras) ? { extras: x.extras.slice(0, 3).map((e) => ({ form: clean(e && e.form, 60), word: clean(e && e.word, 60), zh: clean(e && e.zh, 60), pos: clean(e && e.pos, 20) })) } : {}),
  }));
}
const TOOLS = ['hl-yellow', 'hl-green', 'hl-pink', 'ul', 'circ', 'note'];
function cleanMarks(list) {
  if (!Array.isArray(list)) return null;
  return list.slice(0, 300).map((m) => ({
    p: Math.max(0, Math.floor(Number(m.p) || 0)), f: Math.max(0, Math.floor(Number(m.f) || 0)), t: Math.max(0, Math.floor(Number(m.t) || 0)),
    k: TOOLS.includes(m.k) ? m.k : 'hl-yellow', ...(m.n ? { n: clean(m.n, 200) } : {}), ...(Number.isInteger(m.q) && m.q >= 0 && m.q < 50 ? { q: m.q } : {}),
  }));
}
function cleanIntegrity(ig) {
  if (!ig || typeof ig !== 'object') return null;
  const n = (v) => Math.floor(num(v, 0, 100000));
  const out = { away: n(ig.away), awaySec: n(ig.awaySec), translate: n(ig.translate), paste: n(ig.paste), copy: n(ig.copy) };
  return Object.values(out).some(Boolean) ? out : null;
}

// 給老師看的核對說明（後台成績頁「驗證」欄）：伺服器重算的說明、作答時間、作答誠信、截止後才交
function checkText(g, rec, config) {
  const notes = [...g.flags];
  const nQ = rec.mode === 'vocab' ? rec.details.length : rec.total;
  if (nQ > 0 && rec.durationSec >= 0 && rec.durationSec < nQ * 1.2) notes.push('作答時間過短');
  const ig = rec.integrity;
  if (ig) {
    if (ig.away) notes.push(`離開作答畫面 ${ig.away} 次（共 ${ig.awaySec} 秒）`);
    if (ig.translate) notes.push(`偵測到翻譯工具 ${ig.translate} 次`);
    if (ig.paste) notes.push(`試圖貼上 ${ig.paste} 次`);
  }
  const u = (config && config.units && config.units[rec.unit]) || {};
  const tw = (s) => (s ? Date.parse(`${s}:00+08:00`) : NaN);
  let close = tw(u.closeAt);
  const ext = tw(config && config.ext && config.ext[rec.unit] && config.ext[rec.unit][`${rec.cls}-${rec.seat}`]);
  if (!Number.isNaN(ext) && !(ext <= close)) close = ext;
  if (!rec.review && !Number.isNaN(close) && Date.now() > close + 10 * 60 * 1000) notes.push('截止後才交卷');
  return notes.join('；');
}

// 確認是名單上的學生：回傳 { cls, seat, name, unit, key, vault }，不是就回傳錯誤（{ code, error }）
async function whoIs(d) {
  const cls = clean(d.cls, 8), seat = clean(d.seat, 4), name = clean(d.name, 40), unit = clean(d.unit, 60), key = clean(d.key, 64);
  if (!/^\d{3,4}$/.test(cls) || !/^\d{1,2}$/.test(seat) || !name || !unit) return { code: 400, error: '資料不完整' };
  if (!/^[0-9a-f]{64}$/.test(key) || key !== studentKey(cls, seat, name)) return { code: 403, error: '不在名單上' };
  const vault = await db.doc(`vault/${key}`).get();
  if (!vault.exists || String(vault.get('cls')) !== cls || String(vault.get('seat')) !== seat) return { code: 403, error: '不在名單上' };
  return { cls, seat, name, unit, key, vault };
}

async function handleOp(d, res) {
  const who = await whoIs(d);
  if (who.error) return reply(res, who.code, { ok: false, error: who.error });
  const content = await contentJson(who.unit);
  if (!content || !content.data) return reply(res, 404, { ok: false, error: '找不到這個單元的題目' });
  if (d.op === 'key') {
    // 交過這個單元（正式測驗或複習都算）才給答案
    const done = await db.collection(`vault/${who.key}/attempts`).where('unit', '==', who.unit).limit(1).get();
    if (done.empty) return reply(res, 403, { ok: false, error: '交卷後才能看答案' });
    return reply(res, 200, { ok: true, v: content.v, data: content.data });
  }
  // op: 'answer'：句型練習正式測驗的一題
  const session = clean(d.session, 64), qid = clean(d.qid, 20), yours = clean(d.yours, 600);
  if (!/^[\w-]{6,64}$/.test(session)) return reply(res, 400, { ok: false, error: '資料不完整' });
  const q = flattenPattern(content.data.items).find((x) => x.id === qid);
  if (!q) return reply(res, 404, { ok: false, error: '題庫裡找不到這一題（題目可能更新了，請重新整理）' });
  const ref = db.doc(`vault/${who.key}/sessions/${session}`);
  const got = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const answers = (snap.exists && snap.get('answers')) || {};
    if (answers[qid]) return answers[qid].got; // 已經作答過：維持第一次的結果
    if (snap.exists && snap.get('submitted')) return null;
    if (Object.keys(answers).length >= 150) return null;
    const g = q.kind === 'apply' ? applyScore(q, yours) : (judge(q, yours) ? 1 : 0);
    answers[qid] = { yours, got: g, at: Date.now() };
    tx.set(ref, { unit: who.unit, answers, createdAt: (snap.exists && snap.get('createdAt')) || Date.now() });
    return g;
  });
  if (got == null) return reply(res, 409, { ok: false, error: '這次測驗已經交卷' });
  return reply(res, 200, { ok: true, got, q });
}

const reply = (res, code, body) => { res.status(code).set('Cache-Control', 'no-store').json(body); };

export const submit = onRequest({ region: 'asia-east1', cors: ORIGINS, maxInstances: 20, concurrency: 40, timeoutSeconds: 60, memory: '256MiB' }, async (req, res) => {
  try {
    if (req.method === 'GET') {
      const id = clean(req.query.check, 64), key = clean(req.query.key, 64);
      if (!/^[\w-]{6,64}$/.test(id) || !/^[0-9a-f]{64}$/.test(key)) return reply(res, 200, { ok: true });
      const seen = (await db.doc(`vault/${key}/attempts/${id}`).get()).exists;
      return reply(res, 200, { ok: true, seen });
    }
    if (req.method !== 'POST') return reply(res, 405, { ok: false, error: 'method' });
    let d = req.body;
    if (typeof d === 'string' || Buffer.isBuffer(d)) { try { d = JSON.parse(String(d)); } catch { d = null; } }
    if (!d || typeof d !== 'object') return reply(res, 400, { ok: false, error: '資料格式不對' });
    if (d.op === 'key' || d.op === 'answer') return await handleOp(d, res);

    const cls = clean(d.cls, 8), seat = clean(d.seat, 4), name = clean(d.name, 40), unit = clean(d.unit, 60);
    const attemptId = clean(d.attemptId, 64), key = clean(d.key, 64), mode = clean(d.mode, 30);
    if (!/^\d{3,4}$/.test(cls) || !/^\d{1,2}$/.test(seat) || !name || !unit || !/^[\w-]{6,64}$/.test(attemptId) || !MODES.includes(mode)) return reply(res, 400, { ok: false, error: '資料不完整' });
    if (!/^[0-9a-f]{64}$/.test(key) || key !== studentKey(cls, seat, name)) return reply(res, 403, { ok: false, error: '不在名單上' });
    const vault = await db.doc(`vault/${key}`).get();
    if (!vault.exists || String(vault.get('cls')) !== cls || String(vault.get('seat')) !== seat) return reply(res, 403, { ok: false, error: '不在名單上' });

    const classRef = db.doc(`classes/${cls}/seats/${seat}/units/${unit}/attempts/${attemptId}`);
    const vaultRef = db.doc(`vault/${key}/attempts/${attemptId}`);
    const old = await classRef.get();
    if (old.exists) {
      const c0 = mode === 'vocab' ? null : await contentJson(unit);
      return reply(res, 200, { ok: true, duplicate: true, score: old.get('score'), total: old.get('total'), pct: old.get('pct'), details: old.get('details'), ...(c0 && c0.data ? { data: c0.data, v: c0.v } : {}) });
    }

    // 限頻：超過就回「忙碌」，學生端留在排隊清單稍後重送（不會丟掉）
    const rateRef = db.doc(`vault/${key}/meta/rate`);
    const allowed = await db.runTransaction(async (tx) => {
      const r = await tx.get(rateRef);
      const now = Date.now();
      const t = r.exists ? Number(r.get('t')) || 0 : 0;
      const n = r.exists ? Number(r.get('n')) || 0 : 0;
      if (now - t > RATE_WINDOW_MS) { tx.set(rateRef, { t: now, n: 1 }); return true; }
      if (n >= RATE_MAX) return false;
      tx.set(rateRef, { t, n: n + 1 });
      return true;
    });
    if (!allowed) return reply(res, 429, { ok: false, busy: true, error: 'rate' });

    const [config, content] = await Promise.all([publicJson('config'), contentJson(unit)]);
    if (!content || !content.data) return reply(res, 404, { ok: false, error: '找不到這個單元的題目' });
    // 句型練習的正式測驗：每題作答時伺服器已經記下答案（第一次作答就鎖定），計分一律用伺服器的紀錄
    let sessionNote = '';
    if (mode === 'pattern') {
      const ses = await db.doc(`vault/${key}/sessions/${attemptId}`).get();
      if (ses.exists) {
        const answers = ses.get('answers') || {};
        const seen = new Set();
        d.details = (Array.isArray(d.details) ? d.details : []).map((x) => { seen.add(String(x.word)); return { ...x, yours: answers[x.word] ? answers[x.word].yours : '' }; });
        Object.entries(answers).forEach(([qid, a]) => { if (!seen.has(qid)) d.details.push({ word: qid, yours: a.yours }); });
        const others = await db.collection(`vault/${key}/sessions`).where('unit', '==', unit).get();
        const open = others.docs.filter((x) => x.id !== attemptId && !x.get('submitted') && Object.keys(x.get('answers') || {}).length).length;
        if (open) sessionNote = `另有 ${open} 次沒交卷的作答（可能先看過部分答案）`;
        await ses.ref.update({ submitted: true });
      } else if (!d.review) sessionNote = '沒有逐題作答紀錄（舊版網頁或連線問題）';
    }
    const g = gradeSubmission(d, content.data, config || {});
    if (g && sessionNote) g.flags.push(sessionNote);
    if (!g) return reply(res, 400, { ok: false, error: '題型與題庫不符' });

    const rec = {
      cls, seat, unit, attemptId, key, name: clean(vault.get('name') || name, 40),
      unitTitle: clean(d.unitTitle, 80), level: clean(d.level, 40), mode, review: !!d.review,
      score: g.score, total: g.total, pct: num(g.pct, 0, 100),
      basic: clean(g.basic ?? d.basic, 12), advanced: clean(g.advanced ?? d.advanced, 12), mastery: clean(g.mastery ?? d.mastery, 12),
      wrong: (g.wrong || []).slice(0, 60).map((w) => clean(w, 60)),
      durationSec: Math.round(num(d.durationSec, 0, 86400)), clientTs: clean(d.clientTs, 30),
      details: cleanDetails(g.details),
      serverGraded: true,
      createdAt: FieldValue.serverTimestamp(),
    };
    const marks = cleanMarks(d.marks);
    if (marks && marks.length) rec.marks = marks;
    const ig = cleanIntegrity(d.integrity);
    if (ig) rec.integrity = ig;
    rec.check = checkText(g, rec, config);

    const batch = db.batch();
    batch.create(classRef, rec);
    batch.create(vaultRef, rec);
    try { await batch.commit(); } catch (e) {
      if (e && e.code === 6) return reply(res, 200, { ok: true, duplicate: true }); // 同時送了兩次：另一次已經寫入
      throw e;
    }

    // 轉送 Apps Script（試算表馬上有）：最多等 3 秒；沒等到或失敗都沒關係，Apps Script 每 10 分鐘會從 Firestore 補同步
    try {
      const secret = await fnSecret();
      if (secret) {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 3000); // 不等試算表整理完：Apps Script 收到後會自己做完，學生不用多等
        const { createdAt, ...plain } = rec; // eslint-disable-line no-unused-vars
        await fetch(SCRIPT_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ ...plain, sig: secret, serverCheck: rec.check }), signal: ctrl.signal, redirect: 'follow' })
          .then((r) => r.text()).catch(() => '').finally(() => clearTimeout(timer));
      }
    } catch { /* 交給定時同步 */ }

    // 課文理解、句型練習：交卷後才把完整題目（答案、解析）給學生檢討
    const full = mode === 'vocab' ? null : content.data;
    return reply(res, 200, { ok: true, score: rec.score, total: rec.total, pct: rec.pct, details: rec.details, ...(full ? { data: full, v: content.v } : {}) });
  } catch (err) {
    console.error('submit 失敗', err);
    return reply(res, 503, { ok: false, busy: true, error: 'busy' }); // 暫時出錯：學生端稍後重送
  }
});
