// 可重複使用的題目元件：選擇題 (renderMC) 與字母框拼字 (renderSpell)。
// feedback=true：練習模式，作答後立即顯示對錯；false：正式測驗，只記錄作答。
import { esc, shuffle, clozeParts, lettersOf, exampleHTML, plainExample, pickExample, sameMeaning } from '../util.js';
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
  // 選項的形式：引擎算好的（和答案同時態、單複數：shattered → composed、depicted），四個選項詞形一致，不能靠形式猜答案；
  // null＝這句不拿它當選項（be 動詞片語遇到要看主詞的 is／was）；沒有引擎結果就用它自己例句裡的形式
  const slot = (analysis && analysis.words && analysis.words[word.word] && analysis.words[word.word].ex[exIdx]) || null;
  const shown = (slot && slot.forms) || {};
  const forms = {}; // 選項形式 → 哪個字（判斷學生選了哪個字用）
  for (const w of safeFirst) {
    if (others.length >= 3) break;
    if (w.word === word.word || shown[w.word] === null) continue;
    const p = clozeParts(w);
    const form = shown[w.word] || (p && p.answer);
    if (!form || seen.has(key(form))) continue;
    seen.add(key(form));
    forms[key(form)] = w.word;
    others.push(form);
  }
  // 句首大寫的答案，干擾選項也跟著大寫，避免一眼看出
  const cap = /^[A-Z]/.test(c.answer) && !c.before.trim();
  const fix = (s) => (cap ? s.charAt(0).toUpperCase() + s.slice(1) : s.charAt(0).toLowerCase() + s.slice(1));
  const options = shuffle([c.answer, ...others.map(fix)]);
  // 解題步驟要用的：這句空格的資訊（引擎算好的詞性、中文對應位置）與每個同單元選項和答案的關係
  const rel = {};
  const roles = {};  // 每個字詞在句子裡能當的詞性（片語也有：participate in → 動詞），用來先刪掉詞性不合的選項
  if (slot) {
    for (const w of pool) {
      const info = analysis.words[w.word];
      if (info && info.role) roles[w.word] = info.role;
      const r = analysis.pairs && analysis.pairs[[w.word, word.word].sort().join('|')];
      if (r) rel[w.word] = r;
    }
  }
  return { type: 'mc', word, dir: 'cloze', parts: c, options, answer: options.indexOf(c.answer), exampleZh: ex.zh,
    extras: extras.map((e) => ({ form: e.form, word: e.word, zh: e.zh, pos: e.pos })), slot, rel, roles, exIdx, forms };
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

// 拼字框依單字分組：放不下一行時在單字之間換行，不會把一個字拆成兩行（keep a watchful eye on）
function wordGroups(slots) {
  const groups = [[]];
  for (const s of slots) {
    if (s.sep === ' ') { groups.push([]); continue; }
    groups[groups.length - 1].push(s.letter ? '<span class="lbox"></span>' : `<span class="lsep">${esc(s.sep)}</span>`);
  }
  return groups.filter((g) => g.length).map((g) => `<span class="lword">${g.join('')}</span>`).join('');
}

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
       <div class="q-sub"><span class="pos">${esc(w.pos || '')}</span><span>${n} 個字母・開頭是 ${esc(target[0].toUpperCase())}</span></div>`
    : `<div class="q-meta">${esc(label || '看中文，拼出英文單字')}</div>
       <div class="q-prompt"><span class="zh">${esc(w.zh)}</span></div>
       <div class="q-sub"><span class="pos">${esc(w.pos || '')}</span><span>${n} 個字母・開頭是 ${esc(target[0].toUpperCase())}</span></div>`;

  const card = document.createElement('div');
  card.className = 'q-card slide-in';
  card.innerHTML = `
    <div class="q-head">${head}</div>
    <div class="spell-area">
      <div class="boxes" style="--n:${Math.max(slots.length, 6)};--long:${Math.max(6, ...String(q.answer).split(/\s+/).map((x) => x.length))}">${wordGroups(slots)}</div>
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
    const ch = String(chosen).toLowerCase();
    // 選項是變過形的（composed、depicted）：用出題時記下的對照，或引擎算好的這句選項形式找回原本的字
    const viaForm = (q.forms && q.forms[ch]) || Object.entries((q.slot && q.slot.forms) || {}).find(([, f]) => f && f.toLowerCase() === ch)?.[0];
    if (viaForm) { const w = pool.find((x) => x.word === viaForm); if (w) return w; }
    const hit = pool.find((w) => { const c = clozeParts(w); return c && c.answer.toLowerCase() === ch; });
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
// posKnown：已經用引擎算好的空格詞性確認過詞性對得上（不再用 pos 欄比；片語的 pos 欄只寫 phr.）
function classifyChoice(w, other, cloze, posKnown = false) {
  if (!other) return cloze ? '句意不合' : '不熟悉';
  if (lookAlike(w, other)) return '形近混淆';
  if (sameMeaning(w.zh, other.zh)) return '意思相近';
  if (cloze && !posKnown) {
    const a = posNames(w), b = posNames(other);
    if (a.length && b.length && !a.some((x) => b.includes(x))) return '詞性不合';
    return '句意不合';
  }
  return '不熟悉';
}

