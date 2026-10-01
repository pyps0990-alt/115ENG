// 句型練習與段考複習共用的題目：資料整理成一份「扁平題目清單」，作答、計分、檢討、伺服器核對都用同一套編號。
//   句型練習 items：mc（選擇）、fill（填空）、apply（應用：把打散的單字重組成句子）
//   段考複習 blocks：mc（選擇）、spell（拼寫）、reading（閱讀：一篇文章多題）、cloze（綜合：文章挖空，每格四選一）
import { esc, shuffle } from '../util.js';
import { icon } from '../icons.js';

export const KEYS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];
export const KIND_LABEL = { mc: '選擇', fill: '填空', apply: '應用', spell: '拼寫', phrase: '片語', reading: '閱讀', cloze: '綜合', bank: '文意選填', struct: '篇章結構', translate: '翻譯', essay: '作文' };

// 比對答案：不分大小寫、忽略標點與多餘空白（Code.gs 的 normAns_ 要保持一樣）
export const normAns = (s) => String(s == null ? '' : s).toLowerCase().replace(/[‘’]/g, "'").replace(/[^a-z0-9' ]/g, ' ').replace(/\s+/g, ' ').trim();
// 答案寫法：用 | 列出所有可接受的寫法；用 ( ) 標出可有可無的字，例如 "look forward to (doing)"、"(has been) looking forward to"。
// （Code.gs 的 expandAlts_ 要保持一樣）
export function expandAlts(str) {
  let out = [];
  String(str == null ? '' : str).split('|').forEach((alt) => {
    let list = [alt];
    for (let i = 0; i < 4 && list.some((x) => /\([^()]*\)/.test(x)); i++) {
      list = list.flatMap((x) => { const m = /\(([^()]*)\)/.exec(x); return m ? [x.replace(m[0], m[1]), x.replace(m[0], '')] : [x]; });
    }
    out = out.concat(list.map((x) => x.replace(/\s+/g, ' ').trim()).filter(Boolean));
  });
  return [...new Set(out)].slice(0, 64);
}
export const altsOf = (q) => expandAlts(q.answer);
export const fillOk = (q, typed) => altsOf(q).map(normAns).includes(normAns(typed));

// 題目文字裡的空格（____）畫成底線
export const blankHTML = (s) => esc(s).replace(/_{2,}/g, '<span class="blank"></span>');

export function flattenPattern(items) {
  return (items || []).map((it, i) => ({ id: `i${i}`, kind: it.type, label: KIND_LABEL[it.type] || '', tag: it.tag || '', stem: it.q || it.zh || '', hint: it.hint || '', zh: it.zh || '', words: it.words || [], options: it.options || [], answer: it.answer, explain: it.explain || '' }));
}

export function flattenExam(blocks) {
  const out = [];
  (blocks || []).forEach((b, i) => {
    if (b.type === 'mc' || b.type === 'spell' || b.type === 'phrase') {
      out.push({ id: `b${i}`, kind: b.type === 'mc' ? 'mc' : 'spell', label: KIND_LABEL[b.type], tag: b.tag || '', stem: b.q || '', hint: b.hint || '', options: b.options || [], answer: b.answer, explain: b.explain || '', block: i });
    } else if (b.type === 'reading') {
      (b.questions || []).forEach((q, j) => out.push({ id: `b${i}.${j}`, kind: 'mc', label: '閱讀', group: 'reading', tag: q.skill || '', stem: q.q || '', options: q.options || [], answer: q.answer, explain: q.explain || '', block: i, sub: j }));
    } else if (b.type === 'translate' || b.type === 'essay') {
      // 翻譯、作文沒有標準答案：不計分，交卷後對照參考答案自己檢查
      out.push({ id: `b${i}`, kind: 'open', label: KIND_LABEL[b.type], open: b.type, tag: '', stem: b.type === 'translate' ? (b.zh || '') : (b.q || ''), hint: b.hint || '', answer: b.type === 'translate' ? (b.answer || '') : (b.sample || ''), explain: b.explain || '', minWords: Number(b.minWords) || 0, block: i });
    } else if (b.type === 'bank' || b.type === 'struct') {
      // 文意選填、篇章結構：所有空格共用同一份選項（字庫／句子庫）
      (b.blanks || []).forEach((q, j) => out.push({ id: `b${i}.${j}`, kind: 'mc', label: KIND_LABEL[b.type], group: b.type, tag: '', stem: `第 ${j + 1} 格`, options: b.bank || [], answer: q.answer, explain: q.explain || '', block: i, sub: j }));
    } else if (b.type === 'cloze') {
      (b.blanks || []).forEach((q, j) => out.push({ id: `b${i}.${j}`, kind: 'mc', label: '綜合', group: 'cloze', tag: '', stem: `第 ${j + 1} 格`, options: q.options || [], answer: q.answer, explain: q.explain || '', block: i, sub: j }));
    }
  });
  return out;
}

export const correctText = (q) => (q.kind === 'mc' ? `${KEYS[q.answer]}. ${q.options[q.answer]}` : q.kind === 'open' ? String(q.answer || '') : altsOf(q).slice(0, 4).join(' / '));
export const isChoice = (q) => q.kind === 'mc';

// 從「A. 選項文字」找回選項索引（Firestore 讀回的紀錄用）
export function choiceIndex(yours) {
  const m = /^([A-J])\./.exec(String(yours || ''));
  return m ? KEYS.indexOf(m[1]) : null;
}

export function judge(q, yours) {
  if (isChoice(q)) return String(yours || '') === correctText(q);
  if (q.kind === 'apply') return fillOk(q, yours);
  return fillOk(q, yours);
}

/* ---------------- 一次一題的畫面（句型練習）---------------- */
function head(q, meta, sentence) {
  return `<div class="q-head"><div class="q-meta">${esc(meta)}</div>${q.tag ? `<span class="tagchip">${esc(q.tag)}</span>` : ''}${sentence}</div>`;
}

export function renderChoiceCard(host, q, { meta = '選出最適合的答案', onAnswer } = {}) {
  const card = document.createElement('div');
  card.className = 'q-card slide-in';
  card.innerHTML = `${head(q, meta, `<div class="q-sentence en">${blankHTML(q.stem)}</div>`)}
    <div class="options two" role="group" aria-label="選項">${q.options.map((o, i) => `<button class="opt" type="button" data-i="${i}">
      <span class="opt-key">${KEYS[i]}</span><span class="opt-text en">${esc(o)}</span><span class="opt-mark" aria-hidden="true"></span></button>`).join('')}</div>`;
  host.append(card);
  if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
  const opts = [...card.querySelectorAll('.opt')];
  let done = false;
  const choose = (i) => {
    if (done || i < 0 || i >= opts.length) return;
    done = true;
    const ok = i === q.answer;
    opts.forEach((o, j) => {
      o.disabled = true;
      if (j === q.answer) { o.classList.add('correct'); if (!ok) o.classList.add('reveal'); o.querySelector('.opt-mark').innerHTML = icon.check; }
      else if (j === i) { o.classList.add('wrong'); o.querySelector('.opt-mark').innerHTML = icon.x; }
      else o.classList.add('dim');
    });
    onAnswer?.(ok, `${KEYS[i]}. ${q.options[i]}`);
  };
  opts.forEach((o) => o.addEventListener('click', () => choose(Number(o.dataset.i))));
  return { choose, el: card };
}

export function renderFillCard(host, q, { meta = '填入空格中的單字或片語', onAnswer } = {}) {
  const card = document.createElement('div');
  card.className = 'q-card slide-in';
  card.innerHTML = `${head(q, meta, `<div class="q-sentence en">${blankHTML(q.stem)}</div>${q.hint ? `<div class="q-sub"><span>${esc(q.hint)}</span></div>` : ''}`)}
    <div class="fill-area"><input class="fill-input en" type="text" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" enterkeyhint="done" aria-label="輸入答案" placeholder="輸入答案">
      <button class="btn primary" type="button" data-check>檢查 ${icon.check}</button></div>
    <div class="answer-line" hidden></div>`;
  host.append(card);
  const input = card.querySelector('.fill-input');
  const btn = card.querySelector('[data-check]');
  let done = false;
  const check = () => {
    if (done) return;
    const typed = input.value.trim();
    if (!typed) { input.focus(); return; }
    done = true;
    const ok = fillOk(q, typed);
    input.disabled = true; btn.disabled = true;
    input.classList.add(ok ? 'ok' : 'no');
    const line = card.querySelector('.answer-line');
    if (!ok) { line.hidden = false; line.innerHTML = `正確答案：<b class="en">${esc(altsOf(q).slice(0, 4).join(' / '))}</b>`; }
    onAnswer?.(ok, typed);
  };
  btn.addEventListener('click', check);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); check(); } });
  setTimeout(() => input.focus({ preventScroll: true }), 60);
  return { el: card };
}

