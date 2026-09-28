// 可重複使用的題目元件：選擇題 (renderMC) 與字母框拼字 (renderSpell)。
// feedback=true：練習模式，作答後立即顯示對錯；false：正式測驗，只記錄作答。
import { esc, shuffle, clozeParts, lettersOf, exampleHTML, plainExample, pickExample } from '../util.js';
import { icon } from '../icons.js';

// 拼字題每題最多提示 2 次（每次扣 0.25 分），用完按鈕變暗
export const MAX_HINTS = 2;

const KEYS = ['A', 'B', 'C', 'D', 'E'];

export function buildMC(word, pool, dir) {
  const d = dir === 'mix' ? (Math.random() < 0.5 ? 'en2zh' : 'zh2en') : dir;
  const pick = (w) => (d === 'en2zh' ? w.zh : w.word);
  const seen = new Set([pick(word)]);
  const others = [];
  // 單字配單字、片語配片語當干擾選項，不夠時再從全部補
  const same = pool.filter((w) => (w.type || 'word') === (word.type || 'word'));
  for (const w of [...shuffle(same), ...shuffle(pool)]) {
    if (others.length >= 3) break;
    if (w.word === word.word || seen.has(pick(w))) continue;
    seen.add(pick(w));
    others.push(w);
  }
  const options = shuffle([word, ...others]).map(pick);
  return { type: 'mc', word, dir: d, options, answer: options.indexOf(pick(word)) };
}

// 進階：例句挖空，四選一（選項是其他字詞在例句中的形式）
// 這個字如果存了不只一句例句，每次隨機挑一句出題，同樣的字、同樣題型內容也不會一樣
export function buildClozeMC(word, pool) {
  const ex = pickExample(word);
  const c = clozeParts({ ...word, example: ex.ex });
  if (!c) return buildMC(word, pool, 'zh2en');
  const key = (s) => s.toLowerCase();
  const seen = new Set([key(c.answer)]);
  const same = pool.filter((w) => (w.type || 'word') === (word.type || 'word'));
  const others = [];
  for (const w of [...shuffle(same.length >= 4 ? same : pool), ...shuffle(pool)]) {
    if (others.length >= 3) break;
    const p = clozeParts(w);
    if (!p || w.word === word.word || seen.has(key(p.answer))) continue;
    seen.add(key(p.answer));
    others.push(p.answer);
  }
  // 句首大寫的答案，干擾選項也跟著大寫，避免一眼看出
  const cap = /^[A-Z]/.test(c.answer) && !c.before.trim();
  const fix = (s) => (cap ? s.charAt(0).toUpperCase() + s.slice(1) : s.charAt(0).toLowerCase() + s.slice(1));
  const options = shuffle([c.answer, ...others.map(fix)]);
  return { type: 'mc', word, dir: 'cloze', parts: c, options, answer: options.indexOf(c.answer), exampleZh: ex.zh };
}

export function buildSpell(word, variant) {
  if (variant === 'cloze') {
    const ex = pickExample(word);
    const c = clozeParts({ ...word, example: ex.ex });
    if (c) return { type: 'spell', variant: 'cloze', word, answer: c.answer, parts: c, exampleZh: ex.zh };
  }
  return { type: 'spell', variant: 'spell', word, answer: word.word };
}

export const gradeMC = (q, chosen) => chosen === q.answer;
export const gradeSpell = (q, typed) => lettersOf(typed) === lettersOf(q.answer);

export function promptText(q) {
  if (q.type === 'mc' && q.dir === 'cloze') return `${q.parts.before}____${q.parts.after}`;
  if (q.type === 'mc') return q.dir === 'en2zh' ? q.word.word : q.word.zh;
  return q.variant === 'cloze' ? `${q.parts.before}____${q.parts.after}` : q.word.zh;
}
export const answerText = (q) => (q.type === 'mc' ? q.options[q.answer] : q.answer);