export function classifyError(q, chosen, pool = []) {
  if (chosen == null || String(chosen).trim() === '') return '未作答';
  if (q.type === 'mc') {
    const other = chosenWord(q, chosen, pool);
    // 例句選字題有引擎算好的空格詞性（q.slot.role）：選的字當不了這個詞性就是詞性不合（core 可當名詞或形容詞，但這句要名詞）
    const need = q.dir === 'cloze' && q.slot && q.slot.role;
    if (need && other && other.word !== q.word.word) {
      const codes = rolesOf(q, other);
      if (codes.length && !codes.includes(need)) return '詞性不合';
      if (codes.length) return classifyChoice(q.word, other, true, true);
    }
    return classifyChoice(q.word, other, q.dir === 'cloze');
  }
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

// ---------------- 答錯的解析：作答中（精簡）與檢討（完整解題步驟） ----------------
// 精簡（mode 'brief'，練習與測驗答錯當下）：錯誤類型＋每個選項的詞性與意思，不打斷作答節奏
// 完整（mode 'full'，交卷後逐題檢討）：1 題意 → 2 依詞性先排除 → 3 逐一看選項（附原因）→ 最後揭曉答案卡（例句與翻譯）
// 例句選字題的解題步驟需要錯誤分析引擎的結果（q.slot，tools/brain/brain.py）；沒有就只列選項與原因
const NEED_NAME = { adj: '形容詞', n: '名詞', v: '動詞', adv: '副詞', prep: '介系詞' };
const POS_CODE = { n: 'n', v: 'v', vt: 'v', vi: 'v', adj: 'adj', a: 'adj', adv: 'adv', prep: 'prep' };
// 放進翻譯句子的意思：第一個義項，保留「的」（月的小木屋，不是月小木屋）；空格後面已經有「的」就拿掉，免得變成「的的」
const fillMeaning = (w, after) => {
  const parts = shortZh(w.zh).split('；');
  const m = parts.find((x) => x && !x.includes('⋯')) || (parts[0] || '').replace(/⋯/g, ''); // 受⋯的騙；上當 → 上當
  return after === '的' && m.endsWith('的') ? m.slice(0, -1) : m;
};
// 顯示用的中文意思：最多兩個義項。7000 單字表的意思常把幾個詞性黏在一起（每年的，一年一次的每年，一年一度年刊），只取乾淨的前段
export function shortZh(zh) {
  const parts = String(zh || '').replace(/[（(]\d+[)）]/g, '；').replace(/[（(][^）)]*[）)]/g, '')
    .split(/[；;，,、]+/).map((s) => s.trim()).filter(Boolean);
  const out = [];
  for (const p of parts) {
    if (out.length >= 2) break;
    // 黏在一起的義項：「的」後面還接著兩個字以上（一年一次的每年）→ 第一個義項只留到「的」，之後的義項直接略過
    const glued = (p.length > 8 ? p.match(/^(.+?的)(?=.)/) : null) || p.match(/^(.+?的)(?=[^的]{2,}$)/);
    const s = glued ? (out.length ? '' : glued[1]) : p;
    if (s && !out.includes(s) && s.length <= 12) out.push(s);
    if (glued) break;
  }
  return out.join('；') || String(zh || '');
}
// 這個字詞在句子裡能當的詞性：引擎算好的（片語也有：participate in → 動詞），沒有就看 pos 欄
function rolesOf(q, w) {
  const r = q.roles && q.roles[w.word];
  if (r && r.length) return r;
  if (w.type === 'phrase' || /\s/.test(String(w.word).trim())) return [];
  return [...new Set(String(w.pos || '').toLowerCase().split(/[^a-z]+/).map((t) => POS_CODE[t]).filter(Boolean))];
}
const isPhrase = (w) => w.type === 'phrase' || /\s/.test(String(w.word).trim());
const roleName = (codes, phrase) => codes.map((c) => NEED_NAME[c] + (phrase ? '片語' : '')).join('／');
// 選項旁的詞性小標籤：形容詞、動詞片語…（不知道就只寫「片語」或不顯示）
const posLabel = (q, w) => { const c = rolesOf(q, w); return c.length ? roleName(c, isPhrase(w)) : (isPhrase(w) ? '片語' : ''); };

