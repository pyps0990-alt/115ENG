// 單元類型：單字片語、課文理解、句型練習、段考複習。標籤、圖示與「最佳成績」的欄位名稱統一放這裡。
import { icon } from './icons.js';

// 及格分數：正式測驗總分達這個百分比才算通過；沒通過要補考（重新做正式測驗，直到通過）
export const PASS = 65;

export const TYPES = {
  vocab: { label: '單字片語', tile: '單字片語測驗', best: 'vocab', icon: 'catVocab' },
  reading: { label: '課文理解', tile: '課文理解', best: 'reading', icon: 'catReading' },
  pattern: { label: '基本句型', tile: '基本句型', best: 'pattern', icon: 'catPattern' },
  exam: { label: '段考複習', tile: '段考複習', best: 'exam', icon: 'catExam' },
};
export const typeOf = (t) => (TYPES[t] ? t : 'vocab');
export const typeLabel = (t) => TYPES[typeOf(t)].label;
export const bestKey = (t) => TYPES[typeOf(t)].best;

// 段考是期中還是期末：看單元名稱、主題或代號裡有沒有 midterm／期中、final／期末（老師建立單元時寫在名稱裡就行）
export function examKind(u) {
  const t = `${u.title || ''} ${u.topic || ''} ${u.id || ''}`;
  if (/final|期末/i.test(t)) return 'FINAL';
  if (/midterm|\bmid\b|期中/i.test(t)) return 'MIDTERM';
  return '';
}
// 學生看到的試題名稱：L1 單字片語／L1 課文理解／L1 基本句型；段考是 MIDTERM | 段考複習 或 FINAL | 段考複習
export function unitName(u) {
  const t = typeOf(u.type);
  if (t === 'exam') { const k = examKind(u); return k ? `${k} | 段考複習` : '段考複習'; }
  return `L${u.lesson} ${TYPES[t].label}`;
}
export const typeIcon = (t) => icon[TYPES[typeOf(t)].icon];
