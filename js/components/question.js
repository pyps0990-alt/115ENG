// 可重複使用的題目元件：選擇題 (renderMC) 與字母框拼字 (renderSpell)。
// feedback=true：練習模式，作答後立即顯示對錯；false：正式測驗，只記錄作答。
import { esc, shuffle, clozeParts, lettersOf, exampleHTML, plainExample, pickExample, sameMeaning, meaningsOf } from '../util.js';
import { icon } from '../icons.js';
import { diffAnswer } from './diff.js';

// 拼字題每題最多提示 2 次（扣分見 js/levels.js 的 HINT_PENALTY），用完按鈕變暗
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
    // 中文意思相同或重疊的字（例如 big／large 都是「大的」）不當干擾選項，不然會有兩個正確答案
    if (sameMeaning(w.zh, word.zh) || others.some((o) => sameMeaning(o.zh, w.zh))) continue;
    seen.add(pick(w));
    others.push(w);
  }
  const options = shuffle([word, ...others]).map(pick);
  return { type: 'mc', word, dir: d, options, answer: options.indexOf(pick(word)) };
}

// 進階：例句挖空，四選一（選項是其他字詞在例句中的形式）
// 這個字如果存了不只一句例句，每次隨機挑一句出題，同樣的字、同樣題型內容也不會一樣
// 7000 單字表的課外字只用在「例句填空選擇」：每題有 EXTRA_CHANCE 的機會混入、最多 MAX_EXTRA 個（其他題型沒有例句空格，課外字沒辦法判斷）
export const EXTRA_CHANCE = 0.5;
export const MAX_EXTRA = 3;

// analysis：錯誤分析引擎的結果（可省略）。有的話：這句例句放進去也說得通的同單元字不當選項（不夠選時才勉強用），
// 並依機會從這句例句的課外選項裡隨機加 1～3 個（和答案同詞性、同詞形，判斷放進去說不通）
// pickEx(word, n)：從 n 句例句裡挑一句的索引（記得這位學生上次考過哪句，換一句沒考過的）；沒給就隨機
const exampleList = (word) => (Array.isArray(word.examples) && word.examples.length ? word.examples : [{ ex: word.example || '', zh: word.exampleZh || '' }]).filter((e) => e.ex);
const pickIndex = (word, n, pickEx) => (n ? (pickEx ? pickEx(word.word, n) : Math.floor(Math.random() * n)) : 0);