// 一個選項一列：記號（✓／✗）一欄；單字、詞性、「你選的」、意思同一行（放不下時意思整段換到下一行，對齊單字）；原因另起一行
function optionRow({ text, w, ok, picked, pos, why, whyKind }) {
  return `<li class="op${ok ? ' op-ok' : ''}${picked ? ' op-picked' : ''}">`
    + `<span class="op-mark" aria-label="${ok ? '正確' : '錯誤'}">${ok ? icon.check : icon.x}</span>`
    + `<div class="op-body"><div class="op-line"><b class="op-word en">${esc(text)}</b>`
    + (pos ? `<span class="op-pos">${esc(pos)}</span>` : '')
    + (picked && !ok ? '<span class="op-you">你選的</span>' : '')
    + (w && w.zh ? `<span class="op-zh">${esc(shortZh(w.zh))}</span>` : '')
    + `</div>${why ? `<p class="op-why why-${whyKind || 'sense'}">${esc(why)}</p>` : ''}</div></li>`;
}

// 選擇題的每個選項：對應到哪個字、詞性、對不對、是不是學生選的
function optionsOf(q, chosen, pool) {
  // 沒有選項清單（舊紀錄或測試資料）：只列學生的答案和正確答案
  const pick = (x) => (q.dir === 'en2zh' ? x.zh : q.dir === 'cloze' && q.parts ? q.parts.answer : x.word);
  const list = Array.isArray(q.options) && q.options.length ? q.options : [...new Set([String(chosen || ''), pick(q.word)].filter(Boolean))];
  const answer = Array.isArray(q.options) && q.options.length ? q.options[q.answer] : pick(q.word);
  return list.map((opt) => {
    const ok = opt === answer;
    const w = ok ? q.word : chosenWord(q, opt, pool);
    return { opt, ok, w, codes: w ? rolesOf(q, w) : [], picked: String(opt).toLowerCase() === String(chosen || '').toLowerCase() };
  });
}
// 選項列上的英文：英→中的選項是中文意思，改顯示那個字（意思放在旁邊）
const optText = (q, o) => (q.dir === 'en2zh' && o.w ? o.w.word : o.opt);
const simpleRows = (q, chosen, pool) => `<ul class="op-list">${optionsOf(q, chosen, pool).map((o) => optionRow({ text: optText(q, o), w: o.w, ok: o.ok, picked: o.picked, pos: o.w ? posLabel(q, o.w) : '' })).join('')}</ul>`;

// 答案卡：正確的字、詞性、意思、這題的例句（答案標亮）與翻譯；另外附一句沒考過的例句
function answerCard(q, exEn, exZh, extra) {
  const w = q.word;
  return `<div class="xp-answer"><div class="xp-answer-label">正確答案</div>`
    + `<div class="xp-main"><span class="xp-word en">${esc(w.word)}</span>${w.pos ? `<span class="pos">${esc(w.pos)}</span>` : ''}<span class="xp-zh">${esc(w.zh || '')}</span></div>`
    + (exEn ? `<p class="xp-ex en">${exampleHTML(exEn)}</p>${exZh ? `<p class="xp-exzh">${esc(exZh)}</p>` : ''}` : '')
    + (extra ? `<div class="xp-more"><div class="xp-more-label">再看一句</div><p class="xp-ex en">${exampleHTML(extra.ex)}</p>${extra.zh ? `<p class="xp-exzh">${esc(extra.zh)}</p>` : ''}</div>` : '')
    + '</div>';
}

