import { esc, confetti } from '../util.js';

const CIRC = 2 * Math.PI * 52;

function cheer(pct) {
  if (pct === 100) return '滿分！太強了 🎉';
  if (pct >= 85) return '表現超棒！';
  if (pct >= 70) return '不錯喔，再接再厲';
  if (pct >= 50) return '還差一點，再練一次';
  return '多練幾次就會了 💪';
}

// wrong: [{ p: 題目, a: 正確答案, y: 你的答案 }]
// actions: [{ label, icon, primary, onClick }]
export function renderResult(host, { title, pct, scoreText, pills = [], wrong = [], actions = [], extraHTML = '' }) {
  const box = document.createElement('div');
  box.className = 'result';
  box.innerHTML = `
    <div class="ring" role="img" aria-label="得分 ${pct}%">
      <svg viewBox="0 0 120 120">
        <defs><linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" style="stop-color:var(--primary)"/><stop offset="1" style="stop-color:var(--accent)"/></linearGradient></defs>
        <circle class="track" cx="60" cy="60" r="52"/>
        <circle class="val" cx="60" cy="60" r="52" style="stroke-dasharray:${CIRC};stroke-dashoffset:${CIRC}"/>
      </svg>
      <div class="ring-label"><div class="pct">${pct}<small style="font-size:.5em">%</small></div><div class="sub">${esc(scoreText || '')}</div></div>
    </div>
    <div><h2>${esc(title || cheer(pct))}</h2>${title ? `<p class="muted" style="margin:4px 0 0">${esc(cheer(pct))}</p>` : ''}</div>
    ${pills.length ? `<div class="result-lines">${pills.map((p) => `<span class="hud-pill">${p}</span>`).join('')}</div>` : ''}
    ${extraHTML}
    <div class="btn-row center" data-actions></div>
    ${wrong.length ? `<div class="wrong-list"><h3>要再複習的 ${wrong.length} 題</h3>
      ${wrong.map((w) => `<div class="wrong-item"><span class="p">${esc(w.p)}</span><span class="a">${esc(w.a)}</span>
        ${w.y != null && w.y !== '' ? `<span class="y">你的答案：${esc(w.y)}</span>` : ''}</div>`).join('')}</div>` : ''}`;
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
  if (pct === 100) setTimeout(confetti, 350);
  return box;
}
