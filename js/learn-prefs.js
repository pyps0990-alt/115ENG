// 句型練習循序漸進版的偏好（認識卡用邊看邊找或直接看說明、哪些句型看過說明）：
// 先存在這台裝置，再寫進雲端學生帳本 vault/{key}/prefs/learn，換裝置也記得
import { store } from './storage.js';

const blank = () => ({ mode: '', seen: {} });
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
      import('./firebase.js').then((fb) => fb.saveLearnPrefs(me, { mode: cur.mode, seen: cur.seen })).catch((e) => console.warn('偏好寫入雲端失敗', e));
    }, 800);
  };
  return {
    get(k) {
      if (k === 'learnMode') return cur.mode || null;
      if (k.startsWith('learnSeen:')) return cur.seen[k.slice(10)] || null;
      return null;
    },
    set(k, v) {
      if (k === 'learnMode') cur.mode = v === 'read' ? 'read' : 'find';
      else if (k.startsWith('learnSeen:')) { const keys = Object.keys(cur.seen); if (keys.length >= 200) delete cur.seen[keys[0]]; cur.seen[k.slice(10, 70)] = 1; }
      save();
    },
  };
}