// 例句選字題的完整解題步驟（1 題意、2 依詞性排除、3 逐一看選項）；沒有引擎結果時只有「逐一看選項」
function walkthroughHTML(q, chosen, pool) {
  const sl = q.slot;
  const zh = q.exampleZh || '';
  const span = sl && zh && Array.isArray(sl.span) ? sl.span : null;
  // 空格要的詞性：引擎算好的；沒有分析結果時，答案只有一種詞性（compelling 只當形容詞）就用它，好讓說明和錯誤類型標籤一致
  const own = rolesOf(q, q.word);
  const need = sl && sl.role && NEED_NAME[sl.role] ? sl.role : (!sl && own.length === 1 ? own[0] : null);
  const opts = optionsOf(q, chosen, pool).map((o) => ({ ...o, posOut: !o.ok && !!need && o.codes.length > 0 && !o.codes.includes(need) }));
  const steps = [];
  if (sl && zh) steps.push(`這句在說：「${span ? `${zh.slice(0, span[0])}＿＿${zh.slice(span[1])}` : zh}」`);
  if (need) {
    const role = isPhrase(q.word) ? `空格需要一個${NEED_NAME[need]}片語` : ((sl && sl.say) || `空格需要${NEED_NAME[need]}`);
    const out = opts.filter((o) => o.posOut);
    steps.push(out.length
      ? `${role}。根據詞性，這題可以先排除 ${out.map((o) => `${o.opt}（${roleName(o.codes, isPhrase(o.w))}）`).join('、')}，再看剩下的選項意思合不合`
      : `${role}。選項的詞性都對得上，要從意思判斷`);
  }
  const rows = opts.map((o) => {
    let why = '', kind = 'sense';
    if (o.ok) { why = need ? '詞性和意思都符合' : '意思符合'; kind = 'ok'; }
    else if (!o.w) why = '意思不合';
    else if (o.posOut) { why = `詞性不合：它是${roleName(o.codes, isPhrase(o.w))}，這裡需要${NEED_NAME[need]}`; kind = 'pos'; }
    else {
      const r = q.rel && q.rel[o.w.word];
      if (r === 'syn') why = `意思接近，但這句習慣用 ${q.word.word}`;
      else if (r === 'family' || r === 'spell' || r === 'sound') why = `${{ family: '和答案同字根', spell: '和答案拼法很像', sound: '和答案唸起來很像' }[r]}，但意思是「${shortZh(o.w.zh)}」`;
      else if (span && fillMeaning(o.w, zh[span[1]])) why = `意思不合：放進去變成「${zh.slice(0, span[0])}【${fillMeaning(o.w, zh[span[1]])}】${zh.slice(span[1])}」`;
      else why = '意思不合：放進去句子說不通';
    }
    return optionRow({ text: o.opt, w: o.w, ok: o.ok, picked: o.picked, pos: o.w ? posLabel(q, o.w) : '', why: `→ ${why}`, whyKind: kind });
  });
  const n = steps.length + 1;
  return `<ol class="wt">${steps.map((s, i) => `<li class="wt-step"><span class="wt-n">${i + 1}</span><span>${esc(s)}</span></li>`).join('')}`
    + `<li class="wt-step"><span class="wt-n">${n}</span><span>逐一看選項：</span></li></ol><ul class="op-list op-full">${rows.join('')}</ul>`;
}

