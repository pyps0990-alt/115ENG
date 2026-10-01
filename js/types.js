// 單元類型：單字片語、課文理解、句型練習、段考複習。標籤、圖示與「最佳成績」的欄位名稱統一放這裡。
import { icon } from './icons.js';

// 及格分數：正式測驗總分達這個百分比才算通過；沒通過要補考（重新做正式測驗，直到通過）
export const PASS = 65;

export const TYPES = {
  vocab: { label: '單字片語', tile: '單字片語測驗', best: 'vocab', icon: 'cards' },
  reading: { label: '課文理解', tile: '課文理解', best: 'reading', icon: 'book' },
  pattern: { label: '句型練習', tile: '句型練習', best: 'pattern', icon: 'pencil' },
  exam: { label: '段考複習', tile: '段考複習', best: 'exam', icon: 'target' },
};
export const typeOf = (t) => (TYPES[t] ? t : 'vocab');
export const typeLabel = (t) => TYPES[typeOf(t)].label;
export const bestKey = (t) => TYPES[typeOf(t)].best;
export const typeIcon = (t) => icon[TYPES[typeOf(t)].icon];
