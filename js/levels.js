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
    desc: '看例句的意思，選出空格裡的字詞',
    items: ['例句填空四選一（含詞形變化）'],
    // 全部考例句選字（例句沒有用 [ ] 標出要考的字時，才退回中翻英）
    build: (words, pool, ctx = {}) => words.map((w) => buildClozeMC(w, pool, ctx.analysis, ctx.pickEx)),
  },
  {
    id: 'mastery', name: '精熟', en: 'Mastery',
    desc: '沒有選項，自己拼出單字或片語，題型隨機出現',
    items: ['看中文拼出英文', '例句填空拼寫', '提示最多 2 次：第 1 次扣 1 分，第 2 次再扣 3 分'],
    build: (words, pool, ctx = {}) => words.map((w) => buildSpell(w, Math.random() < 0.5 ? 'cloze' : 'spell', ctx.pickEx)),
  },
];

// ---------------- 出題設定（老師後台每個單字單元可以自訂） ----------------
// 五種題型；單元設定的 quiz（JSON 字串）：
//   沒有設定 → 預設三段（上面的 LEVELS，老師關掉的段落不考）
//   { mode: 'auto', types: [...] } → 依勾選的題型自動分段：選擇（英↔中）→ 例句選字 → 拼寫，沒勾的那段不出
//   { mode: 'custom', stages: [{ name, types: [...] }, ...] } → 老師逐段指定（最多 3 段，對應成績表的三段欄位）
// 段落代號固定用 basic／advanced／mastery（第 1／2／3 段），成績表三段的欄位不用改
export const QUIZ_TYPES = {
  en2zh: { name: '英→中選擇', build: (w, pool) => buildMC(w, pool, 'en2zh') },
  zh2en: { name: '中→英選擇', build: (w, pool) => buildMC(w, pool, 'zh2en') },
  cloze: { name: '例句選字', build: (w, pool, ctx) => buildClozeMC(w, pool, ctx.analysis, ctx.pickEx) },
  spell: { name: '看中文拼字', build: (w, pool, ctx) => buildSpell(w, 'spell', ctx.pickEx) },
  clozeSpell: { name: '例句拼寫', build: (w, pool, ctx) => buildSpell(w, 'cloze', ctx.pickEx) },
};
const STAGE_IDS = ['basic', 'advanced', 'mastery'];
const AUTO_GROUPS = [
  { id: 'basic', name: '基礎', en: 'Basic', types: ['en2zh', 'zh2en'] },
  { id: 'advanced', name: '進階', en: 'Advanced', types: ['cloze'] },
  { id: 'mastery', name: '精熟', en: 'Mastery', types: ['spell', 'clozeSpell'] },
];
const validTypes = (list) => [...new Set((Array.isArray(list) ? list : []).filter((t) => QUIZ_TYPES[t]))];

export function parseQuiz(raw) {
  let q = raw;
  if (typeof raw === 'string') { try { q = raw.trim() ? JSON.parse(raw) : null; } catch { q = null; } }
  if (!q || typeof q !== 'object') return null;
  if (q.mode === 'auto') { const types = validTypes(q.types); return types.length ? { mode: 'auto', types } : null; }
  if (q.mode === 'custom') {
    const stages = (Array.isArray(q.stages) ? q.stages : []).map((s) => ({ name: String((s && s.name) || '').trim().slice(0, 8), types: validTypes(s && s.types) }))
      .filter((s) => s.types.length).slice(0, 3);
    return stages.length ? { mode: 'custom', stages } : null;
  }
  return null;
}

function makeLevel(id, name, en, types) {
  const names = types.map((t) => QUIZ_TYPES[t].name);
  const spells = types.some((t) => t === 'spell' || t === 'clozeSpell');
  return {
    id, name, en, types,
    desc: names.length > 1 ? `${names.join('、')}，題型隨機出現` : names[0],
    items: [...names, ...(spells ? ['提示最多 2 次：第 1 次扣 1 分，第 2 次再扣 3 分'] : [])],
    build: (words, pool, ctx = {}) => words.map((w) => QUIZ_TYPES[types[Math.floor(Math.random() * types.length)]].build(w, pool, ctx)),
  };
}

