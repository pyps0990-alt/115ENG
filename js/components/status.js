// 作答中的狀態列（單字、課文、句型共用）：
//   左邊：這次算不算分（正式測驗・計分／複習／錯題重練・練習）
//   中間：各題型自己的進度（題數、進度條、連對）
//   右邊：24 小時內截止才出現的倒數，剩不到 1 小時變紅
// 狀態列黏在網站上方 header 的下面（header 高度量好放進 --top-h）
import { fmtWhen } from '../remote-config.js';
import { icon } from '../icons.js';

const MODES = {
  official: '正式測驗・計分',
  review: '複習',
  redo: '錯題重練・練習',
};

// kind：official／review／redo；mid：中間進度的 HTML；note：狀態列下面一句白話說明
export function statusBarHTML({ kind, mid, note = '' }) {
  return `<div class="st-bar" data-st-bar>
      <span class="st-box mode-badge ${kind}">${MODES[kind] || ''}</span>
      <div class="st-mid">${mid}</div>
      <span class="st-box st-deadline" data-deadline hidden></span>
    </div>${note ? `<p class="st-note ${kind}">${note}</p>` : ''}`;
}

// 截止倒數：24 小時內才顯示；每 30 秒更新一次。回傳停止更新的函式
export function mountDeadline(root, win) {
  const el = root.querySelector('[data-deadline]');
  measureTop();
  if (typeof MutationObserver !== 'undefined' && !window.__stickyMo) { window.__stickyMo = new MutationObserver(() => { if (watched && !watched.isConnected) measureTop(); }); window.__stickyMo.observe(document.body, { childList: true, subtree: true }); }
  if (!el || !win || win.state !== 'open' || !win.closeAt) return () => {};
  const paint = () => {
    if (!el.isConnected) { clearInterval(t); return; }
    const left = win.closeAt - Date.now();
    if (left > 86400000 || left <= 0) { el.hidden = true; return; }
    el.hidden = false;
    el.classList.toggle('urgent', left < 3600000);
    const text = left < 3600000 ? `剩 ${Math.max(1, Math.ceil(left / 60000))} 分鐘截止` : sameDay(win.closeAt) ? `今天 ${fmtWhen(win.closeAt).split(' ').pop()} 截止` : `${fmtWhen(win.closeAt)} 截止`;
    el.innerHTML = `${icon.clock}${text}${win.extended ? '（補作）' : ''}`;
  };
  const t = setInterval(() => paint(), 30000);
  paint();
  return () => clearInterval(t);
}

function sameDay(ms) {
  const tw = (x) => new Date(x + 8 * 3600000).toISOString().slice(0, 10);
  return tw(ms) === tw(Date.now());
}

// 網站 header 是黏在最上面的：狀態列要黏在它下面（矮螢幕 header 不固定時就貼齊最上面）
// 同時讓頁面捲動（鍵盤 Tab、自動捲到題目）時預留 header＋狀態列的高度，被選到的元素不會躲在它們底下
let watched = null, ro = null;
function measureTop() {
  const root = document.documentElement;
  const top = document.querySelector('.topbar');
  const h = top && getComputedStyle(top).position === 'sticky' ? top.offsetHeight : 0;
  root.style.setProperty('--top-h', `${h}px`);
  const bar = document.querySelector('[data-st-bar]');
  root.style.setProperty('--sticky-h', `${h + (bar && bar.isConnected ? bar.offsetHeight + 16 : 0)}px`);
  if (bar !== watched && typeof ResizeObserver !== 'undefined') {
    if (ro) ro.disconnect();
    watched = bar;
    if (bar) { ro = new ResizeObserver(() => measureTop()); ro.observe(bar); }
  }
}
if (typeof window !== 'undefined') window.addEventListener('resize', measureTop);
// 測驗結束（狀態列不在畫面上）：不再預留
export const refreshSticky = measureTop;
