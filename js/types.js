// 單元類型：單字片語、課文理解、句型練習。標籤、圖示與「最佳成績」的欄位名稱統一放這裡。
import { icon } from './icons.js';

// 及格分數：正式測驗總分達這個百分比才算通過；沒通過要補考（重新做正式測驗，直到通過）
export const PASS = 65;

export const TYPES = {
  vocab: { label: '單字片語', tile: '單字片語測驗', best: 'vocab', icon: 'catVocab' },
  reading: { label: '課文理解', tile: '課文理解', best: 'reading', icon: 'catReading' },
  pattern: { label: '句型練習', tile: '句型練習', best: 'pattern', icon: 'catPattern' },
};
export const typeOf = (t) => (TYPES[t] ? t : 'vocab');
export const typeLabel = (t) => TYPES[typeOf(t)].label;
export const bestKey = (t) => TYPES[typeOf(t)].best;

// 課次可以填數字或英文：1、2、3… 顯示成 L1、L2、L3…；填英文（例如 R-X）就照原樣顯示。排序：數字由小到大，英文排在後面
// 只留英文字母、數字、連字號、底線與空格（不能用中文）；清掉之後什麼都不剩就當第 1 課
export function normLesson(v) {
  const t = String(v == null ? '' : v).replace(/[^A-Za-z0-9 _-]/g, '').trim();
  if (!t) return 1;
  return /^\d+$/.test(t) ? Math.min(99, Number(t)) : t.slice(0, 20);
}
export const lessonLabel = (l) => (typeof l === 'number' ? `L${l}` : String(l));
// 單元全名「課次 標題」；標題本來就以課次開頭（例如課次 L3、標題「L3單字片語」或課次 1-2、標題「L1-2…」）就不再重複課次
export const unitName = (u) => {
  const label = lessonLabel(u.lesson);
  const title = String(u.title || '').trim();
  const norm = (x) => x.replace(/\s+/g, '').toLowerCase();
  const t = norm(title), l = norm(label);
  // 課次後面接數字就不算（課次 1、標題「L10…」是不同課）
  const has = (p) => t.startsWith(p) && !/^[0-9]/.test(t.slice(p.length));
  return !title ? label : has(l) || has('l' + l) ? title : `${label} ${title}`;
};
export const lessonCmp = (a, b) => (typeof a === 'number' && typeof b === 'number' ? a - b
  : typeof a === 'number' ? -1 : typeof b === 'number' ? 1
    : String(a).localeCompare(String(b), 'zh-Hant', { numeric: true }));

export const typeIcon = (t) => icon[TYPES[typeOf(t)].icon];
