// 所有 localStorage 存取都包在 try/catch，無痕模式或被封鎖時網站仍可運作（只是不記錄）。
const P = 'b5p:';

function read(key, fallback) {
  try {
    const v = localStorage.getItem(P + key);
    return v == null ? fallback : JSON.parse(v);
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(P + key, JSON.stringify(value));
  } catch { /* ignore */ }
}

export const store = {
  student: () => read('student', null),
  setStudent: (s) => write('student', s),

  theme: () => read('theme', null),
  setTheme: (t) => write('theme', t),

  pref: (k, d) => read(`pref:${k}`, d),
  setPref: (k, v) => write(`pref:${k}`, v),

  // 熟悉度：{ word: 1 (熟悉) | 0 (不熟) }
  known: (unit) => read(`known:${unit}`, {}),
  setKnown(unit, word, val) {
    const m = this.known(unit);
    if (val == null) delete m[word]; else m[word] = val;
    write(`known:${unit}`, m);
    if (val === 1) this.removeWrong(unit, word);
  },

  // 錯題本
  wrong: (unit) => read(`wrong:${unit}`, []),
  addWrong(unit, word) {
    const w = this.wrong(unit);
    if (!w.includes(word)) { w.push(word); write(`wrong:${unit}`, w); }
  },
  removeWrong(unit, word) {
    write(`wrong:${unit}`, this.wrong(unit).filter((x) => x !== word));
  },

  // 最佳成績（百分比）
  best: (unit) => read(`best:${unit}`, {}),
  setBest(unit, mode, pct) {
    const b = this.best(unit);
    if (!(mode in b) || pct > b[mode]) { b[mode] = pct; write(`best:${unit}`, b); return true; }
    return false;
  },
  bestTime: (unit) => read(`bestTime:${unit}`, null),
  setBestTime(unit, ms) {
    const cur = this.bestTime(unit);
    if (cur == null || ms < cur) { write(`bestTime:${unit}`, ms); return true; }
    return false;
  },
};

export function weakWords(unitId, words) {
  const k = store.known(unitId);
  const w = new Set(store.wrong(unitId));
  return words.filter((x) => k[x.word] === 0 || w.has(x.word));
}