export function buildClozeMC(word, pool, analysis = null, pickEx = null) {
  const list = exampleList(word);
  const exIdx = pickIndex(word, list.length, pickEx);
  const ex = list[exIdx] || pickExample(word);
  const c = clozeParts({ ...word, example: ex.ex });
  if (!c) return buildMC(word, pool, 'zh2en');
  const key = (s) => s.toLowerCase();
  const seen = new Set([key(c.answer)]);
  const same = pool.filter((w) => (w.type || 'word') === (word.type || 'word'));
  const unsafe = new Set((((analysis && analysis.unsafe && analysis.unsafe[word.word]) || [])[exIdx] || []).map(key));
  const extraList = (analysis && analysis.extra && analysis.extra[word.word] && analysis.extra[word.word][exIdx]) || [];
  const useExtras = extraList.length && Math.random() < EXTRA_CHANCE;
  const extras = useExtras ? shuffle(extraList).slice(0, Math.min(extraList.length, MAX_EXTRA, 1 + Math.floor(Math.random() * MAX_EXTRA))) : [];
  extras.forEach((e) => seen.add(key(e.form)));
  const others = extras.map((e) => e.form);
  const order = [...shuffle(same.length >= 4 ? same : pool), ...shuffle(pool)];
  const safeFirst = [...order.filter((w) => !unsafe.has(key(w.word))), ...order.filter((w) => unsafe.has(key(w.word)))];
  for (const w of safeFirst) {
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
  // 解題步驟要用的：這句空格的資訊（引擎算好的詞性、中文對應位置）與每個同單元選項和答案的關係
  const slot = (analysis && analysis.words && analysis.words[word.word] && analysis.words[word.word].ex[exIdx]) || null;
  const rel = {};
  if (slot && analysis.pairs) {
    for (const w of pool) {
      const r = analysis.pairs[[w.word, word.word].sort().join('|')];
      if (r) rel[w.word] = r;
    }
  }
  return { type: 'mc', word, dir: 'cloze', parts: c, options, answer: options.indexOf(c.answer), exampleZh: ex.zh,
    extras: extras.map((e) => ({ form: e.form, word: e.word, zh: e.zh, pos: e.pos })), slot, rel };
}

export function buildSpell(word, variant, pickEx = null) {
  if (variant === 'cloze') {
    const list = exampleList(word);
    const ex = list.length ? list[pickIndex(word, list.length, pickEx)] : pickExample(word);
    const c = clozeParts({ ...word, example: ex.ex });
    if (c) return { type: 'spell', variant: 'cloze', word, answer: c.answer, parts: c, exampleZh: ex.zh };
  }
  return { type: 'spell', variant: 'spell', word, answer: word.word };
}

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
      ? `<div class="q-sentence">${esc(q.parts.before)}<span class="blank"></span>${esc(q.parts.after)}</div>`  // 例句題作答時不給中文（例句翻譯只在解析與檢討出現）
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
  // 手機上按「開始」或上一題的位置剛好落在某個選項上時，那個選項會殘留觸控／焦點樣式，看起來像被選了
  if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
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
       <div class="q-sub"><span class="pos">${esc(w.pos || '')}</span><span>${n} 個字母</span></div>`
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
  if (q.dir === 'cloze') {
    const hit = pool.find((w) => { const c = clozeParts(w); return c && c.answer.toLowerCase() === String(chosen).toLowerCase(); });
    if (hit) return hit;
    // 課外選項：不在這個單元的字，意思與詞性存在題目裡
    const x = (q.extras || []).find((e) => String(e.form).toLowerCase() === String(chosen).toLowerCase());
    return x ? { word: x.word, zh: x.zh, pos: x.pos, type: 'word' } : undefined;
  }
  return pool.find((w) => w.word === chosen);
}

// 錯誤原因（看學生選到／拼成的字和正確的字是什麼關係，不是一律說「意思混淆」）：
//   形近混淆：兩個字拼法很像（compelling／compiling、adapt／adopt）
//   意思相近：兩個字中文意思重疊（big／large），差在用法和搭配
//   詞性不合：例句題空格要形容詞，卻選了名詞（compelling／validity）
//   句意不合：例句題選的字放在這句不合適（詞性一樣、意思對不上）
//   意思混淆：拼字題拼成清單裡的另一個字
//   詞形錯誤（字對了但形式不對）、拼字錯誤（差幾個字母）、不熟悉、未作答
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

// 拼法很像：兩個字的差異不到三分之一（至少容許 2 個字母），或開頭有 5 個字母相同
function lookAlike(a, b) {
  const x = lettersOf(a.word), y = lettersOf(b.word);
  if (x.length < 4 || y.length < 4 || x === y) return false;
  let p = 0;
  while (p < x.length && x[p] === y[p]) p++;
  return p >= 5 || editDistance(x, y) <= Math.max(2, Math.floor(Math.max(x.length, y.length) / 3));
}

// 詞性：從 pos 欄（n.、v.、adj.、adv.、v./n.…）讀出中文名稱；片語另外算
const POS_NAME = { n: '名詞', v: '動詞', vt: '動詞', vi: '動詞', adj: '形容詞', a: '形容詞', adv: '副詞', prep: '介系詞', conj: '連接詞', pron: '代名詞', phr: '片語', ph: '片語' };
function posNames(w) {
  if (w.type === 'phrase') return ['片語'];
  return [...new Set(String(w.pos || '').toLowerCase().split(/[^a-z]+/).filter((t) => POS_NAME[t]).map((t) => POS_NAME[t]))];
}

// 選擇題：依學生選到的字（other）和正確的字（w）的關係分類
function classifyChoice(w, other, cloze) {
  if (!other) return cloze ? '句意不合' : '不熟悉';
  if (lookAlike(w, other)) return '形近混淆';
  if (sameMeaning(w.zh, other.zh)) return '意思相近';
  if (cloze) {
    const a = posNames(w), b = posNames(other);
    if (a.length && b.length && !a.some((x) => b.includes(x))) return '詞性不合';
    return '句意不合';
  }
  return '不熟悉';
}

export function classifyError(q, chosen, pool = []) {
  if (chosen == null || String(chosen).trim() === '') return '未作答';
  if (q.type === 'mc') return classifyChoice(q.word, chosenWord(q, chosen, pool), q.dir === 'cloze');
  const typed = lettersOf(chosen);
  const ans = lettersOf(q.answer);
  const base = lettersOf(q.word.word);
  if (!typed) return '未作答';
  if (typed !== ans && (typed === base || (ans.length > 3 && stem(typed) === stem(ans)))) return '詞形錯誤';
  const other = pool.find((w) => w.word !== q.word.word && lettersOf(w.word) === typed);
  if (other) return lookAlike(q.word, other) ? '形近混淆' : sameMeaning(q.word.zh, other.zh) ? '意思相近' : '意思混淆';
  if (editDistance(typed, ans) <= Math.max(1, Math.floor(ans.length / 4))) return '拼字錯誤';
  return '不熟悉';
}

// 針對這一題的說明（寫出兩個字各是什麼意思、差在哪裡）；沒有更具體的說法時回傳空字串，改用 ERR_TIPS
function errDetail(err, w, other) {
  if (!other || other.word === w.word) return '';
  const a = `${other.word}（${other.zh}）`, b = `${w.word}（${w.zh}）`;
  if (err === '形近混淆') return `${other.word} 和 ${w.word} 拼法很像，意思不同：${a}；${b}`;
  if (err === '意思相近') return `${a} 和 ${b} 意思接近，這題要的是 ${w.word}，看例句記住它的用法和搭配`;
  if (err === '詞性不合') return `空格需要${posNames(w).join('／')}，你選的 ${other.word} 是${posNames(other).join('／')}（${other.zh}）`;
  if (err === '句意不合') return `這句要的是「${w.zh}」的 ${w.word}；你選的 ${other.word} 是「${other.zh}」，放在這裡不合適`;
  if (err === '意思混淆') return `你拼成清單裡的另一個字 ${a}；這題要的是 ${b}`;
  return '';
}

// 逐題檢討用：從紀錄（題型、學生的答案）找出選到的字，重新判斷錯誤原因並寫出說明。
// 舊紀錄的選擇題一律記成「意思混淆」，這裡也會改成更準確的分類。
export function errorOf(d, pool = []) {
  const w = pool.find((x) => x.word === d.word);
  const yours = String(d.yours || '').trim();
  if (!w) return { err: d.err || '', tip: ERR_TIPS[d.err] || '' };
  if (!yours) return { err: '未作答', tip: ERR_TIPS.未作答 };
  const dir = d.kind === '英→中' ? 'en2zh' : d.kind === '例句選字' ? 'cloze' : d.kind === '中→英' ? 'zh2en' : '';
  if (!dir) return { err: d.err || '', tip: errDetail(d.err, w, pool.find((x) => x.word !== w.word && lettersOf(x.word) === lettersOf(yours))) || ERR_TIPS[d.err] || '' };
  const other = chosenWord({ dir, extras: d.extras }, yours, pool);
  const err = classifyChoice(w, other && other.word !== w.word ? other : null, dir === 'cloze');
  return { err, tip: errDetail(err, w, other) || ERR_TIPS[err] || '' };
}

export const ERR_TIPS = {
  形近混淆: '兩個字拼法很像，意思卻不同，分開記',
  意思相近: '兩個字意思接近，差在用法和搭配，看例句裡哪個字和前後文搭得起來',
  詞性不合: '先看空格需要什麼詞性，再選意思對的字',
  句意不合: '選的字放在這句不合適，先讀懂整句在說什麼，再找意思對得上的字',
  意思混淆: '這兩個字容易搞混，對照一下各自的意思和例句',
  詞形錯誤: '字選對了，注意句子需要的形式（時態、單複數、詞性變化）',
  拼字錯誤: '意思想對了，拼字再檢查一次',
  不熟悉: '這個字還不熟，多看幾次例句加深印象',
  未作答: '這題沒有作答，先記住正確答案',
};

// 例句選字題的解題步驟（引擎 tools/brain/brain.py 的 walkthrough）：先懂題意，再逐一看選項，最後篩出答案。
// 需要錯誤分析引擎的結果（q.slot）；沒有就回空字串，照舊只顯示錯誤原因
const NEED_NAME = { adj: '形容詞', n: '名詞', v: '動詞', adv: '副詞', prep: '介系詞', phr: '片語' };
const firstMeaning = (w) => {
  const m = meaningsOf(w.zh);
  return m.find((x) => !x.includes('⋯')) || (m[0] || '').replace(/⋯/g, '');
};
function walkthroughHTML(q, chosen, pool) {
  const sl = q.slot;
  const zh = q.exampleZh || '';
  if (!sl || !zh) return '';
  const span = Array.isArray(sl.span) ? sl.span : null;
  const ask = span ? `${zh.slice(0, span[0])}＿＿${zh.slice(span[1])}` : zh;
  const need = NEED_NAME[sl.need] || '';
  const items = q.options.map((opt) => {
    const ok = opt === q.options[q.answer];
    const w = ok ? q.word : chosenWord(q, opt, pool);
    const picked = String(opt).toLowerCase() === String(chosen || '').toLowerCase();
    let why = '';
    if (ok) why = '詞性和意思都符合';
    else if (!w) why = '意思不合';
    else {
      const names = posNames(w);
      const r = q.rel && q.rel[w.word];
      if (need && sl.need !== 'phr' && names.length && !names.includes(need)) why = `詞性不合：它是${names.join('／')}，這裡需要${need}`;
      else if (r === 'syn') why = `意思接近，但這句習慣用 ${q.word.word}`;
      else if (r === 'family' || r === 'spell' || r === 'sound') why = `${{ family: '和答案同字根', spell: '和答案拼法很像', sound: '和答案唸起來很像' }[r]}，但意思是「${w.zh}」`;
      else if (span && firstMeaning(w)) why = `意思不合：放進去變成「${zh.slice(0, span[0])}【${firstMeaning(w)}】${zh.slice(span[1])}」`;
      else why = '意思不合：放進去句子說不通';
    }
    const zhText = w ? `<span class="wt-zh">${esc(w.zh || '')}</span>` : '';
    return `<li class="wt-opt${ok ? ' ok' : ''}${picked ? ' picked' : ''}"><span class="wt-mark" aria-hidden="true">${ok ? '✓' : '✗'}</span><b class="en">${esc(opt)}</b>${zhText}${picked && !ok ? '<span class="wt-you">你選的</span>' : ''}<span class="wt-why">${esc(why)}</span></li>`;
  });
  return `<div class="wt"><p class="wt-step"><span class="wt-n">1</span>這句在說：「${esc(ask)}」</p>`
    + (sl.say ? `<p class="wt-step"><span class="wt-n">2</span>${esc(sl.say)}</p>` : '')
    + `<p class="wt-step"><span class="wt-n">${sl.say ? 3 : 2}</span>逐一看選項：</p><ul class="wt-list">${items.join('')}</ul>`
    + `<p class="wt-step wt-end">所以答案是 <b class="en">${esc(q.options[q.answer])}</b>（${esc(q.word.zh)}）</p></div>`;
}

// 回傳 { html, text, err }：html 顯示在題目下方，text 用在總成績單與試算表，err 是錯誤類型
export function explainWrong(q, chosen, pool = []) {
  const w = q.word;
  const err = classifyError(q, chosen, pool);
  const picked = q.type === 'mc' ? chosenWord(q, chosen, pool) : pool.find((x) => x.word !== w.word && lettersOf(x.word) === lettersOf(chosen || ''));
  const detail = errDetail(err, w, picked);
  const lines = [`<p class="xp-tip"><span class="xp-tag">${esc(err)}</span>${esc(detail || ERR_TIPS[err] || '')}</p>`];
  const text = [];
  lines.push(`<div class="xp-main"><span class="xp-word en">${esc(w.word)}</span><span class="pos">${esc(w.pos || '')}</span><span class="xp-zh">${esc(w.zh)}</span></div>`);
  text.push(`〔${err}〕${w.word}：${w.zh}`);
  if (q.type === 'mc') {
    const other = picked;
    if (!detail && other && other.word !== w.word) {
      const msg = q.dir === 'en2zh'
        ? `你選的「${esc(chosen)}」是 <b class="en">${esc(other.word)}</b> 的意思`
        : `你選的 <b class="en">${esc(chosen)}</b> 意思是「${esc(other.zh)}」`;
      lines.push(`<p class="xp-yours">${msg}</p>`);
      text.push(q.dir === 'en2zh' ? `你選的是 ${other.word} 的意思` : `你選的 ${chosen} 是「${other.zh}」`);
    }
  } else {
    const d = spellDiff(chosen, q.answer);
    const typed = lettersOf(chosen || '');
    const mark = typed ? diffAnswer(typed, [lettersOf(q.answer) || q.answer]) : null;
    lines.push(`<p class="xp-yours">${typed ? `你拼成 <b class="en">${mark.yoursHTML}</b>，正確是 <b class="en">${mark.correctHTML}</b>` : '沒有作答'}${typed && d ? `・${esc(d)}` : ''}</p>`);
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
  if (q.type === 'mc' && q.dir === 'cloze') lines.push(walkthroughHTML(q, chosen, pool));
  return { html: `<div class="explain xp slide-in"><div class="xp-head">${icon.bulb} 解析</div>${lines.join('')}</div>`, text: text.join('｜'), err };
}