export function renderApplyCard(host, q, { meta = '應用：把單字排成正確的句子', onAnswer } = {}) {
  const card = document.createElement('div');
  card.className = 'q-card slide-in';
  const order = shuffle(q.words.map((w, i) => i));
  card.innerHTML = `${head(q, meta, `<div class="q-sentence">${esc(q.zh)}</div>`)}
    <div class="build-line" aria-live="polite"><span class="build-hint">點一下或拖動下面的單字，排成句子</span></div>
    <div class="bank" role="group" aria-label="單字">${order.map((i) => `<button class="chip-word en" type="button" data-w="${i}">${esc(q.words[i])}</button>`).join('')}</div>
    <div class="fill-area"><button class="btn ghost" type="button" data-clear>清除</button><button class="btn primary" type="button" data-check>檢查 ${icon.check}</button></div>
    <div class="answer-line" hidden></div>`;
  host.append(card);
  const line = card.querySelector('.build-line');
  const bank = [...card.querySelectorAll('.chip-word')];
  let picked = [];
  let done = false;
  const paint = () => {
    line.innerHTML = picked.length ? picked.map((i, k) => `<button class="chip-word en on" type="button" data-k="${k}">${esc(q.words[i])}</button>`).join('') : '<span class="build-hint">點一下或拖動下面的單字，排成句子</span>';
    bank.forEach((b) => { b.disabled = done || picked.includes(Number(b.dataset.w)); });
  };
  // 點一下：從下方加到句子最後面／從句子拿掉。單字的順序完全由學生決定，不會自動排序。
  card.addEventListener('click', (e) => {
    if (done || dragged) return;
    const b = e.target.closest('.chip-word');
    if (!b || b.disabled) return;
    if (b.dataset.k != null) picked.splice(Number(b.dataset.k), 1);
    else picked.push(Number(b.dataset.w));
    paint();
  });

  // 拖動：可以把單字拖進句子的任何位置、在句子裡調整順序，或拖回下方拿掉。移動不到 6px 視為點擊。
  let dragged = false;
  card.addEventListener('pointerdown', (e) => {
    if (done || e.button > 0) return;
    const src = e.target.closest('.chip-word');
    if (!src || src.disabled) return;
    const fromLine = src.dataset.k != null;
    const w = fromLine ? picked[Number(src.dataset.k)] : Number(src.dataset.w);
    const k0 = fromLine ? Number(src.dataset.k) : -1;
    const x0 = e.clientX, y0 = e.clientY;
    let ghost = null, mark = null, idx = null;
    const chipsInLine = () => [...line.querySelectorAll('.chip-word')];
    const indexAt = (x, y) => {
      const r = line.getBoundingClientRect();
      if (x < r.left - 12 || x > r.right + 12 || y < r.top - 12 || y > r.bottom + 12) return null;
      const chips = chipsInLine();
      for (let i = 0; i < chips.length; i++) {
        const c = chips[i].getBoundingClientRect();
        if (y < c.top) return i;
        if (y <= c.bottom && x < c.left + c.width / 2) return i;
      }
      return chips.length;
    };
    const move = (ev) => {
      if (!ghost) {
        if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < 6) return;
        dragged = true;
        ghost = src.cloneNode(true);
        ghost.classList.add('drag-ghost');
        ghost.style.width = `${src.offsetWidth}px`;
        document.body.append(ghost);
        src.classList.add('dragging');
        mark = document.createElement('span');
        mark.className = 'drop-mark';
      }
      ev.preventDefault();
      ghost.style.transform = `translate(${ev.clientX - src.offsetWidth / 2}px, ${ev.clientY - src.offsetHeight / 2}px)`;
      idx = indexAt(ev.clientX, ev.clientY);
      line.classList.toggle('over', idx != null);
      if (idx == null) { mark.remove(); return; }
      line.querySelector('.build-hint')?.remove();
      const chips = chipsInLine();
      line.insertBefore(mark, chips[idx] || null);
    };
    const end = (ev) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      if (!ghost) return;
      ghost.remove(); mark.remove(); src.classList.remove('dragging'); line.classList.remove('over');
      if (ev.type !== 'pointercancel') {
        if (fromLine) {
          picked.splice(k0, 1);
          if (idx != null) picked.splice(idx > k0 ? idx - 1 : idx, 0, w); // 拖到句子外面＝拿掉
        } else if (idx != null) picked.splice(idx, 0, w);
      }
      paint();
      setTimeout(() => { dragged = false; }, 0); // 擋掉拖完後緊接著的 click
    };
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  });
  card.querySelector('[data-clear]').addEventListener('click', () => { if (done) return; picked = []; paint(); });
  card.querySelector('[data-check]').addEventListener('click', () => {
    if (done || !picked.length) return;
    done = true;
    const built = picked.map((i) => q.words[i]).join(' ');
    const ok = fillOk(q, built);
    line.classList.add(ok ? 'ok' : 'no');
    card.querySelectorAll('.fill-area .btn').forEach((b) => { b.disabled = true; });
    paint();
    if (!ok) { const a = card.querySelector('.answer-line'); a.hidden = false; a.innerHTML = `正確答案：<b class="en">${esc(altsOf(q).slice(0, 4).join(' / '))}</b>`; }
    onAnswer?.(ok, built);
  });
  paint();
  return { el: card };
}

