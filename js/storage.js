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

  // 最近一次單字片語測驗的三段百分比：{ basic, advanced, mastery }
  last: (unit) => read(`last:${unit}`, null),
  setLast: (unit, v) => write(`last:${unit}`, v),

  // 最佳成績（百分比）
  best: (unit) => read(`best:${unit}`, {}),
  setBest(unit, mode, pct) {
    const b = this.best(unit);
    if (!(mode in b) || pct > b[mode]) { b[mode] = pct; write(`best:${unit}`, b); return true; }
    return false;
  },

  // 已經做過正式測驗的單元，之後改成「複習」
  done: (unit) => read(`done:${unit}`, false),
  setDone: (unit) => write(`done:${unit}`, true),

  // 換人登入時清掉上一位學生留在這台裝置的進度（scoresOnly：只清成績，保留錯題本）
  resetProgress(scoresOnly = false) {
    const re = scoresOnly ? /^b5p:(best|last|done):/ : /^b5p:(best|last|done|wrong):/;
    try {
      Object.keys(localStorage).filter((k) => re.test(k)).forEach((k) => localStorage.removeItem(k));
    } catch { /* ignore */ }
  },

  // 用 Firestore 讀回的紀錄重建本機成績
  applyHistory(attempts) {
    this.resetProgress(true);
    const pctOf = (s) => {
      const m = /^'?(\d+(?:\.\d+)?)\s*\/\s*(\d+)/.exec(String(s || ''));
      return m && Number(m[2]) ? Math.round((Number(m[1]) / Number(m[2])) * 100) : null;
    };
    const latest = {};
    attempts.forEach((a) => {
      if (!a.unit) return;
      const mode = a.mode === 'reading' ? 'reading' : 'vocab';
      this.setBest(a.unit, mode, Number(a.pct) || 0);
      this.setDone(a.unit);
      if (mode === 'vocab' && (!latest[a.unit] || String(a.clientTs) > String(latest[a.unit].clientTs))) latest[a.unit] = a;
    });
    Object.entries(latest).forEach(([unit, a]) => {
      const last = {};
      ['basic', 'advanced', 'mastery'].forEach((k) => { const p = pctOf(a[k]); if (p != null) last[k] = p; });
      this.setLast(unit, last);
    });
  },
};

