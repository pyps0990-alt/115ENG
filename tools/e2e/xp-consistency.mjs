// 解析一致性檢查：用 tools/brain 的真實單元與錯誤分析結果，把每個字、每句例句、每個錯誤選項都出一次題，檢查
//   1. 錯誤類型標籤和學生選的那個選項的原因一致（標籤詞性不合 ⇔ 原因是詞性不合）
//   2. 沒有 undefined／null／空的意思／空的代入（【】）
//   3. 第 2 步排除的選項，詞性真的和空格不合；正確答案一定打勾
//   4. 檢討版：解題步驟在前、答案卡在最後
//   node tools/e2e/xp-consistency.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const Q = await import(pathToFileURL(path.join(root, 'js/components/question.js')));
const brain = path.join(root, 'tools/brain');
const strip = (h) => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
let n = 0;
const fails = [];
for (const name of fs.readdirSync(path.join(brain, 'samples'))) {
  const u = name.replace('.json', '');
  const outPath = path.join(brain, 'out', name);
  if (!fs.existsSync(outPath)) continue;
  const d = JSON.parse(fs.readFileSync(path.join(brain, 'samples', name), 'utf8'));
  const a = JSON.parse(fs.readFileSync(outPath, 'utf8'));
  const words = d.words.map((w) => ({ ...w, example: (w.examples && w.examples[0] && w.examples[0].ex) || w.example, exampleZh: (w.examples && w.examples[0] && w.examples[0].zh) || w.exampleZh }));
  for (const w of words) {
    const nEx = (w.examples || []).filter((e) => e.ex).length || 1;
    for (let k = 0; k < nEx; k++) {
      for (let rep = 0; rep < 4; rep++) {
        const q = Q.buildClozeMC(w, words, a, () => k);
        if (q.dir !== 'cloze') continue;
        for (const wrong of q.options.filter((_, i) => i !== q.answer)) {
          n++;
          const id = `${u}|${w.word}|${k}|${wrong}`;
          const brief = Q.explainWrong(q, wrong, words);
          const rec = { word: w.word, kind: '例句選字', yours: wrong, correct: q.options[q.answer], options: q.options, exIdx: q.exIdx, extras: q.extras,
            exampleEn: `${q.parts.before}[${q.parts.answer}]${q.parts.after}`, exampleZh: q.exampleZh };
          const q2 = Q.questionFromRecord(rec, words, a);
          if (!q2) { fails.push(`${id}: 檢討重建失敗`); continue; }
          const full = Q.explainWrong(q2, wrong, words, 'full');
          const html = brief.html + full.html;
          const text = strip(html);
          for (const bad of ['undefined', 'null', 'NaN', '[object']) if (text.includes(bad)) fails.push(`${id}: 出現 ${bad}`);
          if (/【\s*】/.test(text)) fails.push(`${id}: 代入的意思是空的`);
          if (brief.err !== full.err) fails.push(`${id}: 作答中與檢討的錯誤類型不同 ${brief.err}／${full.err}`);
          const picked = full.html.match(/<li class="op op-picked">[\s\S]*?<p class="op-why why-(\w+)">([^<]*)/);
          if (!picked) fails.push(`${id}: 檢討版找不到學生選的選項`);
          else {
            const kind = picked[1];
            if ((brief.err === '詞性不合') !== (kind === 'pos')) fails.push(`${id}: 標籤「${brief.err}」但原因是「${picked[2]}」`);
          }
          if (!/op op-ok[\s\S]*?✓/.test(full.html)) fails.push(`${id}: 正確答案沒有打勾`);
          if (full.html.indexOf('xp-answer') < full.html.indexOf('op-list')) fails.push(`${id}: 答案卡不在最後`);
          if ((brief.html.match(/class="op[ "]/g) || []).length !== q.options.length) fails.push(`${id}: 作答中的選項數不對`);
          if (/op-zh">\s*</.test(html)) fails.push(`${id}: 有空的意思`);
        }
      }
    }
  }
}
const uniq = [...new Set(fails)];
console.log(`檢查 ${n} 個答錯情境，問題 ${uniq.length} 個`);
uniq.slice(0, 40).forEach((f) => console.log('  ' + f));
process.exit(uniq.length ? 1 : 0);