/* ---------------- 選擇題 ---------------- */
export function renderMC(host, q, { feedback = true, selected = null, label = '', onAnswer } = {}) {
  const en2zh = q.dir === 'en2zh';
  const cloze = q.dir === 'cloze';
  const meta = label || (en2zh ? '選出正確的中文意思' : cloze ? '選出最適合填入空格的字詞' : '選出正確的英文字詞');
  const prompt = en2zh
    ? `<div class="q-prompt"><span class="w">${esc(q.word.word)}</span></div>
       <div class="q-sub"><span class="pos">${esc(q.word.pos || '')}</span></div>`
    : cloze
      ? `<div class="q-sentence">${esc(q.parts.before)}<span class="blank"></span>${esc(q.parts.after)}</div>`
      : `<div class="q-prompt"><span class="zh">${esc(q.word.zh)}</span></div>
         <div class="q-sub"><span class="pos">${esc(q.word.pos || '')}</span></div>`;
  const card = document.createElement('div');
  card.className = 'q-card slide-in';
  card.innerHTML = `
    <div class="q-head">
      <div class="q-meta">${esc(meta)}</div>
      ${prompt}
    </div>
    <div class="options two" role="group" aria-label="選項">
      ${q.options.map((o, i) => `<button class="opt" type="button" data-i="${i}">
        <span class="opt-key">${KEYS[i]}</span><span class="opt-text ${en2zh ? '' : 'en'}">${esc(o)}</span>
        <span class="opt-mark" aria-hidden="true"></span></button>`).join('')}
    </div>`;
  host.append(card);
  const opts = [...card.querySelectorAll('.opt')];
  let done = false;

  const choose = (i) => {
    if (i < 0 || i >= opts.length) return;
    if (!feedback) {
      opts.forEach((o, j) => o.classList.toggle('selected', j === i));
      onAnswer?.(i);
      return;
    }
    if (done) return;
    done = true;
    const ok = i === q.answer;
    opts.forEach((o, j) => {
      o.disabled = true;
      if (j === q.answer) { o.classList.add('correct'); if (!ok) o.classList.add('reveal'); o.querySelector('.opt-mark').innerHTML = icon.check; }
      else if (j === i) { o.classList.add('wrong'); o.querySelector('.opt-mark').innerHTML = icon.x; }
      else o.classList.add('dim');
    });
    onAnswer?.(ok, i);
  };
  opts.forEach((o) => o.addEventListener('click', () => choose(Number(o.dataset.i))));
  if (selected != null) opts[selected]?.classList.add('selected');
  return { choose, el: card };
}

