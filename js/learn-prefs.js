// 學生的學習設定（句型說明用邊看邊找或直接看說明、哪些句型看過說明、單字自動下一題）：
// 先存在這台裝置，再寫進雲端學生帳本 vault/{key}/prefs/learn，所有裝置都套用（換手機、換電腦登入也一樣）
import { store } from './storage.js';

const blank = () => ({ mode: '', seen: {}, auto: null });
const AUTO_KEY = 'b5p:auto'; // 單字作答直接讀這台裝置的這一份（跟雲端同步）
const readAuto = () => { try { const v = localStorage.getItem(AUTO_KEY); return v == null ? null : v === '1'; } catch { return null; } };
const writeAuto = (v) => { try { localStorage.setItem(AUTO_KEY, v ? '1' : '0'); } catch { /* ignore */ } };
let synced = false;

export function learnPrefs() {
  const me = (store.student() || {}).key;
  let cur = { ...blank(), ...(store.learnPrefs() || {}) };
  if (cur.key && cur.key !== me) cur = blank(); // 換人登入：不沿用上一位的偏好
  cur.key = me;
  // 第一次用到時跟雲端合併（雲端有、這台沒有的補進來）
  if (me && !synced) {
    synced = true;
    import('./firebase.js').then((fb) => fb.loadLearnPrefs(me)).then((cloud) => {
      // 自動下一題：雲端有就以雲端為準（別的裝置改過）；雲端沒有、這台有設定過，就把這台的上傳
      if (cloud && typeof cloud.auto === 'boolean') { cur.auto = cloud.auto; writeAuto(cloud.auto); }
      else if (cur.auto == null && readAuto() != null) { cur.auto = readAuto(); save(); }
      if (!cloud) return;
      if (!cur.mode && cloud.mode) cur.mode = cloud.mode;
      cur.seen = { ...(cloud.seen || {}), ...cur.seen };
      store.setLearnPrefs(cur);
    }).catch(() => { synced = false; });
  }
  let timer = null;
  const save = () => {
    store.setLearnPrefs(cur);
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (!me) return;
      import('./firebase.js').then((fb) => fb.saveLearnPrefs(me, { mode: cur.mode, seen: cur.seen, auto: typeof cur.auto === 'boolean' ? cur.auto : undefined })).catch((e) => console.warn('偏好寫入雲端失敗', e));
    }, 800);
  };
  return {
    get(k) {
      if (k === 'learnMode') return cur.mode || null;
      if (k === 'auto') { const v = cur.auto != null ? cur.auto : readAuto(); return v == null ? true : v; } // 沒設定過：預設開
      if (k.startsWith('learnSeen:')) return cur.seen[k.slice(10)] || null;
      return null;
    },
    set(k, v) {
      if (k === 'auto') { cur.auto = !!v; writeAuto(cur.auto); }
      else if (k === 'learnMode') cur.mode = v === 'read' ? 'read' : 'find';
      else if (k.startsWith('learnSeen:')) { const keys = Object.keys(cur.seen); if (keys.length >= 200) delete cur.seen[keys[0]]; cur.seen[k.slice(10, 70)] = 1; }
      save();
    },
  };
}
