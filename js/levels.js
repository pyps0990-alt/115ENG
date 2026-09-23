// 單字片語測驗的三個階段：同一組單字依序連續作答，題型越來越難
import { sample, shuffle } from './util.js';
import { buildMC, buildClozeMC, buildSpell } from './components/question.js';

export const PASS = 80;

export const LEVELS = [
  {
    id: 'basic', name: '基礎', en: 'Basic',
    desc: '看英文，選出中文意思',
    items: ['英 → 中 四選一', '可以聽發音'],
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
    items: ['看中文拼出英文', '例句填空拼寫', '提示每次扣 0.25 分'],
    build: (words) => words.map((w, i) => buildSpell(w, i % 2 ? 'cloze' : 'spell')),
  },
];

export const levelById = (id) => LEVELS.find((l) => l.id === id);

// 抽題時讓單字與片語都有機會出現
export function pickWords(all, n) {
  const phrases = all.filter((w) => w.type === 'phrase');
  const singles = all.filter((w) => w.type !== 'phrase');
  if (!phrases.length || !singles.length) return sample(all, n);
  const nPhrase = Math.min(phrases.length, Math.max(1, Math.round((n * phrases.length) / all.length)));
  return shuffle([...sample(phrases, nPhrase), ...sample(singles, n - nPhrase)]);
}