/* ---------------- 拼字 / 克漏字（字母框） ---------------- */
export function renderSpell(host, q, { feedback = true, value = '', label = '', onAnswer, onInput } = {}) {
  const slots = [...q.answer].map((ch) => (/[a-z]/i.test(ch) ? { letter: ch.toLowerCase() } : { sep: ch }));
  const target = slots.filter((s) => s.letter).map((s) => s.letter);
  const n = target.length;
  const w = q.word;

  const head = q.variant === 'cloze'
    ? `<div class="q-meta">${esc(label || '依句意拼出空格中的單字')}</div>
       <div class="q-sentence">${esc(q.parts.before)}<span class="blank"></span>${esc(q.parts.after)}</div>
       <div class="q-sub"><span>${esc(q.exampleZh || w.exampleZh || '')}</span></div>
       <div class="q-sub"><span class="pos">${esc(w.pos || '')}</span><span>${esc(w.zh)}</span><span>· ${n} 個字母</span></div>`
    : `<div class="q-meta">${esc(label || '看中文，拼出英文單字')}</div>
       <div class="q-prompt"><span class="zh">${esc(w.zh)}</span></div>
       <div class="q-sub"><span class="pos">${esc(w.pos || '')}</span><span>${n} 個字母・開頭是 ${esc(target[0].toUpperCase())}</span></div>`;

  const card = document.createElement('div');
  card.className = 'q-card slide-in';
  card.innerHTML = `
    <div class="q-head">${head}</div>
    <div class="spell-area">
      <div class="boxes" style="--n:${Math.max(slots.length, 6)}">${slots.map((s) => (s.letter ? '<span class="lbox"></span>'
        : `<span class="lsep ${s.sep === ' ' ? 'sp' : ''}">${s.sep === ' ' ? '' : esc(s.sep)}</span>`)).join('')}</div>
      <input class="spell-input" type="text" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" enterkeyhint="done" aria-label="輸入答案">
    </div>
    ${feedback ? `<div class="q-foot">
      <button class="btn small ghost" type="button" data-hint>${icon.bulb} 提示 <span class="hint-left"></span></button>
      <button class="btn primary" type="button" data-check>檢查 ${icon.check}</button>
    </div>` : ''}
    <div class="answer-line" hidden></div>`;
  host.append(card);

  const input = card.querySelector('.spell-input');
  const boxesEl = card.querySelector('.boxes');
  const boxes = [...card.querySelectorAll('.lbox')];
  let hints = 0;
  let checked = false;
  const maxHints = Math.min(MAX_HINTS, n - 1);
  const hintBtn = card.querySelector('[data-hint]');
  const paintHint = () => {
    if (!hintBtn) return;
    const left = maxHints - hints;
    hintBtn.querySelector('.hint-left').textContent = `(${left})`;
    hintBtn.disabled = left <= 0;
    hintBtn.setAttribute('aria-label', left > 0 ? `提示，還剩 ${left} 次` : '提示已用完');
  };

  const letters = () => lettersOf(input.value).slice(0, n);
  const paint = () => {
    const l = letters();
    const focused = document.activeElement === input;
    boxes.forEach((b, i) => {
      b.textContent = l[i] || '';
      b.classList.toggle('filled', !!l[i] && i >= hints);
      b.classList.toggle('hinted', i < hints);
      b.classList.toggle('cursor', focused && !checked && i === l.length);
    });
  };
  input.addEventListener('input', () => {
    if (checked) return;
    let l = lettersOf(input.value);
    const prefix = target.slice(0, hints).join('');
    if (!l.startsWith(prefix)) l = prefix + l.slice(hints);
    l = l.slice(0, n);
    if (input.value !== l) input.value = l;
    paint();
    onInput?.(l);
  });
  input.addEventListener('focus', paint);
  input.addEventListener('blur', paint);
  if (value) { input.value = lettersOf(value).slice(0, n); }

  const check = () => {
    if (checked || !feedback) return;
    const typed = letters();
    if (!typed.length) { input.focus(); return; }
    checked = true;
    input.disabled = true;
    const ok = typed === target.join('');
    card.querySelector('.q-foot').hidden = true;
    if (ok) {
      boxes.forEach((b, i) => { b.style.animationDelay = `${i * 70}ms`; b.classList.remove('filled', 'hinted', 'cursor'); b.classList.add('ok'); });
    } else {
      boxesEl.classList.add('shake');
      boxes.forEach((b, i) => { b.classList.remove('cursor'); if (typed[i] !== target[i]) b.classList.add('bad'); });
      const line = card.querySelector('.answer-line');
      line.hidden = false;
      line.innerHTML = `正確答案：<b>${esc(q.answer)}</b>${q.variant === 'cloze' ? ` <span class="muted">（${esc(w.word)}）</span>` : ''}`;
    }
    onAnswer?.(ok, { hints, typed });
  };
  const hint = () => {
    if (checked || hints >= maxHints) return;
    hints++;
    paintHint();
    const rest = letters().slice(hints);
    input.value = (target.slice(0, hints).join('') + rest).slice(0, n);
    paint();
    input.focus();
  };

  card.querySelector('[data-check]')?.addEventListener('click', check);
  hintBtn?.addEventListener('click', hint);
  paintHint();
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); check(); }
  });
  paint();
  setTimeout(() => input.focus({ preventScroll: true }), 50);
  return { check, focus: () => input.focus(), value: letters, get hints() { return hints; }, get checked() { return checked; }, el: card };
}

/* ---------------- 答錯時的解析 ---------------- */
function spellDiff(typed, answer) {
  const a = lettersOf(answer);
  const t = lettersOf(typed);
  if (!t) return '沒有作答';
  const wrong = [];
  for (let i = 0; i < Math.min(a.length, t.length); i++) if (a[i] !== t[i]) wrong.push(i + 1);
  const parts = [];
  if (wrong.length) parts.push(`第 ${wrong.slice(0, 5).join('、')}${wrong.length > 5 ? '…' : ''} 個字母拼錯`);
  if (t.length < a.length) parts.push(`少了 ${a.length - t.length} 個字母`);
  if (t.length > a.length) parts.push(`多了 ${t.length - a.length} 個字母`);
  return parts.join('，');
}

