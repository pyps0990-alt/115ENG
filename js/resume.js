// 測驗做到一半先存在這台裝置：手機來電、分頁被系統回收、重新整理之後，可以從測驗前說明卡按「繼續上次」接著做。
// 只在這台裝置、只給同一位學生（班級、座號、姓名都相同）、最多留 3 天；做完交卷（或選「重新開始」）就清掉。
import { store } from './storage.js';

const P = 'b5p:resume:';
const MAX_AGE = 3 * 86400000;

const who = () => {
  const s = store.student();
  return s ? `${s.cls}|${s.seat}|${s.name}` : '';
};

// 離開確認框的說明：有存進度才說「可以接著做」，還沒作答時老實說不會保存
export const leaveBody = (unit) => (progress.has(unit)
  ? '測驗還沒完成。離開後作答會先存在這台裝置，回到這個單元按「繼續上次」就能接著做；成績要做完交卷才會送出。'
  : '測驗還沒完成，離開後這次的作答不會保存，也不會送出成績。');

export const progress = {
  save(unit, mode, state) {
    const sid = who();
    if (!sid) return;
    try { localStorage.setItem(P + unit, JSON.stringify({ sid, mode, at: Date.now(), state })); } catch { /* 空間不足或被封鎖：就不存 */ }
  },
  load(unit, mode) {
    try {
      const r = JSON.parse(localStorage.getItem(P + unit) || 'null');
      const sid = who();
      if (!r || !sid || r.mode !== mode || r.sid !== sid || Date.now() - r.at > MAX_AGE) return null;
      return r.state;
    } catch { return null; }
  },
  // 這位學生在這個單元有沒有存著的進度（不分測驗種類）
  has(unit) {
    try {
      const r = JSON.parse(localStorage.getItem(P + unit) || 'null');
      const sid = who();
      return !!(r && sid && r.sid === sid && Date.now() - r.at <= MAX_AGE);
    } catch { return false; }
  },
  clear(unit) {
    try { localStorage.removeItem(P + unit); } catch { /* ignore */ }
  },
};
