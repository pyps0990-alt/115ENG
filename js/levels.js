// 單字片語測驗的三個階段：同一組單字依序連續作答，題型越來越難
import { shuffle } from './util.js';
import { store } from './storage.js';
import { buildMC, buildClozeMC, buildSpell } from './components/question.js';

export const PASS = 80;

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