// 找出學生選到的選項是清單裡哪個字
function chosenWord(q, chosen, pool) {
  if (chosen == null) return null;
  if (q.dir === 'en2zh') return pool.find((w) => w.zh === chosen);
  if (q.dir === 'cloze') return pool.find((w) => { const c = clozeParts(w); return c && c.answer.toLowerCase() === String(chosen).toLowerCase(); });
  return pool.find((w) => w.word === chosen);
}

// 錯誤原因：意思混淆（選到或拼成別的字）、詞形錯誤（字對了但形式不對）、拼字錯誤（差幾個字母）、不熟悉、未作答
const stem = (s) => s.replace(/(ies|ied|ying|ing|es|ed|s|d)$/, '').replace(/i$/, 'y');

function editDistance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return d[a.length][b.length];
}

export function classifyError(q, chosen, pool = []) {
  if (chosen == null || String(chosen).trim() === '') return '未作答';
  if (q.type === 'mc') return '意思混淆';
  const typed = lettersOf(chosen);
  const ans = lettersOf(q.answer);
  const base = lettersOf(q.word.word);
  if (!typed) return '未作答';
  if (typed !== ans && (typed === base || (ans.length > 3 && stem(typed) === stem(ans)))) return '詞形錯誤';
  if (pool.some((w) => w.word !== q.word.word && lettersOf(w.word) === typed)) return '意思混淆';
  if (editDistance(typed, ans) <= Math.max(1, Math.floor(ans.length / 4))) return '拼字錯誤';
  return '不熟悉';
}

export const ERR_TIPS = {
  意思混淆: '這兩個字容易搞混，對照一下各自的意思和例句',
  詞形錯誤: '字選對了，注意句子需要的形式（時態、單複數、詞性變化）',
  拼字錯誤: '意思想對了，拼字再檢查一次',
  不熟悉: '這個字還不熟，多看幾次例句加深印象',
  未作答: '這題沒有作答，先記住正確答案',
};

// 回傳 { html, text, err }：html 顯示在題目下方，text 用在總成績單與試算表，err 是錯誤類型
export function explainWrong(q, chosen, pool = []) {
  const w = q.word;
  const err = classifyError(q, chosen, pool);
  const lines = [`<p class="xp-tip"><span class="xp-tag">${esc(err)}</span>${esc(ERR_TIPS[err] || '')}</p>`];
  const text = [];
  lines.push(`<div class="xp-main"><span class="xp-word en">${esc(w.word)}</span><span class="pos">${esc(w.pos || '')}</span><span class="xp-zh">${esc(w.zh)}</span></div>`);
  text.push(`〔${err}〕${w.word}：${w.zh}`);
  if (q.type === 'mc') {
    const other = chosenWord(q, chosen, pool);
    if (other && other.word !== w.word) {
      const msg = q.dir === 'en2zh'
        ? `你選的「${esc(chosen)}」是 <b class="en">${esc(other.word)}</b> 的意思`
        : `你選的 <b class="en">${esc(chosen)}</b> 意思是「${esc(other.zh)}」`;
      lines.push(`<p class="xp-yours">${msg}</p>`);
      text.push(q.dir === 'en2zh' ? `你選的是 ${other.word} 的意思` : `你選的 ${chosen} 是「${other.zh}」`);
    }
  } else {
    const d = spellDiff(chosen, q.answer);
    const typed = lettersOf(chosen || '');
    lines.push(`<p class="xp-yours">${typed ? `你拼成 <b class="en">${esc(typed)}</b>` : '沒有作答'}${typed && d ? `・${esc(d)}` : ''}</p>`);
    if (d) text.push(d);
  }
  // 這題是例句題的話，顯示的例句要跟剛才考的那句一致（同一個字可能存了不只一句）
  const clozeQ = (q.type === 'mc' && q.dir === 'cloze') || (q.type === 'spell' && q.variant === 'cloze');
  const exEn = clozeQ ? `${q.parts.before}[${q.parts.answer}]${q.parts.after}` : w.example;
  const exZh = clozeQ ? q.exampleZh : w.exampleZh;
  if (exEn) {
    lines.push(`<p class="xp-ex en">${exampleHTML(exEn)}</p>`);
    if (exZh) lines.push(`<p class="xp-exzh">${esc(exZh)}</p>`);
    text.push(plainExample(exEn));
  }
  return { html: `<div class="explain xp slide-in"><div class="xp-head">${icon.bulb} 解析</div>${lines.join('')}</div>`, text: text.join('｜'), err };
}
