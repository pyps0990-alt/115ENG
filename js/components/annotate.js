// 課文理解的文章劃記（老師在後台「單元設定」開啟才有；不計分）。
// 文章拆成一個個字（.w，data-p 第幾段、data-i 第幾個字）與字間空白（.sp，跟在第 i 個字後面），劃記範圍內的空白一起上色，看起來是一整條。
// 劃記資料：{ p 段, f 起字, t 迄字, k 工具, n 便利貼文字 }，跟著作答進度與作答紀錄存起來，檢討時顯示。
//   電腦：拿著工具在字上拖曳；點一下＝只標一個字
//   手機：長按一個字 0.3 秒（輕震）後滑過去；或點第一個字、再點最後一個字（一般的滑動仍是捲動畫面）
//   工具在右下角的圓形按鈕：點一下展開、可以拖動位置、畫面一捲動就收回
import { esc, splitSentences } from '../util.js';

export const MARK_TOOLS = [
  { id: 'hl-yellow', label: '黃色螢光筆', dot: '#FDE68A' },
  { id: 'hl-green', label: '綠色螢光筆', dot: '#BBF7D0' },
  { id: 'hl-pink', label: '粉紅螢光筆', dot: '#FBCFE8' },
  { id: 'ul', label: '底線', icon: '<span class="mk-ic-ul">A</span>' },
  { id: 'circ', label: '圈起來', icon: '<span class="mk-ic-circ">A</span>' },
  { id: 'note', label: '便利貼', icon: '<span class="mk-ic-note">✎</span>' },
  { id: 'erase', label: '橡皮擦', icon: '<span class="mk-ic-erase">⌫</span>' },
];
const toolOf = (id) => MARK_TOOLS.find((t) => t.id === id);

