// 作答中的狀態列（單字、課文、句型共用）：
//   左邊：這次算不算分（正式測驗・計分／複習・不影響成績／錯題重練・練習）
//   中間：各題型自己的進度（題數、進度條、連對）
//   右邊：24 小時內截止才出現的倒數，剩不到 1 小時變紅
// 狀態列黏在網站上方 header 的下面（header 高度量好放進 --top-h）
import { fmtWhen } from '../remote-config.js';
import { icon } from '../icons.js';

const MODES = {
  official: '正式測驗・計分',
  review: '複習・不影響成績',
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
function measureTop() {
  const top = document.querySelector('.topbar');
  const h = top && getComputedStyle(top).position === 'sticky' ? top.offsetHeight : 0;
  document.documentElement.style.setProperty('--top-h', `${h}px`);
}
if (typeof window !== 'undefined') window.addEventListener('resize', measureTop);
