import { esc, confetti } from '../util.js';
import { PASS } from '../types.js';
import { icon } from '../icons.js';

const CIRC = 2 * Math.PI * 52;

function cheer(pct) {
  if (pct === 100) return '滿分！太強了';
  if (pct >= 85) return '表現超棒！';
  if (pct >= PASS) return '過關了，做得好';
  if (pct >= 50) return '再練一次，會更穩';
  return '先看錯的題目，再試一次';
}

// 分數數字從 0 數到最終分數（跟圓環同步，只改一個文字節點，很輕）
function countUp(el, to, ms = 1000) {
  if (!el || to <= 0 || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const t0 = performance.now();
  el.textContent = '0';
  const step = (now) => {
    const k = Math.min(1, (now - t0) / ms);
    el.textContent = String(Math.round(to * (1 - Math.pow(1 - k, 3))));
    if (k < 1 && el.isConnected) requestAnimationFrame(step); else el.textContent = String(to);
  };
  requestAnimationFrame(step);
}

// wrong: [{ p: 題目, a: 正確答案, y: 你的答案 }]
// actions: [{ label, icon, primary, onClick }]
// passLine：正式測驗才顯示及格線與「還差多少」（練習與複習不計及格）
// prevBest：這次之前的最佳成績（補考時顯示進步多少）
// onRetake：正式測驗沒過時，「馬上補考」變成主要按鈕，其他按鈕降為次要
export function renderResult(host, { title, pct, scoreText, pills = [], wrong = [], actions = [], extraHTML = '', passLine = false, prevBest = null, onRetake = null }) {
  if (passLine && pct < PASS && onRetake) actions = [{ label: '馬上補考', icon: icon.redo, primary: true, onClick: onRetake }, ...actions.map((a) => ({ ...a, primary: false }))];
  const gain = passLine && prevBest != null && pct > prevBest ? pct - prevBest : 0;
  if (gain) pills = [`比上次最佳多 ${gain}%`, ...pills];
  const box = document.createElement('div');
  box.className = pct >= PASS ? 'result pass' : 'result';
  box.innerHTML = `
    <div class="ring" role="img" aria-label="得分 ${pct}%${passLine ? (pct >= PASS ? `，已達及格線 ${PASS}%` : `，未達及格線 ${PASS}%，還差 ${PASS - pct}%`) : ''}">
      <svg viewBox="0 0 120 120">
        <circle class="track" cx="60" cy="60" r="52"/>
        <circle class="val" cx="60" cy="60" r="52" style="stroke-dasharray:${CIRC};stroke-dashoffset:${CIRC}"/>
        ${passLine && pct < PASS ? `<circle class="gap" cx="60" cy="60" r="52" style="stroke-dasharray:${(CIRC * (PASS - pct)) / 100} ${CIRC};stroke-dashoffset:${-(CIRC * pct) / 100}"/>` : ''}
        ${passLine ? `<line class="pass-tick" x1="103" y1="60" x2="117" y2="60" transform="rotate(${PASS * 3.6} 60 60)"/>` : ''}
      </svg>
      ${passLine && pct >= PASS ? `<span class="pass-badge" aria-hidden="true">${icon.check}</span>` : ''}
      <div class="ring-label"><div class="pct"><span data-num>${pct}</span><small style="font-size:.5em">%</small></div><div class="sub">${esc(scoreText || '')}</div></div>
    </div>
    <div><h2>${esc(passLine && pct < PASS ? `還差 ${PASS - pct}%，再試一次` : title || cheer(pct))}</h2>${passLine ? `<p class="pass-gap ${pct >= PASS ? 'ok' : 'no'}">${pct >= PASS ? `已達及格線 ${PASS}%，${esc(cheer(pct))}` : `及格線 ${PASS}%，可以馬上再考一次，沒有次數限制`}</p>` : title ? `<p class="muted" style="margin:4px 0 0">${esc(cheer(pct))}</p>` : ''}</div>
    ${pills.length ? `<div class="result-lines">${pills.map((p) => `<span class="hud-pill">${p}</span>`).join('')}</div>` : ''}
    ${extraHTML}
    <div class="btn-row center" data-actions></div>
    ${wrong.length ? `<div class="wrong-list"><h3>要再複習的 ${wrong.length} 題</h3>
      ${wrong.map((w) => `<div class="wrong-item"><span class="p">${esc(w.p)}</span><span class="a">${esc(w.a)}</span>
        ${w.y != null && w.y !== '' ? `<span class="y">你的答案：${esc(w.y)}</span>` : ''}
        ${w.x ? `<span class="x">${esc(w.x)}</span>` : ''}</div>`).join('')}</div>` : ''}`;
  // 成績送出狀態放最上面（最需要學生確認的事）
  const sub = box.querySelector('[data-submit]');
  if (sub) { sub.classList.add('result-submit'); box.prepend(sub); }
  const row = box.querySelector('[data-actions]');
  actions.forEach((a) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `btn ${a.primary ? 'primary' : ''}`;
    b.innerHTML = `${a.icon || ''}${esc(a.label)}`;
    b.addEventListener('click', a.onClick);
    row.append(b);
  });
  host.append(box);
  requestAnimationFrame(() => requestAnimationFrame(() => {
    box.querySelector('.val').style.strokeDashoffset = String(CIRC * (1 - pct / 100));
  }));
  countUp(box.querySelector('[data-num]'), pct);
  // 正式測驗過關（或滿分）是最重要的一刻：撒彩帶
  if ((pct === 100 || (passLine && pct >= PASS)) && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) setTimeout(confetti, 350);
  return box;
}
