// 試題名稱：L1 單字片語／課文理解／基本句型；段考是 MIDTERM | 段考複習 或 FINAL | 段考複習
import assert from 'node:assert/strict';
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.window = globalThis;
const { unitName, examKind } = await import('../../js/types.js');

assert.equal(unitName({ lesson: 1, type: 'vocab', title: 'Lesson 1 單字' }), 'L1 單字片語');
assert.equal(unitName({ lesson: 2, type: 'reading', title: 'x' }), 'L2 課文理解');
assert.equal(unitName({ lesson: 3, type: 'pattern', title: 'x' }), 'L3 基本句型');
assert.equal(unitName({ lesson: 1, type: 'weird' }), 'L1 單字片語', '不認得的種類當單字片語');

assert.equal(unitName({ lesson: 1, type: 'exam', title: 'Midterm 1' }), 'MIDTERM | 段考複習');
assert.equal(unitName({ lesson: 1, type: 'exam', title: '第一次期中考' }), 'MIDTERM | 段考複習');
assert.equal(unitName({ lesson: 1, type: 'exam', title: 'Final Exam' }), 'FINAL | 段考複習');
assert.equal(unitName({ lesson: 1, type: 'exam', title: '期末複習' }), 'FINAL | 段考複習');
assert.equal(unitName({ lesson: 1, type: 'exam', title: 'x', topic: 'final review' }), 'FINAL | 段考複習', '主題裡寫也算');
assert.equal(unitName({ lesson: 1, type: 'exam', title: 'x', id: 'mid-1' }), 'MIDTERM | 段考複習', '代號裡寫也算');
assert.equal(unitName({ lesson: 1, type: 'exam', title: '段考 1' }), '段考複習', '看不出是期中還是期末就只寫段考複習');
assert.equal(examKind({ title: 'Admin review' }), '', 'admin 之類的字不能被當成 mid');
console.log('試題名稱測試通過');