/* ---------------- 文章拆字、找出依據與關鍵字的位置 ---------------- */
export const wordsOf = (para) => String(para).split(/\s+/).filter(Boolean);
const bare = (w) => String(w).toLowerCase().replace(/[^a-z0-9']/g, '');

// 一段文章的 HTML：ev＝答案依據的字範圍（整句包在一個 .ev 裡，綠筆劃線）；kw＝這一段裡是題目關鍵字的字（Set）
export function paraHTML(p, text, { ev = null, kw = null } = {}) {
  const ws = wordsOf(text);
  return ws.map((w, i) => {
    const inEv = ev && ev.p === p && i >= ev.f && i <= ev.t;
    const open = ev && ev.p === p && i === ev.f ? '<span class="ev">' : '';
    const close = ev && ev.p === p && i === ev.t ? '</span>' : '';
    const sp = i < ws.length - 1 ? `<span class="sp" data-p="${p}" data-i="${i}"> </span>` : '';
    const word = `<span class="w${kw && kw.has(i) ? ' kw' : ''}" data-p="${p}" data-i="${i}">${esc(w)}</span>`;
    // 依據範圍裡的空白放進 .ev，最後一個字後面的空白放在外面
    return `${open}${word}${inEv && i < ev.t ? sp : ''}${close}${inEv && i < ev.t ? '' : sp}`;
  }).join('');
}

// 原文關鍵字句（key）在哪一段的第幾個字到第幾個字
export function rangeOfKey(paras, key) {
  const k = wordsOf(key).map(bare).filter(Boolean);
  if (!k.length) return null;
  for (let p = 0; p < paras.length; p++) {
    const ws = wordsOf(paras[p]).map(bare);
    for (let i = 0; i + k.length <= ws.length; i++) {
      if (k.every((x, j) => ws[i + j] === x)) return { p, f: i, t: i + k.length - 1 };
    }
  }
  return null;
}
// 原文依據句（ref「段-句」，可以逗號分隔多句，取第一句）在哪一段的第幾個字到第幾個字
export function rangeOfRef(paras, ref) {
  const m = /^(\d+)-(\d+)/.exec(String(ref || '').trim());
  if (!m) return null;
  const p = Number(m[1]) - 1, s = Number(m[2]) - 1;
  if (!paras[p]) return null;
  const sents = splitSentences(paras[p]);
  if (!sents[s]) return null;
  const before = sents.slice(0, s).reduce((n, x) => n + wordsOf(x).length, 0);
  return { p, f: before, t: before + wordsOf(sents[s]).length - 1 };
}
// 題目關鍵字（q.kw）在文章裡出現的位置：{ 段: Set(字的位置) }；名詞單複數、動詞 -s／-ed／-ing 也算
export function keywordHits(paras, kws) {
  const stem = (w) => w.replace(/(ies|ied)$/, 'y').replace(/(ing|ed|es|s)$/, '');
  const out = {};
  for (const phrase of kws || []) {
    const k = wordsOf(phrase).map(bare).filter(Boolean).map(stem);
    if (!k.length) continue;
    paras.forEach((para, p) => {
      const ws = wordsOf(para).map(bare).map(stem);
      for (let i = 0; i + k.length <= ws.length; i++) {
        if (k.every((x, j) => ws[i + j] === x)) { out[p] = out[p] || new Set(); for (let j = 0; j < k.length; j++) out[p].add(i + j); }
      }
    });
  }
  return out;
}

/* ---------------- 畫出劃記 ---------------- */
// root 裡可能有兩份文章（手機收合版與平板電腦的左欄），同一個位置的字都要上色
// tagQ：只標這一題的小題號（檢討時用）；沒給＝每一筆都標
export function paintMarks(root, marks, { pending = null, anchor = null, tagQ = null } = {}) {
  root.querySelectorAll('.ann-text .w, .ann-text .sp').forEach((el) => {
    el.classList.remove('hl-yellow', 'hl-green', 'hl-pink', 'ul', 'circ', 'noted', 'first', 'last', 'pending', 'anchor');
  });
  root.querySelectorAll('.ann-text .note-pin, .ann-text .q-tag').forEach((n) => n.remove());
  const cls = (p, i, list, gap) => {
    root.querySelectorAll(`.ann-text .w[data-p="${p}"][data-i="${i}"]`).forEach((el) => el.classList.add(...list));
    if (gap) root.querySelectorAll(`.ann-text .sp[data-p="${p}"][data-i="${i}"]`).forEach((el) => el.classList.add(...list.filter((c) => c !== 'first' && c !== 'last')));
  };
  (marks || []).forEach((m, idx) => {
    for (let i = m.f; i <= m.t; i++) {
      const list = [m.k === 'note' ? 'noted' : m.k];
      if (m.k === 'circ') { if (i === m.f) list.push('first'); if (i === m.t) list.push('last'); }
      cls(m.p, i, list, i < m.t);
    }
    if (m.k === 'note') {
      root.querySelectorAll(`.ann-text .w[data-p="${m.p}"][data-i="${m.t}"]`).forEach((el) => el.insertAdjacentHTML('afterend',
        `<button class="note-pin" type="button" data-note="${idx}" aria-label="看便利貼">✎</button>`));
    } else if (Number.isInteger(m.q) && (tagQ == null || m.q === tagQ)) { // 有對照題目：最後一個字後面標小題號
      root.querySelectorAll(`.ann-text .w[data-p="${m.p}"][data-i="${m.t}"]`).forEach((el) => el.insertAdjacentHTML('afterend',
        `<span class="q-tag" aria-label="對照第 ${m.q + 1} 題">Q${m.q + 1}</span>`));
    }
  });
  if (pending) { const [a, b] = [Math.min(pending.f, pending.t), Math.max(pending.f, pending.t)]; for (let i = a; i <= b; i++) cls(pending.p, i, ['pending'], i < b); }
  if (anchor) root.querySelectorAll(`.ann-text .w[data-p="${anchor.p}"][data-i="${anchor.i}"]`).forEach((el) => el.classList.add('anchor'));
}

/* ---------------- 便利貼 ---------------- */
export function openNote(root, paras, mark, { readOnly = false, isNew = false, onSave, onDelete } = {}) {
  document.querySelector('.note-pop')?.remove();
  const end = [...root.querySelectorAll(`.ann-text .w[data-p="${mark.p}"][data-i="${mark.t}"]`)].find((el) => el.offsetParent);
  if (!end) return;
  const r = end.getBoundingClientRect();
  const quote = wordsOf(paras[mark.p]).slice(mark.f, mark.t + 1).join(' ');
  const pop = document.createElement('div');
  pop.className = 'note-pop';
  pop.innerHTML = `<div class="q en">「${esc(quote.length > 70 ? `${quote.slice(0, 70)}…` : quote)}」</div>
    <textarea maxlength="200" placeholder="寫下想法，例如：這段在說…" ${readOnly ? 'readonly' : ''}>${esc(mark.n || '')}</textarea>
    <div class="row">${!isNew && !readOnly ? '<button class="btn small ghost" type="button" data-del>刪除</button>' : ''}${readOnly ? '' : '<button class="btn small ghost" type="button" data-cancel>取消</button>'}
      <button class="btn small primary" type="button" data-ok>${readOnly ? '關閉' : '貼上'}</button></div>`;
  document.body.append(pop);
  pop.style.left = `${Math.max(16, Math.min(scrollX + r.left, scrollX + innerWidth - pop.offsetWidth - 16))}px`;
  pop.style.top = `${scrollY + r.bottom + 8}px`;
  const ta = pop.querySelector('textarea');
  if (!readOnly) ta.focus({ preventScroll: true });
  pop.querySelector('[data-cancel]')?.addEventListener('click', () => pop.remove());
  pop.querySelector('[data-del]')?.addEventListener('click', () => { pop.remove(); onDelete?.(); });
  pop.querySelector('[data-ok]').addEventListener('click', () => { pop.remove(); if (!readOnly) onSave?.(ta.value.trim()); });
}

/* ---------------- 作答時的劃記工具 ---------------- */
// root：作答畫面；paras：文章各段；marks：劃記陣列（會直接修改）；onChange：劃記改了（存進度用）；nQ：題數
// 對照題目（選填）：選了題號，之後的劃記都帶這個題號（m.q，從 0 起算），檢討那一題時拿來判斷；
// 學生點了別題的題目卡（換題）就改回「不對照」
export function mountAnnotator(root, paras, marks, onChange, { nQ = 0 } = {}) {
  let tool = null, anchor = null, drag = null, press = null, skipClick = false, qSel = null, lastQ = null;
  let fab = null, pop = null, tip = null, tipTimer = null;
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const touchMode = () => matchMedia('(pointer: coarse), (max-width: 767px)').matches;
  const texts = () => root.querySelectorAll('.ann-text');
  const repaint = () => paintMarks(root, marks, { pending: drag, anchor });
  const changed = () => { repaint(); onChange?.(); };

  function apply(p, from, to) {
    let [f, t] = from <= to ? [from, to] : [to, from];
    if (tool === 'note') {
      const m = { p, f, t, k: 'note', n: '' };
      openNote(root, paras, m, { isNew: true, onSave: (n) => { if (n) { m.n = n; marks.push(m); changed(); } } });
      return;
    }
    // 同一種工具、同一個對照題目重疊或相連的部分合併成一筆；不同工具可以疊（例如螢光筆＋底線）
    const q = qSel == null ? undefined : qSel;
    for (let k = marks.length - 1; k >= 0; k--) { const x = marks[k]; if (x.p === p && x.k === tool && x.q === q && x.f <= t + 1 && x.t >= f - 1) { f = Math.min(f, x.f); t = Math.max(t, x.t); marks.splice(k, 1); } }
    marks.push({ p, f, t, k: tool, ...(q != null ? { q } : {}) });
    changed();
  }
  function erase(p, i) {
    for (let k = marks.length - 1; k >= 0; k--) { const x = marks[k]; if (x.p === p && x.f <= i && x.t >= i) { marks.splice(k, 1); changed(); return; } } // 點一下清掉最上面那一層
    showTip('這個字沒有劃記');
  }

  /* 圓形按鈕：位置存成畫面比例；預設右下角；不能拖到導覽列上 */
  const POS = 'b5p:ann-fab';
  const fabPos = () => {
    let f = null;
    try { f = JSON.parse(localStorage.getItem(POS)); } catch { /* 沒有 */ }
    if (f && typeof f.fx === 'number') return { x: f.fx * (innerWidth - 56), y: f.fy * (innerHeight - 56) };
    return { x: innerWidth - 56 - 20, y: innerHeight - 56 - 110 };
  };
  const place = (pos) => {
    const top = (document.querySelector('.topbar')?.getBoundingClientRect().bottom || 62) + 8;
    fab.style.left = `${Math.min(Math.max(8, pos.x), innerWidth - 64)}px`;
    fab.style.top = `${Math.min(Math.max(top, pos.y), innerHeight - 64)}px`;
  };
  function drawFab() {
    const t = tool && toolOf(tool);
    fab.classList.toggle('has-tool', !!t);
    fab.setAttribute('aria-label', t ? `劃記工具：${t.label}（點一下換工具）` : '劃記工具（點一下展開）');
    fab.innerHTML = (t ? (t.dot ? `<span class="fab-dot" style="background:${t.dot}"></span>` : `<span class="fab-ic">${t.icon}</span>`)
      : '<span class="fab-ic"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 11l-6 6v3h3l6-6"/><path d="M22 6l-4-4-9 9 4 4z"/></svg></span>')
      + (qSel != null ? `<span class="fab-q" aria-hidden="true">Q${qSel + 1}</span>` : '');
    if (qSel != null) fab.setAttribute('aria-label', `${fab.getAttribute('aria-label')}，對照第 ${qSel + 1} 題`);
    texts().forEach((el) => el.classList.toggle('tool-on', !!t));
  }
  fab = document.createElement('button');
  fab.type = 'button';
  fab.className = 'ann-fab';
  document.body.append(fab);
  place(fabPos());
  drawFab();
  let start = null;
  fab.addEventListener('pointerdown', (e) => {
    try { fab.setPointerCapture(e.pointerId); } catch { /* 沒有真的指標 */ }
    const r = fab.getBoundingClientRect();
    start = { x: e.clientX, y: e.clientY, dx: e.clientX - r.left, dy: e.clientY - r.top, moved: false };
  });
  fab.addEventListener('pointermove', (e) => {
    if (!start) return;
    if (!start.moved && Math.hypot(e.clientX - start.x, e.clientY - start.y) < 6) return;
    if (!start.moved) { start.moved = true; fab.classList.add('dragging'); closePop(false); hideTip(); }
    place({ x: e.clientX - start.dx, y: e.clientY - start.dy });
  });
  fab.addEventListener('pointerup', () => {
    if (!start) return;
    const moved = start.moved; start = null;
    fab.classList.remove('dragging');
    if (moved) { const r = fab.getBoundingClientRect(); try { localStorage.setItem(POS, JSON.stringify({ fx: r.left / (innerWidth - 56), fy: r.top / (innerHeight - 56) })); } catch { /* 無痕 */ } return; }
    if (pop) closePop(); else openPop();
  });

  // 工具盤：從按鈕中心長出來，工具依序浮現；收回時縮回按鈕
  const circle = (el) => {
    const f = fab.getBoundingClientRect(), pr = el.getBoundingClientRect();
    const cx = f.left + f.width / 2 - pr.left, cy = f.top + f.height / 2 - pr.top;
    return { cx, cy, far: Math.hypot(Math.max(cx, pr.width - cx), Math.max(cy, pr.height - cy)) };
  };
  function openPop() {
    closePop(false);
    pop = document.createElement('div');
    pop.className = 'ann-pop';
    pop.setAttribute('role', 'toolbar');
    pop.setAttribute('aria-label', '劃記工具');
    pop.innerHTML = `<div class="row">${MARK_TOOLS.slice(0, 3).map((t) => `<button class="ann-tool" type="button" data-tool="${t.id}" aria-pressed="${tool === t.id}" aria-label="${t.label}"><span class="ann-swatch" style="background:${t.dot}"></span></button>`).join('')}</div>
      ${MARK_TOOLS.slice(3).map((t) => `<button class="ann-tool wide" type="button" data-tool="${t.id}" aria-pressed="${tool === t.id}">${t.icon}<span>${t.label}</span></button>`).join('')}
      ${nQ ? `<hr><div class="ann-q-label">對照題目（選填）</div><div class="row ann-qs">
        <button class="ann-q" type="button" data-q="" aria-pressed="${qSel == null}">不對照</button>
        ${Array.from({ length: nQ }, (_, i) => `<button class="ann-q" type="button" data-q="${i}" aria-pressed="${qSel === i}" aria-label="對照第 ${i + 1} 題">Q${i + 1}</button>`).join('')}</div>` : ''}
      <hr><button class="ann-tool wide" type="button" data-tool="" aria-pressed="${!tool}"><span class="mk-ic-hand">✋</span><span>放下工具（一般閱讀）</span></button>
      <p class="hint">${touchMode() ? '劃記：長按一個字再滑過去；或點第一個字、再點最後一個字' : '劃記：在文字上拖曳；點一下只標一個字'}・不計分</p>`;
    document.body.append(pop);
    const f = fab.getBoundingClientRect(), w = pop.offsetWidth, h = pop.offsetHeight;
    const right = f.left + f.width / 2 > innerWidth / 2, below = f.top + f.height / 2 < innerHeight / 2;
    pop.style.left = `${Math.max(8, Math.min(innerWidth - w - 8, right ? f.right - w : f.left))}px`;
    pop.style.top = `${Math.max(8, Math.min(innerHeight - h - 8, below ? f.bottom + 8 : f.top - h - 8))}px`;
    fab.classList.add('open');
    if (!reduced() && pop.animate) {
      const c = circle(pop);
      pop.animate([{ clipPath: `circle(26px at ${c.cx}px ${c.cy}px)`, opacity: 0.6 }, { clipPath: `circle(${c.far}px at ${c.cx}px ${c.cy}px)`, opacity: 1 }], { duration: 360, easing: 'cubic-bezier(.2, .9, .25, 1)' });
      [...pop.querySelectorAll('.ann-tool, hr, .hint')].forEach((el, k) => el.animate([{ opacity: 0, transform: `translateY(${below ? -8 : 8}px)` }, { opacity: 1, transform: 'none' }],
        { duration: 260, delay: 70 + k * 28, easing: 'cubic-bezier(.2, .8, .2, 1)', fill: 'backwards' }));
    }
    pop.addEventListener('click', (e) => {
      const qb = e.target.closest('[data-q]');
      if (qb) { // 選對照題目：工具盤不關，可以接著選筆
        qSel = qb.dataset.q === '' ? null : Number(qb.dataset.q);
        if (qSel != null) lastQ = qSel;
        pop.querySelectorAll('[data-q]').forEach((x) => x.setAttribute('aria-pressed', String(x === qb)));
        drawFab();
        return;
      }
      const b = e.target.closest('[data-tool]'); if (!b) return;
      tool = b.dataset.tool || null; anchor = null;
      closePop(); drawFab(); repaint();
      if (tool) showTip(tool === 'erase' ? '點要清掉的劃記' : touchMode() ? '長按一個字再滑過去，或點頭尾兩個字' : '在文字上拖曳來劃記');
    });
  }
  function closePop(animate = true) {
    const el = pop; pop = null;
    fab?.classList.remove('open');
    if (!el) return;
    if (!animate || reduced() || !el.animate) { el.remove(); return; }
    const c = circle(el);
    el.style.pointerEvents = 'none';
    el.animate([{ clipPath: `circle(${c.far}px at ${c.cx}px ${c.cy}px)`, opacity: 1 }, { clipPath: `circle(24px at ${c.cx}px ${c.cy}px)`, opacity: 0 }], { duration: 240, easing: 'cubic-bezier(.4, 0, .6, 1)' }).onfinish = () => el.remove();
    setTimeout(() => el.remove(), 320);
  }
  function showTip(text) {
    hideTip();
    tip = document.createElement('div');
    tip.className = 'ann-tip';
    tip.setAttribute('role', 'status');
    tip.textContent = text;
    document.body.append(tip);
    const f = fab.getBoundingClientRect();
    const right = f.left + f.width / 2 > innerWidth / 2;
    tip.style.top = `${f.top + f.height / 2 - tip.offsetHeight / 2}px`;
    tip.style.left = right ? `${Math.max(8, f.left - tip.offsetWidth - 10)}px` : `${f.right + 10}px`;
    tipTimer = setTimeout(hideTip, 2600);
  }
  function hideTip() { clearTimeout(tipTimer); tip?.remove(); tip = null; }

  /* 劃記操作 */
  const wordAt = (e) => e.target.closest?.('.ann-text .w');
  const onClick = (e) => {
    const pin = e.target.closest('.ann-text .note-pin');
    if (pin) {
      const m = marks[Number(pin.dataset.note)];
      if (m) openNote(root, paras, m, { onSave: (n) => { if (n) m.n = n; else marks.splice(marks.indexOf(m), 1); changed(); }, onDelete: () => { marks.splice(marks.indexOf(m), 1); changed(); } });
      return;
    }
    if (skipClick) { skipClick = false; return; }
    const w = wordAt(e);
    if (!w || !tool || !touchMode()) return;
    const p = Number(w.dataset.p), i = Number(w.dataset.i);
    if (tool === 'erase') { erase(p, i); return; }
    if (!anchor) { anchor = { p, i }; repaint(); showTip('再點最後一個字（同一個字點兩下＝只標這個字）'); return; }
    if (anchor.p !== p) { anchor = { p, i }; repaint(); showTip('劃記要在同一段裡：改成從這個字開始'); return; }
    const from = anchor.i; anchor = null; hideTip(); apply(p, from, i);
  };
  const onDown = (e) => {
    const card = e.target.closest?.('.pq[data-q]');
    if (card) { // 換題：對照題目改回「不對照」
      const i = Number(card.dataset.q);
      if (qSel != null && i !== qSel) { qSel = null; drawFab(); showTip(`換到第 ${i + 1} 題：對照題目改回「不對照」`); }
      lastQ = i;
      return;
    }
    const w = wordAt(e);
    if (!w || !tool) return;
    const p = Number(w.dataset.p), i = Number(w.dataset.i);
    if (!touchMode()) {
      e.preventDefault();
      if (tool === 'erase') { erase(p, i); return; }
      drag = { p, f: i, t: i }; repaint();
      return;
    }
    if (tool === 'erase') return;
    press = { x: e.clientX, y: e.clientY, timer: setTimeout(() => {
      if (!press) return;
      navigator.vibrate?.(12);
      drag = { p, f: i, t: i, touch: true }; anchor = null; repaint();
      showTip('滑過要劃的字，放開就完成');
    }, 300) };
  };
  const onMove = (e) => {
    if (press && !drag && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 8) { clearTimeout(press.timer); press = null; return; } // 在捲動
    if (!drag) return;
    const w = document.elementFromPoint(e.clientX, e.clientY)?.closest('.ann-text .w');
    if (w && Number(w.dataset.p) === drag.p) { drag.t = Number(w.dataset.i); repaint(); }
  };
  const onTouchMove = (e) => { if (drag) e.preventDefault(); }; // 長按進入劃記後，手指移動不要捲動畫面
  const onUp = () => {
    if (press) { clearTimeout(press.timer); press = null; }
    if (!drag) return;
    const d = drag; drag = null;
    if (d.touch) { skipClick = true; setTimeout(() => { skipClick = false; }, 400); hideTip(); }
    apply(d.p, d.f, d.t);
  };
  const onCancel = () => { if (press) { clearTimeout(press.timer); press = null; } if (drag) { drag = null; repaint(); } };
  const onScroll = () => { if (pop) closePop(true); hideTip(); };
  const onDocDown = (e) => { if (pop && !pop.contains(e.target) && !fab.contains(e.target)) closePop(); };
  const onResize = () => { place(fabPos()); closePop(false); hideTip(); };
  root.addEventListener('click', onClick);
  root.addEventListener('pointerdown', onDown);
  root.addEventListener('pointermove', onMove);
  root.addEventListener('touchmove', onTouchMove, { passive: false });
  addEventListener('pointerup', onUp);
  addEventListener('pointercancel', onCancel);
  addEventListener('scroll', onScroll, { passive: true });
  addEventListener('resize', onResize);
  document.addEventListener('pointerdown', onDocDown);
  repaint();

  return () => {
    root.removeEventListener('click', onClick);
    root.removeEventListener('pointerdown', onDown);
    root.removeEventListener('pointermove', onMove);
    root.removeEventListener('touchmove', onTouchMove);
    removeEventListener('pointerup', onUp);
    removeEventListener('pointercancel', onCancel);
    removeEventListener('scroll', onScroll);
    removeEventListener('resize', onResize);
    document.removeEventListener('pointerdown', onDocDown);
    closePop(false); hideTip(); fab?.remove(); fab = null;
    document.querySelector('.note-pop')?.remove();
  };
}