// 回傳 { html, text, err }：html 顯示在題目下方，text 用在總成績單與試算表，err 是錯誤類型
// mode：'brief'（作答中，預設）或 'full'（逐題檢討）
export function explainWrong(q, chosen, pool = [], mode = 'brief') {
  const w = q.word;
  const err = classifyError(q, chosen, pool);
  const picked = q.type === 'mc' ? chosenWord(q, chosen, pool) : pool.find((x) => x.word !== w.word && lettersOf(x.word) === lettersOf(chosen || ''));
  const detail = errDetail(err, w, picked);
  const text = [`〔${err}〕${w.word}：${w.zh}`];
  const clozeMC = q.type === 'mc' && q.dir === 'cloze';
  const clozeQ = clozeMC || (q.type === 'spell' && q.variant === 'cloze');
  const exEn = clozeQ ? `${q.parts.before}[${q.parts.answer}]${q.parts.after}` : w.example;
  const exZh = clozeQ ? q.exampleZh : w.exampleZh;
  if (exEn) text.push(plainExample(exEn));
  const head = `<div class="xp-head">${icon.bulb} 解析<span class="xp-tag">${esc(err)}</span></div>`;
  const parts = [];
  // 拼字題：標出拼錯的字母
  if (q.type !== 'mc') {
    const d = spellDiff(chosen, q.answer);
    const typed = lettersOf(chosen || '');
    const mark = typed ? diffAnswer(typed, [lettersOf(q.answer) || q.answer]) : null;
    parts.push(`<p class="xp-yours">${typed ? `你拼成 <b class="en">${mark.yoursHTML}</b>，正確是 <b class="en">${mark.correctHTML}</b>` : '沒有作答'}${typed && d ? `・${esc(d)}` : ''}</p>`);
    if (d) text.push(d);
  }
  if (mode !== 'full') {
    // 作答中：每個選項的詞性與意思（正確的打勾），不寫解題步驟
    parts.push(q.type === 'mc' ? simpleRows(q, chosen, pool) : `<ul class="op-list">${optionRow({ text: w.word, w, ok: true, pos: posLabel(q, w) })}</ul>`);
    return { html: `<div class="explain xp xp-brief slide-in">${head}${parts.join('')}</div>`, text: text.join('｜'), err };
  }
  // 檢討：解題步驟在前，最後才揭曉答案卡
  if (clozeMC) {
    // 沒有錯誤分析結果時解題步驟只有「逐一看選項」：先用一句話說明錯在哪
    if (!q.slot && rolesOf(q, w).length !== 1 && (detail || ERR_TIPS[err])) parts.push(`<p class="xp-tip">${esc(detail || ERR_TIPS[err])}</p>`);
    parts.push(walkthroughHTML(q, chosen, pool));
  }
  else {
    if (detail || ERR_TIPS[err]) parts.push(`<p class="xp-tip">${esc(detail || ERR_TIPS[err])}</p>`);
    if (q.type === 'mc') parts.push(simpleRows(q, chosen, pool));
  }
  const list = (Array.isArray(w.examples) && w.examples.length ? w.examples : [{ ex: w.example, zh: w.exampleZh }]).filter((e) => e && e.ex);
  const extra = list.find((e) => plainExample(e.ex) !== plainExample(exEn || ''));
  parts.push(answerCard(q, exEn, exZh, extra));
  return { html: `<div class="explain xp xp-full slide-in">${head}${parts.join('')}</div>`, text: text.join('｜'), err };
}

// 逐題檢討：從作答紀錄（details 的一筆）重建題目，好用完整版解析（explainWrong 的 'full'）。
// 新紀錄有選項與例句編號；舊紀錄沒有選項，就用「你的答案、正確答案」兩個選項。analysis：這個單元的錯誤分析結果（可省略）
export function questionFromRecord(d, pool = [], analysis = null) {
  const word = pool.find((x) => x.word === d.word);
  if (!word) return null;
  const kind = String(d.kind || '');
  const dir = kind === '英→中' ? 'en2zh' : kind === '例句選字' ? 'cloze' : kind === '中→英' ? 'zh2en' : '';
  const m = String(d.exampleEn || '').match(/^(.*?)\[([^\]]+)\](.*)$/);
  const parts = m ? { before: m[1], answer: m[2], after: m[3] } : null;
  if (!dir) {
    const cloze = kind === '例句拼寫' && parts;
    return { type: 'spell', variant: cloze ? 'cloze' : 'spell', word, answer: String(d.correct || word.word), parts: cloze ? parts : undefined, exampleZh: d.exampleZh || '' };
  }
  if (dir === 'cloze' && !parts) return null;
  const correct = String(d.correct || '');
  const options = Array.isArray(d.options) && d.options.includes(correct) ? d.options.slice() : [...new Set([String(d.yours || ''), correct].filter(Boolean))];
  const q = { type: 'mc', word, dir, options, answer: options.indexOf(correct), parts, exampleZh: d.exampleZh || '', extras: d.extras || [] };
  // 考的是第幾句：新紀錄有存；舊紀錄用例句比對找回來（才接得上錯誤分析的解題步驟）
  let exIdx = Number.isInteger(d.exIdx) ? d.exIdx : -1;
  if (exIdx < 0 && parts) exIdx = exampleList(word).findIndex((e) => plainExample(e.ex) === plainExample(d.exampleEn));
  if (dir === 'cloze' && analysis && analysis.words && analysis.words[word.word] && exIdx >= 0) {
    q.slot = analysis.words[word.word].ex[exIdx] || null;
    q.exIdx = exIdx;
    q.roles = {}; q.rel = {};
    for (const w of pool) {
      const info = analysis.words[w.word];
      if (info && info.role) q.roles[w.word] = info.role;
      const r = analysis.pairs && analysis.pairs[[w.word, word.word].sort().join('|')];
      if (r) q.rel[w.word] = r;
    }
  }
  return q;
}
