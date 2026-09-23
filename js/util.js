export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

export function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export const sample = (arr, n) => shuffle(arr).slice(0, n);

export const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export const wait = (ms) => new Promise((r) => setTimeout(r, reducedMotion() ? Math.min(ms, 60) : ms));

let toastTimer;
export function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

export function fmtTime(ms) {
  const s = ms / 1000;
  const m = Math.floor(s / 60);
  return `${m}:${(s % 60).toFixed(1).padStart(4, '0')}`;
}

export function nowStamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

// 例句中用 [ ] 標出目標字，例如 "She stayed calm in the face of [adversity]."
export const exampleHTML = (ex) => esc(ex).replace(/\[([^\]]+)\]/g, '<mark class="hl">$1</mark>');
export const plainExample = (ex) => String(ex ?? '').replace(/\[([^\]]+)\]/g, '$1');

export function clozeParts(w) {
  const ex = w.example || '';
  let m = ex.match(/\[([^\]]+)\]/);
  if (m) return { before: ex.slice(0, m.index), answer: m[1], after: ex.slice(m.index + m[0].length) };
  // 沒有標記時，用字首推測（例如 adapt → adapted）
  const stem = w.word.slice(0, Math.max(3, w.word.length - 2)).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  m = ex.match(new RegExp(`\\b(${stem}[a-z]*)`, 'i'));
  if (m) return { before: ex.slice(0, m.index), answer: m[1], after: ex.slice(m.index + m[0].length) };
  return null;
}

export const lettersOf = (s) => String(s).toLowerCase().replace(/[^a-z]/g, '');

export function confirmDialog({ title, body, ok = '確定', cancel = '取消' }) {
  return new Promise((resolve) => {
    const d = el(`<dialog class="modal"><form method="dialog" class="modal-body">
      <h2>${esc(title)}</h2><div class="muted">${body}</div>
      <div class="btn-row" style="justify-content:flex-end">
        <button class="btn ghost" value="cancel">${esc(cancel)}</button>
        <button class="btn primary" value="ok" autofocus>${esc(ok)}</button>
      </div></form></dialog>`);
    document.body.append(d);
    d.addEventListener('close', () => { resolve(d.returnValue === 'ok'); d.remove(); });
    d.showModal();
  });
}

export function confetti() {
  if (reducedMotion()) return;
  const fx = document.getElementById('fx');
  const colors = ['#4f46e5', '#ff6b5b', '#22c55e', '#f59e0b', '#06b6d4', '#a855f7'];
  for (let i = 0; i < 70; i++) {
    const c = document.createElement('span');
    c.className = 'confetti';
    c.style.left = `${Math.random() * 100}%`;
    c.style.background = colors[i % colors.length];
    c.style.animationDuration = `${1.8 + Math.random() * 1.6}s`;
    c.style.animationDelay = `${Math.random() * 0.4}s`;
    c.style.transform = `rotate(${Math.random() * 360}deg)`;
    fx.append(c);
    setTimeout(() => c.remove(), 4000);
  }
}