export function explainHTML(q) {
  return q.explain ? `<div class="explain xp slide-in"><div class="xp-head">${icon.bulb} 解析</div><p>${esc(q.explain)}</p></div>` : '';
}

/* ---------------- 檢討卡片 ---------------- */
// q：扁平題目；yours：學生當時的答案（選擇題是「A. 文字」）；extra：例如閱讀題的文章
export function reviewCardHTML(q, yours, extra = '') {
  const ok = judge(q, yours);
  const meta = `${esc(q.label)}${q.tag ? `・${esc(q.tag)}` : ''}`;
  if (isChoice(q)) {
    const a = choiceIndex(yours);
    return `<div class="pq rv-pq ${ok ? 'is-ok' : 'is-no'}">${extra}
      <div class="pq-head"><span class="pq-num">${icon.bulb}</span><div><span class="skill">${meta}</span><div class="pq-q en">${blankHTML(q.stem)}</div></div></div>
      <div class="options">${q.options.map((o, j) => {
    const cls = j === q.answer ? `correct${ok ? '' : ' reveal'}` : j === a ? 'wrong' : 'dim';
    const mark = j === q.answer ? icon.check : j === a ? icon.x : '';
    return `<div class="opt ${cls}"><span class="opt-key">${KEYS[j]}</span><span class="opt-text en">${esc(o)}</span><span class="opt-mark" aria-hidden="true">${mark}</span></div>`;
  }).join('')}</div>
      ${q.explain ? `<div class="explain"><b class="ex-head ${ok ? 'ok' : 'no'}">${ok ? `${icon.check} 答對` : a == null ? `${icon.x} 未作答・正解 ${KEYS[q.answer]}` : `${icon.x} 你選 ${KEYS[a]}・正解 ${KEYS[q.answer]}`}</b><p>${esc(q.explain)}</p></div>` : ''}
    </div>`;
  }
  const prompt = q.kind === 'apply' ? esc(q.zh) : blankHTML(q.stem);
  return `<div class="rv-card">
    <div class="rv-meta">${meta}</div>
    <div class="rv-prompt en">${prompt}</div>
    <div class="rv-row ${ok ? 'ok' : 'no'}"><span>你的答案</span><b class="en">${String(yours || '').trim() ? esc(yours) : '（未作答）'}</b></div>
    ${ok ? '' : `<div class="rv-row ok"><span>正確答案</span><b class="en">${esc(altsOf(q).slice(0, 4).join(' / '))}</b></div>`}
    ${q.explain ? `<p class="xp-tip">${esc(q.explain)}</p>` : ''}
  </div>`;
}
