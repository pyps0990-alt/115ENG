// 單字片語測驗的三個階段：同一組單字依序連續作答，題型越來越難
import { shuffle } from './util.js';
import { store } from './storage.js';
import { buildMC, buildClozeMC, buildSpell } from './components/question.js';

export const PASS = 80;

export const LEVELS = [
  {
    id: 'basic', name: '基礎', en: 'Basic',
    desc: '看英文，選出中文意思',
    items: ['英 → 中 四選一'],
    build: (words, pool) => words.map((w) => buildMC(w, pool, 'en2zh')),
  },
  {
    id: 'advanced', name: '進階', en: 'Advanced',
    desc: '看中文選英文，並在例句中選出正確字詞',
    items: ['中 → 英 四選一', '例句填空四選一（含詞形變化）'],
    build: (words, pool) => words.map((w, i) => (i % 2 ? buildClozeMC(w, pool) : buildMC(w, pool, 'zh2en'))),
  },
  {
    id: 'mastery', name: '精熟', en: 'Mastery',
    desc: '沒有選項，自己拼出單字與片語',
    items: ['看中文拼出英文', '例句填空拼寫', '提示最多 2 次，每次扣 0.25 分'],
    build: (words) => words.map((w, i) => buildSpell(w, i % 2 ? 'cloze' : 'spell')),
  },
];

export const levelById = (id) => LEVELS.find((l) => l.id === id);

// 像抽獎袋一樣抽題：同一個袋子抽完（每個字都出現過一次）才重新洗牌補滿，
// 一輪之內不會有字還沒出現、另一個字卻先重複，長期下來每個字被考到的次數會平均。
// bagKey 讓同一位學生、同一個單元有自己的袋子（存在這台裝置上）。
function drawFromBag(bagKey, pool, count) {
  const keys = pool.map((w) => w.word);
  let bag = store.bag(bagKey).filter((k) => keys.includes(k));
  const picked = [];
  while (picked.length < count) {
    if (!bag.length) bag = shuffle(keys);
    picked.push(bag.shift());
  }
  store.setBag(bagKey, bag);
  const byWord = new Map(pool.map((w) => [w.word, w]));
  return picked.map((k) => byWord.get(k)).filter(Boolean);
}

// 抽題時讓單字與片語都有機會出現；unitId 存在時用「摸彩袋」抽法，確保每個字都會輪到
export function pickWords(all, n, unitId) {
  const phrases = all.filter((w) => w.type === 'phrase');
  const singles = all.filter((w) => w.type !== 'phrase');
  if (!unitId) return shuffle(all).slice(0, n); // 沒有單元 id（例如舊版呼叫）時退回單純隨機
  if (!phrases.length || !singles.length) return drawFromBag(`${unitId}:all`, all, n);
  const nPhrase = Math.min(phrases.length, Math.max(1, Math.round((n * phrases.length) / all.length)));
  return shuffle([...drawFromBag(`${unitId}:phrase`, phrases, nPhrase), ...drawFromBag(`${unitId}:single`, singles, n - nPhrase)]);
}
