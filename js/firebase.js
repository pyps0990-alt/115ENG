// Firestore：學生基本資料 + 成績另外存一份，避免只靠這台裝置的 localStorage。
// 資料結構：班級 > 座號 > 單元 > 每次測驗的作答細項（歷史紀錄，不覆蓋）
//   classes/{cls}/seats/{seat}                                 學生基本資料
//   classes/{cls}/seats/{seat}/units/{unitId}/attempts/{attemptId}  每次測驗成績＋逐題明細
// attemptId 當文件 ID：同一次測驗重複送出只會嘗試覆蓋同一筆，Firestore 規則不允許更新歷史紀錄，
// 所以效果等同「擋掉重複」，不會佔用容量；不同次測驗會各自累積成一筆新紀錄。
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js';
import {
  getFirestore, doc, setDoc, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js';

const firebaseConfig = {
  apiKey: 'AIzaSyC0HFF3YjrsONdvYwTrofihkqNGiQjjdyc',
  authDomain: 'eng-3385e.firebaseapp.com',
  projectId: 'eng-3385e',
  storageBucket: 'eng-3385e.firebasestorage.app',
  messagingSenderId: '396514115433',
  appId: '1:396514115433:web:2bbe5d62c272bb69fa87f8',
};

let dbPromise = null;
function getDb() {
  if (!dbPromise) {
    dbPromise = Promise.resolve().then(() => getFirestore(initializeApp(firebaseConfig)));
  }
  return dbPromise;
}

const clean = (s, max) => String(s == null ? '' : s).trim().slice(0, max);

// 班級+座號當文件 ID：同一個學生重複填寫基本資料只會更新同一筆
export async function saveStudentProfile(s) {
  if (!s || !s.cls || !s.seat) return;
  const cls = clean(s.cls, 8);
  const seat = clean(s.seat, 4);
  if (!cls || !seat) return;
  try {
    const db = await getDb();
    await setDoc(doc(db, 'classes', cls, 'seats', seat), {
      cls, seat, name: clean(s.name, 40), updatedAt: serverTimestamp(),
    }, { merge: true });
  } catch (err) {
    console.warn('Firestore 學生資料寫入失敗（不影響測驗與送出老師試算表）', err);
  }
}

// 每題作答細項的欄位跟 Google 試算表 details 分頁一樣：段落、題型、題號、題目、正確答案、學生答案、對錯、得分、提示次數
function cleanDetails(list) {
  if (!Array.isArray(list)) return [];
  return list.slice(0, 150).map((x) => ({
    stage: clean(x.stage, 20),
    kind: clean(x.kind, 20),
    n: Number(x.n) || 0,
    question: clean(x.q, 300),
    correct: clean(x.correct, 200),
    yours: clean(x.yours, 200),
    ok: !!x.ok,
    points: Number(x.points) || 0,
    hints: Number(x.hints) || 0,
  }));
}

export async function saveScoreToFirestore(payload) {
  if (!payload || !payload.attemptId || !payload.cls || !payload.seat || !payload.unit) return;
  const cls = clean(payload.cls, 8);
  const seat = clean(payload.seat, 4);
  const unit = clean(payload.unit, 60);
  const attemptId = clean(payload.attemptId, 64);
  if (!cls || !seat || !unit || !attemptId) return;
  try {
    const db = await getDb();
    const ref = doc(db, 'classes', cls, 'seats', seat, 'units', unit, 'attempts', attemptId);
    await setDoc(ref, {
      cls, seat, unit, attemptId,
      name: clean(payload.name, 40),
      unitTitle: clean(payload.unitTitle, 80),
      level: clean(payload.level, 20),
      mode: clean(payload.mode, 30),
      score: Number(payload.score) || 0,
      total: Number(payload.total) || 0,
      pct: Number(payload.pct) || 0,
      basic: payload.basic == null ? '' : clean(payload.basic, 12),
      advanced: payload.advanced == null ? '' : clean(payload.advanced, 12),
      mastery: payload.mastery == null ? '' : clean(payload.mastery, 12),
      wrong: Array.isArray(payload.wrong) ? payload.wrong.slice(0, 60).map((w) => clean(w, 60)) : [],
      durationSec: Number(payload.durationSec) || 0,
      clientTs: payload.clientTs ? clean(payload.clientTs, 30) : null,
      details: cleanDetails(payload.details),
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    console.warn('Firestore 成績寫入失敗（不影響送到老師試算表）', err);
  }
}
