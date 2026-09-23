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
};

