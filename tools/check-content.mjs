#!/usr/bin/env node
// 內容檢查：node tools/check-content.mjs
// - 課文理解：題目與選項不可照抄文章（與文章連續相同的英文字數 ≥ MAX_COPY 就報錯）
// - 單字片語：例句必須用 [ ] 標出目標字、不可重複、每單元至少 4 筆
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), '..');
const MAX_COPY = 6;
const read = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, 'data/lessons', f), 'utf8'));
const words = (s) => String(s).toLowerCase().replace(/[“”"]/g, ' ').match(/[a-z0-9']+/g) || [];

function longestShared(a, b) {
  let best = 0; let at = -1;
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) {
      let k = 0;
      while (a[i + k] && a[i + k] === b[j + k]) k++;
      if (k > best) { best = k; at = i; }
    }
  }
  return { n: best, text: at >= 0 ? a.slice(at, at + best).join(' ') : '' };
}

const errors = [];
const warns = [];
const index = read('index.json');

for (const u of index.units) {
  const d = read(`${u.id}.json`);
  if (u.type === 'reading') {
    const passage = words((d.passage || []).join(' '));
    (d.questions || []).forEach((q, i) => {
      const tag = `${u.id} Q${i + 1}`;
      if (!Array.isArray(q.options) || q.options.length < 2) errors.push(`${tag}: 選項不足`);
      if (!(q.answer >= 0 && q.answer < q.options.length)) errors.push(`${tag}: answer 超出範圍`);
      if (!q.explain) warns.push(`${tag}: 沒有詳解`);
      [['題目', q.q], ...q.options.map((o, j) => [`選項 ${'ABCDE'[j]}`, o])].forEach(([label, text]) => {
        const s = longestShared(words(text), passage);
        if (s.n >= MAX_COPY) errors.push(`${tag} ${label} 照抄文章 ${s.n} 個字：「${s.text}」`);
        else if (s.n >= MAX_COPY - 1) warns.push(`${tag} ${label} 與文章連續相同 ${s.n} 個字：「${s.text}」`);
      });
    });
    if (u.count !== (d.questions || []).length) warns.push(`${u.id}: index.json 的 count (${u.count}) 與題數 (${d.questions.length}) 不同`);
  } else {
    const list = d.words || [];
    const seen = new Set(); const seenZh = new Set();
    list.forEach((w) => {
      if (!/\[[^\]]+\]/.test(w.example || '')) errors.push(`${u.id} ${w.word}: 例句沒有用 [ ] 標出目標字`);
      if (seen.has(w.word.toLowerCase())) errors.push(`${u.id} ${w.word}: 重複`);
      if (seenZh.has(w.zh)) warns.push(`${u.id} ${w.word}: 中文意思與其他字重複（選擇題可能出現兩個一樣的選項）`);
      seen.add(w.word.toLowerCase()); seenZh.add(w.zh);
      if (!['word', 'phrase'].includes(w.type || 'word')) errors.push(`${u.id} ${w.word}: type 必須是 word 或 phrase`);
    });
    if (list.length < 4) errors.push(`${u.id}: 至少需要 4 個單字片語才能出選擇題`);
    if (u.count !== list.length) warns.push(`${u.id}: index.json 的 count (${u.count}) 與實際筆數 (${list.length}) 不同`);
  }
}

warns.forEach((w) => console.log(`⚠  ${w}`));
errors.forEach((e) => console.log(`✗  ${e}`));
console.log(errors.length ? `\n${errors.length} 個錯誤` : `\n✓ 內容檢查通過（${index.units.length} 個單元）`);
process.exit(errors.length ? 1 : 0);