// 這個單元要考的段落：unit 是 remote-config 的單元設定（{ disabled, quiz }）
export function levelsFor(unit = {}) {
  const q = parseQuiz(unit.quiz);
  if (!q) return LEVELS.filter((l) => !(unit.disabled || []).includes(l.id));
  if (q.mode === 'auto') {
    return AUTO_GROUPS.map((g) => ({ ...g, types: g.types.filter((t) => q.types.includes(t)) }))
      .filter((g) => g.types.length).map((g) => makeLevel(g.id, g.name, g.en, g.types));
  }
  return q.stages.map((s, i) => makeLevel(STAGE_IDS[i], s.name || `第 ${i + 1} 段`, `Part ${i + 1}`, s.types));
}

// 把整個單元的單字與片語分配到各個階段：每個字在一次測驗裡剛好考一次（全部考到）。
// 各段題數 = 總數平均分配（多出來的給前面的階段），片語平均分散在各段，不會集中在同一段。
// 之後每次複習都會換一批：上一次在第 k 段的字，這次一定改到別段（整組輪替），
// 所以每次複習每個字的題型都不同。分配紀錄存在這台裝置上（每位學生、每個單元各一份）。
// 一次測驗最多考幾個字。單元超過這個數量時每次抽題：上次（這一輪）還沒考到的字優先，單字與片語照比例抽；
// 全部字都輪過一次後，從頭開始新的一輪。抽題紀錄存在這台裝置（每位學生、每個單元一份），老師重製單元時一併清掉。
export const PER_TEST = 30;

// 計分：整份測驗滿分 100 分，每個階段（大題）平均分配（三段各 33.3 分），段內每題同分。
// 拼字題用提示要扣分（以 100 分計）：第 1 次扣 1 分、第 2 次再扣 3 分（共扣 4 分），扣到 0 為止。
export const HINT_PENALTY = [1, 3];
export const hintDeduction = (hints) => HINT_PENALTY.slice(0, hints).reduce((a, b) => a + b, 0);

// 依每題對錯與提示次數算分（以 100 分計）：每題的 points 改成這題實際拿到的分數。
// 回傳 { total: 總分（未四捨五入）, stages: [各段得分], max: 每段滿分 }；details 會就地改寫 points
export function weigh(stages, details) {
  const k = stages.length || 1;
  const max = 100 / k;
  const sums = stages.map(() => 0);
  stages.forEach((s, i) => {
    const per = max / (s.qs.length || 1);
    details.filter((d) => d.stage === s.level.name).forEach((d) => {
      const got = d.ok ? Math.max(0, per - hintDeduction(d.hints || 0)) : 0;
      d.points = Math.round(got * 1000) / 1000;
      sums[i] += got;
    });
  });
  return { total: sums.reduce((a, b) => a + b, 0), stages: sums, max };
}
export function pickWords(all, unitId, n = PER_TEST) {
  if (all.length <= n) return all;
  const key = `${unitId}:seen`;
  const seen = new Set(store.bag(key));
  const take = (pool, k) => [...shuffle(pool.filter((w) => !seen.has(w.word))), ...shuffle(pool.filter((w) => seen.has(w.word)))].slice(0, k);
  const phrases = all.filter((w) => w.type === 'phrase');
  const singles = all.filter((w) => w.type !== 'phrase');
  const nPh = Math.min(phrases.length, Math.round((n * phrases.length) / all.length));
  let pick = [...take(phrases, nPh), ...take(singles, n - nPh)];
  if (pick.length < n) pick = [...pick, ...take(all.filter((w) => !pick.includes(w)), n - pick.length)];
  const after = new Set([...seen, ...pick.map((w) => w.word)]);
  // 這一輪全部考到了：下一輪從這次沒抽到的字開始
  store.setBag(key, all.every((w) => after.has(w.word)) ? pick.map((w) => w.word) : [...after]);
  return pick;
}

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
