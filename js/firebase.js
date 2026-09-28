// Firestore：學生基本資料 + 成績另外存一份，避免只靠這台裝置的 localStorage。
// 用固定的文件 ID（班級+座號 / attemptId）取代自動產生的 ID，
// 這樣同一個學生、同一次測驗重複寫入只會覆蓋同一筆，不會產生重複紀錄。
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

const studentDocId = (cls, seat) => `${String(cls).trim()}-${String(seat).trim()}`;

// 班級+座號當文件 ID：同一個學生重複填寫基本資料只會更新同一筆
export async function saveStudentProfile(s) {
  if (!s || !s.cls || !s.seat) return;
  try {
    const db = await getDb();
    await setDoc(doc(db, 'students', studentDocId(s.cls, s.seat)), {
      cls: String(s.cls).trim(),
      seat: String(s.seat).trim(),
      name: String(s.name || '').trim(),
      updatedAt: serverTimestamp(),
    }, { merge: true });
  } catch (err) {
    console.warn('Firestore 學生資料寫入失敗（不影響測驗與送出老師試算表）', err);
  }
}

// attemptId 當文件 ID：離線補送、重複送出都只會覆蓋同一筆，不會出現重複紀錄
export async function saveScoreToFirestore(payload) {
  if (!payload || !payload.attemptId) return;
  try {
    const db = await getDb();
    await setDoc(doc(db, 'scores', String(payload.attemptId)), {
      cls: String(payload.cls || ''),
      seat: String(payload.seat || ''),
      name: String(payload.name || ''),
      unit: String(payload.unit || ''),
      unitTitle: String(payload.unitTitle || ''),
      level: String(payload.level || ''),
      mode: String(payload.mode || ''),
      score: Number(payload.score) || 0,
      total: Number(payload.total) || 0,
      pct: Number(payload.pct) || 0,
      basic: payload.basic == null ? null : String(payload.basic),
      advanced: payload.advanced == null ? null : String(payload.advanced),
      mastery: payload.mastery == null ? null : String(payload.mastery),
      wrong: Array.isArray(payload.wrong) ? payload.wrong : [],
      durationSec: Number(payload.durationSec) || 0,
      attemptId: String(payload.attemptId),
      clientTs: payload.clientTs || null,
      createdAt: serverTimestamp(),
    }, { merge: true });
  } catch (err) {
    console.warn('Firestore 成績寫入失敗（不影響送到老師試算表）', err);
  }
}
