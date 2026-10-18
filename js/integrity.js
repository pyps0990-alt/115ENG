// 作答誠信：作答中（body[data-busy]）阻擋翻譯、複製貼上，記錄離開作答畫面；交卷時把紀錄附在成績裡給老師看。
// 能擋的：瀏覽器內建翻譯（整頁 translate="no"）、翻譯擴充功能（偵測到就遮住題目）、選取／複製／右鍵／拖曳、貼上答案。
// 擋不住、只能記錄的：切到別的 App 或分頁查資料（記錄次數與秒數）。擋不住也偵測不到的：用另一台裝置拍照翻譯。
// 由 js/app.js 在 data-busy 出現／消失時呼叫 start／stop；js/submit.js 交卷時用 take() 取走這次的紀錄。

const KEY = 'b5p:integrity';
const BLUR_MIN_MS = 2000; // 視窗失去焦點超過 2 秒才算（避免通知、系統對話框誤判）
const AWAY_MIN_MS = 1000; // 切走不到 1 秒（例如誤觸）不算

let rec = null;   // 這次作答的紀錄 { unit, away, awaySec, translate, paste, copy }
let off = null;   // 停止監看
let last = null;  // 剛結束的那次（交卷時取走）
let notify = () => {};

const blank = (unit) => ({ unit, away: 0, awaySec: 0, translate: 0, paste: 0, copy: 0 });
const save = () => { try { sessionStorage.setItem(KEY, JSON.stringify(rec)); } catch { /* 無痕模式 */ } };

// 翻譯工具的痕跡：Chrome／Edge 內建翻譯在 <html> 加 translated-ltr，並把字包進 <font>；常見的翻譯擴充功能會插入自己的標記
function translated() {
  const h = document.documentElement;
  if (/\btranslated-(ltr|rtl)\b/.test(h.className)) return true;
  const app = document.getElementById('app');
  if (!app) return false;
  return !!app.querySelector('font[style*="vertical-align"], [data-immersive-translate-walked], .immersive-translate-target-wrapper, [class*="immersive-translate"], .goog-te-banner-frame, [data-sider-translated], .kiss-translator, [class*="trancy"]');
}

export function start(unit, { onNotice } = {}) {
  stop(false);
  notify = onNotice || (() => {});
  let prev = null;
  try { prev = JSON.parse(sessionStorage.getItem(KEY) || 'null'); } catch { /* 沒有 */ }
  rec = prev && prev.unit === unit ? prev : blank(unit); // 同一份測驗重新整理後接續累計
  save();
  let hiddenAt = 0, blurAt = 0, blocked = false;
  const inField = (t) => t && t.closest && t.closest('input, textarea, [contenteditable="true"]');

  const awayBack = (since, min) => {
    const ms = Date.now() - since;
    if (ms < min) return;
    rec.away += 1; rec.awaySec += Math.round(ms / 1000); save();
    notify(`你離開了作答畫面（第 ${rec.away} 次），會記錄給老師`, 'wait');
  };
  const onVis = () => {
    if (document.hidden) { hiddenAt = Date.now(); blurAt = 0; return; }
    if (hiddenAt) { awayBack(hiddenAt, AWAY_MIN_MS); hiddenAt = 0; }
  };
  const onBlur = () => { if (!document.hidden) blurAt = Date.now(); };
  const onFocus = () => { if (blurAt && !hiddenAt) awayBack(blurAt, BLUR_MIN_MS); blurAt = 0; };
  // 題目、文章不能選取複製；輸入框可以打字，但不能貼上
  const onCopy = (e) => { if (inField(e.target)) return; e.preventDefault(); rec.copy += 1; save(); };
  const onPaste = (e) => { e.preventDefault(); rec.paste += 1; save(); notify('作答時不能貼上，請自己輸入', 'wait'); };
  const onMenu = (e) => { if (!inField(e.target)) e.preventDefault(); };
  const onDrag = (e) => e.preventDefault();
  const check = () => {
    const t = translated();
    if (t && !blocked) { rec.translate += 1; save(); }
    if (t !== blocked) { blocked = t; document.body.classList.toggle('integrity-block', t); }
  };
  const mo = new MutationObserver(check);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'lang'] });
  const app = document.getElementById('app');
  if (app) mo.observe(app, { childList: true, subtree: true });
  const timer = setInterval(check, 2000);

  document.addEventListener('visibilitychange', onVis);
  window.addEventListener('blur', onBlur);
  window.addEventListener('focus', onFocus);
  document.addEventListener('copy', onCopy, true);
  document.addEventListener('cut', onCopy, true);
  document.addEventListener('paste', onPaste, true);
  document.addEventListener('drop', onDrag, true);
  document.addEventListener('dragstart', onDrag, true);
  document.addEventListener('contextmenu', onMenu, true);
  document.body.classList.add('integrity-on');
  check();
  off = () => {
    mo.disconnect(); clearInterval(timer);
    document.removeEventListener('visibilitychange', onVis);
    window.removeEventListener('blur', onBlur);
    window.removeEventListener('focus', onFocus);
    document.removeEventListener('copy', onCopy, true);
    document.removeEventListener('cut', onCopy, true);
    document.removeEventListener('paste', onPaste, true);
    document.removeEventListener('drop', onDrag, true);
    document.removeEventListener('dragstart', onDrag, true);
    document.removeEventListener('contextmenu', onMenu, true);
    document.body.classList.remove('integrity-on', 'integrity-block');
  };
}

// keep=true：作答結束（交卷或離開），留下這次的紀錄等交卷時取走
export function stop(keep = true) {
  if (off) { off(); off = null; }
  if (keep && rec) last = rec;
  rec = null;
  try { sessionStorage.removeItem(KEY); } catch { /* 無痕模式 */ }
}

// 交卷時取走這個單元剛結束那次的紀錄（沒有任何狀況回傳 null）
export function take(unit) {
  const r = last && last.unit === unit ? last : null;
  last = null;
  if (!r) return null;
  const out = { away: r.away, awaySec: r.awaySec, translate: r.translate, paste: r.paste, copy: r.copy };
  return Object.values(out).some(Boolean) ? out : null;
}
