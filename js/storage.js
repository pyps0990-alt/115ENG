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

// 單元建立時間（老師刪掉單元再用同代號重建時會更新）：之前的紀錄都不算
let since = {};
const fresh = (unit, at) => !since[unit] || !at || at >= since[unit];

export const store = {
  setSince(map) { since = map || {}; },

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

  // 第一次正式測驗的逐題作答（檢討用）：{ mode, details }
  first: (unit) => read(`first:${unit}`, null),
  setFirst: (unit, v) => write(`first:${unit}`, v),

  // 第一次正式測驗是否已經檢討完；檢討完才能開始複習
  reviewed: (unit) => read(`reviewed:${unit}`, false),
  setReviewed: (unit) => write(`reviewed:${unit}`, true),

  // 抽題用的「摸彩袋」：每個單元（依分類）一份，抽完全部才重新洗牌補滿，
  // 確保同一位學生在補滿一輪之前，所有單字／片語都會抽到、不會提早重複
  bag: (key) => read(`bag:${key}`, []),
  setBag: (key, arr) => write(`bag:${key}`, arr),

  // 換人登入時清掉上一位學生留在這台裝置的進度（scoresOnly：只清成績，保留錯題本與檢討狀態）
  resetProgress(scoresOnly = false) {
    const re = scoresOnly ? /^b5p:(best|last|done|first):/ : /^b5p:(best|last|done|first|reviewed|wrong|bag):/;
    try {
      Object.keys(localStorage).filter((k) => re.test(k)).forEach((k) => localStorage.removeItem(k));
    } catch { /* ignore */ }
  },

  // 用 Firestore 讀回的紀錄重建本機成績；reviews 是已檢討完的單元 id
  // 以 Firestore 為準：檢討狀態也一起重建（不沿用這台裝置上舊的標記）
  applyHistory(allAttempts, reviews = []) {
    try {
      Object.keys(localStorage).filter((k) => /^b5p:(best|last|done|first|reviewed):/.test(k)).forEach((k) => localStorage.removeItem(k));
    } catch { /* ignore */ }
    reviews.forEach((r) => { if (fresh(r.id, r.at)) this.setReviewed(r.id); });
    const attempts = allAttempts.filter((a) => fresh(a.unit, a.at));
    const firsts = {};
    attempts.forEach((a) => {
      if (!a.unit) return;
      const cur = firsts[a.unit];
      // 優先用正式測驗（非複習）中最早的一次
      const better = !cur || (cur.review && !a.review) || (!!cur.review === !!a.review && String(a.clientTs) < String(cur.clientTs));
      if (better) firsts[a.unit] = a;
    });
    Object.entries(firsts).forEach(([unit, a]) => this.setFirst(unit, { mode: a.mode, details: a.details || [] }));
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

