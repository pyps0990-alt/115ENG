// 單字片語測驗的三個階段：同一組單字依序連續作答，題型越來越難
import { shuffle } from './util.js';
import { store } from './storage.js';
import { buildMC, buildClozeMC, buildSpell } from './components/question.js';

export { PASS } from './types.js';

export const LEVELS = [
  {
    id: 'basic', name: '基礎', en: 'Basic',
    desc: '英文選中文、或中文選英文，題型隨機出現',
    items: ['英 ↔ 中 四選一（隨機方向）'],
    build: (words, pool) => words.map((w) => buildMC(w, pool, 'mix')),
  },
  {
    id: 'advanced', name: '進階', en: 'Advanced',
    desc: '中文選英文、或例句選字詞，題型隨機出現',
    items: ['中 → 英 四選一', '例句填空四選一（含詞形變化）'],
    // 每個字獨立擲一次骰子決定題型：同一個字這次考例句、下次考中翻英都有可能
    build: (words, pool) => words.map((w) => (Math.random() < 0.5 ? buildClozeMC(w, pool) : buildMC(w, pool, 'zh2en'))),
  },
  {
    id: 'mastery', name: '精熟', en: 'Mastery',
    desc: '沒有選項，自己拼出單字或片語，題型隨機出現',
    items: ['看中文拼出英文', '例句填空拼寫', '提示最多 2 次，每次扣 0.25 分'],
    build: (words) => words.map((w) => buildSpell(w, Math.random() < 0.5 ? 'cloze' : 'spell')),
  },
];

// 把整個單元的單字與片語分配到各個階段：每個字在一次測驗裡剛好考一次（全部考到）。
// 各段題數 = 總數平均分配（多出來的給前面的階段），片語平均分散在各段，不會集中在同一段。
// 之後每次複習都會換一批：上一次在第 k 段的字，這次一定改到別段（整組輪替），
// 所以每次複習每個字的題型都不同。分配紀錄存在這台裝置上（每位學生、每個單元各一份）。
export function stageSizes(total, stages) {
  const base = Math.floor(total / stages);
  const extra = total % stages;
  return Array.from({ length: stages }, (_, i) => base + (i < extra ? 1 : 0));
}

function dealRandom(all, stages) {
  const phrases = shuffle(all.filter((w) => w.type === 'phrase'));
  const singles = shuffle(all.filter((w) => w.type !== 'phrase'));
  const groups = Array.from({ length: stages }, () => []);
  [...phrases, ...singles].forEach((w, i) => groups[i % stages].push(w));
  return groups;
}

export function partitionWords(all, stages, unitId) {
  if (stages <= 1) return [shuffle(all)];
  const key = `${unitId}:stages`;
  const prev = new Map(store.bag(key).map((e) => { const i = e.indexOf('|'); return [e.slice(i + 1), Number(e.slice(0, i))]; }));
  const known = all.filter((w) => prev.has(w.word) && prev.get(w.word) < stages);
  let groups;
  if (known.length >= Math.ceil(all.length / 2)) {
    // 依上次的分配分組，新加的字補到最小的一組，然後整組輪替到別的階段
    const old = Array.from({ length: stages }, () => []);
    known.forEach((w) => old[prev.get(w.word)].push(w));
    all.filter((w) => !known.includes(w)).forEach((w) => { old.sort((x, y) => x.length - y.length)[0].push(w); });
    const byStage = Array.from({ length: stages }, (_, g) => all.filter((w) => old[g].includes(w)));
    const r = 1 + Math.floor(Math.random() * (stages - 1));
    groups = Array.from({ length: stages }, (_, s) => shuffle(byStage[(s + r) % stages]));
  } else {
    groups = dealRandom(all, stages);
  }
  store.setBag(key, groups.flatMap((g, s) => g.map((w) => `${s}|${w.word}`)));
  return groups.map((g) => shuffle(g));
}
