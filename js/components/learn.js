// 句型練習（循序漸進版）：每個句型一段，段的順序隨機；每段三步：
//   ① 認識：用途＋結構（公式拆成幾塊，每塊一個顏色）→ 例句（一次一句，顏色和公式一一對應；可以自己點出每一塊）→ 易錯提醒
//   ② 檢測：1～2 題，作答後馬上對答案，不計分
//   ③ 驗收：題庫抽這個句型的 3～4 題，計分；這一段做完就看結果
// 全部句型做完才交卷。認識卡的模式（邊看邊找／直接看說明）由學生選一次，存在 prefs（正式版存在學生帳本）。
// 版面：上方整體進度＋這一段的三個步驟；主要按鈕固定在下方（手機拇指按得到）；步驟之間依前進／後退方向滑動。
//
// guide（每個句型一份）：{ tag, name, use, parts: [{ t, eg }], examples: [{ en: 'Japan is {0:ten times} {1:the size} {2:of} {3:Taiwan}.', zh }], pitfall, checks: [題庫格式的題目] }
import { esc, shuffle, reducedMotion } from '../util.js';
import { icon } from '../icons.js';
import { flattenPattern, renderChoiceCard, renderFillCard, renderApplyCard, judge, applyScore, reviewCardHTML } from './items.js';

const PER_SECTION = [2, 3]; // 每段驗收隨機抽 2～3 題（題庫不夠就有幾題考幾題）
const EXAMPLES_SHOWN = 3; // 每段認識卡隨機挑幾句例句
// 輕震一下（只在使用者真的點過畫面之後；瀏覽器規定沒點過不能震）
const buzz = () => { try { if (navigator.vibrate && !reducedMotion() && (!navigator.userActivation || navigator.userActivation.hasBeenActive)) navigator.vibrate(10); } catch { /* 不支援就算了 */ } };

// 例句標記：{0:ten times} → [{ text, part }]；其他文字 part = -1
export function parseExample(en) {
  const out = [];
  const re = /\{(\d+):([^}]*)\}/g;
  let last = 0, m;
  while ((m = re.exec(en))) {
    if (m.index > last) out.push({ text: en.slice(last, m.index), part: -1 });
    out.push({ text: m[2], part: Number(m[1]) });
    last = re.lastIndex;
  }
  if (last < en.length) out.push({ text: en.slice(last), part: -1 });
  return out;
}

function buildSections(guides, items) {
  const bank = flattenPattern(items);
  const tags = [...new Set(bank.map((q) => q.tag).filter(Boolean))];
  const byTag = Object.fromEntries((guides || []).map((g) => [g.tag, g]));
  return shuffle(tags).map((tag) => {
    const g = byTag[tag] || { tag, name: tag, parts: [], examples: [] };
    const quiz = shuffle(bank.filter((q) => q.tag === tag)).slice(0, PER_SECTION[0] + Math.floor(Math.random() * (PER_SECTION[1] - PER_SECTION[0] + 1)));
    const checks = flattenPattern(g.checks || []).map((q, i) => ({ ...q, id: `c${i}`, tag: '' }));
    return { tag, g, quiz, checks, examples: shuffle(g.examples || []).slice(0, EXAMPLES_SHOWN) };
  }).filter((s) => s.quiz.length);
}

// prefs：{ get(k), set(k, v) }（預覽用 localStorage；正式版接學生帳本）
// grade（可省略）：async (q, yours) => { got, q }：正式測驗的答案不在學生端，每段做完交給伺服器批改（第一次作答就鎖定），回傳得分與含答案的完整題目
// sections（可省略）：接續作答時沿用原本抽好的段落
export function mountLearn(stage, { guides, items, prefs, onFinish, grade = null, sections: saved = null }) {
  const sections = saved || buildSections(guides, items);
  const graded = {}; // 題目 id → { got, q }：已經批改（伺服器或本機）
  const answers = {}; // 題目 id → 學生的答案（驗收題）
  const states = {}; // 題目 id → 畫面狀態（回上一題時還原）
  let si = 0;
  let pos = 0; // 目前在整份練習的第幾步（決定滑動方向）
  const modeOf = () => prefs.get('learnMode');

  // 整體進度：每段 3 步（認識、檢測、驗收）
  const progress = (step) => (si * 3 + Math.min(step, 3)) / (sections.length * 3);
  // 上方進度、下方按鈕列建立一次就一直留著，換步驟時只更新內容（進度條才會平順地長，不會整個重畫閃一下）
  const paintTop = (step) => {
    const s = sections[si];
    const p = progress(step) * 100;
    const prog = $('.ln-prog');
    prog.setAttribute('aria-valuenow', String(Math.round(p)));
    prog.firstElementChild.style.setProperty('--w', `${p.toFixed(1)}%`);
    // 換句型時標題淡出淡入；同一個句型就不動
    const where = $('.ln-where'), whereHTML = `<span class="ln-k">句型 ${si + 1} / ${sections.length}</span><b>${esc(s.g.name || s.tag)}</b>`;
    if (where.dataset.si !== String(si)) {
      where.dataset.si = String(si); where.innerHTML = whereHTML;
      if (!reducedMotion()) { where.classList.remove('swap'); void where.offsetWidth; where.classList.add('swap'); }
    }
    // 三個步驟只改狀態（顏色會漸變），不整排重畫
    const steps = $('.ln-steps');
    if (!steps.children.length) steps.innerHTML = ['認識', '檢測', '驗收'].map((t, i) => `<li><span class="ln-st-n">${i + 1}</span><span class="ln-st-ok">${icon.check}</span><span class="ln-st-t">${t}</span></li>`).join('');
    [...steps.children].forEach((li, i) => {
      li.className = i < step ? 'done' : i === step ? 'now' : '';
      if (i === step) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
    });
  };
  // 換畫面：舊內容快速淡出（疊在原處），新內容依方向輕輕淡入
  const show = (step, body, bar, dir = 1) => {
    pos += dir;
    if (!$('.ln-shell')) {
      stage.innerHTML = `<div class="ln-shell"><div class="ln-top"><div class="ln-prog" role="progressbar" aria-label="整體進度" aria-valuemin="0" aria-valuemax="100"><i></i></div><div class="ln-where"></div><ol class="ln-steps" aria-label="這個句型的進度"></ol></div><div class="ln-view"></div><div class="ln-bar"></div></div>`;
    }
    paintTop(step);
    const view = $('.ln-view');
    const calm = reducedMotion();
    const oldH = view.offsetHeight; // 要在舊內容改成淡出（不佔空間）之前量
    [...view.children].forEach((old) => {
      if (calm || dir === 0) { old.remove(); return; }
      old.classList.remove('in-r', 'in-l'); old.classList.add('leaving', dir > 0 ? 'out-l' : 'out-r'); old.setAttribute('aria-hidden', 'true'); old.inert = true;
      setTimeout(() => old.remove(), 220);
    });
    const next = document.createElement('div');
    next.className = `ln-body${calm || dir === 0 ? '' : dir > 0 ? ' in-r' : ' in-l'}`;
    next.innerHTML = body;
    view.append(next);
    // 內容高度不同時，外框高度平順地伸縮（不要瞬間跳）
    if (!calm && oldH) {
      const newH = next.offsetHeight;
      if (Math.abs(newH - oldH) > 4) {
        view.style.height = `${oldH}px`; void view.offsetHeight;
        view.classList.add('resizing'); view.style.height = `${newH}px`;
        clearTimeout(view._t); view._t = setTimeout(() => { view.classList.remove('resizing'); view.style.height = ''; }, 420);
      }
    }
    const b = $('.ln-bar');
    b.className = `ln-bar${calm || dir === 0 ? '' : ' swap'}`; b.innerHTML = bar || ''; b.hidden = !bar;
    // 只有捲到下面時才回到頂端（不要每一步都捲動）
    const topY = stage.getBoundingClientRect().top + window.scrollY - 80;
    if (window.scrollY > topY + 40) window.scrollTo({ top: Math.max(0, topY), behavior: 'auto' });
  };
  // 找元素時跳過正在淡出的舊畫面（換步驟時新舊內容會短暫重疊）
  const $$ = (sel) => [...stage.querySelectorAll(sel)].filter((el) => !el.closest('.leaving'));
  const $ = (sel) => $$(sel)[0] || null;
  const on = (sel, fn) => { const el = $(sel); if (el) el.addEventListener('click', fn); return el; };

  // ---------- 第一次：選認識卡的模式 ----------
  function chooseMode(then) {
    stage.innerHTML = `<div class="ln-body in-r"><div class="ln-card ln-choose">
      <h2>看句型說明時，你想要…</h2>
      <p class="muted">之後可以在說明卡右上角隨時切換。</p>
      <div class="ln-modes">
        <button type="button" class="ln-mode" data-m="find"><span class="ln-mode-ic">${icon.target}</span><b>邊看邊找</b><span>例句先不上色，用手指把公式的每一塊劃起來，劃對就亮起來</span></button>
        <button type="button" class="ln-mode" data-m="read"><span class="ln-mode-ic">${icon.book}</span><b>直接看說明</b><span>例句直接標好顏色，看完就往下</span></button>
      </div>
    </div></div>`;
    stage.querySelectorAll('[data-m]').forEach((b) => b.addEventListener('click', () => { prefs.set('learnMode', b.dataset.m); then(); }));
  }

  const modeSwitch = () => `<button type="button" class="ln-switch" data-switch aria-label="切換成${modeOf() === 'find' ? '直接看說明' : '邊看邊找'}">${modeOf() === 'find' ? icon.target : icon.book}<span>${modeOf() === 'find' ? '邊看邊找' : '直接看說明'}</span></button>`;

  // ---------- ① 認識 ----------
  function learn(step = 0, ex = 0, dir = 1) {
    if (!sections[si].examples.length) { check(0); return; } // 這個句型還沒有說明：直接檢測／驗收
    if (!modeOf()) { chooseMode(() => learn(step, ex, dir)); return; }
    const s = sections[si], g = s.g;
    const seenKey = `learnSeen:${s.tag}`;
    const parts = g.parts || [];
    const head = `<div class="ln-card-h"><span class="ln-sub">${['用途與結構', '看例句', '容易錯的地方'][step]}</span>${modeSwitch()}</div>`;
    let body = '', bar = '';
    if (step === 0) {
      body = `${g.use ? `<p class="ln-use">${esc(g.use)}</p>` : ''}
        ${parts.length ? `<div class="ln-formula" role="list" aria-label="句型結構">${parts.map((p, i) => `<div class="ln-part c${i % 5}" role="listitem" style="--d:${i * 70}ms"><b>${esc(p.t)}</b>${p.eg ? `<span class="en">${esc(p.eg)}</span>` : ''}</div>`).join('<span class="ln-plus" aria-hidden="true">+</span>')}</div>` : ''}`;
      bar = `${prefs.get(seenKey) ? '<button type="button" class="btn ghost" data-skip>已經會了，直接檢測</button>' : ''}<button type="button" class="btn primary" data-next>看例句 ${icon.arrowR}</button>`;
    } else if (step === 1) {
      const e = s.examples[ex];
      if (!e) { learn(2, 0, dir); return; }
      body = exampleHTML(e, parts, ex);
      bar = `<button type="button" class="btn ghost" data-prev>${icon.back}</button><button type="button" class="btn primary" data-next ${modeOf() === 'find' ? 'disabled' : ''}>${ex < s.examples.length - 1 ? `下一句 ${icon.arrowR}` : `下一步 ${icon.arrowR}`}</button>`;
    } else {
      body = g.pitfall ? `<div class="ln-pit"><b>${icon.alert} 容易錯的地方</b><p>${esc(g.pitfall)}</p></div>` : '<p class="ln-use">看懂了嗎？接著用 1～2 題確認一下。</p>';
      bar = `<button type="button" class="btn ghost" data-prev>${icon.back}</button><button type="button" class="btn primary" data-next>開始檢測 ${icon.arrowR}</button>`;
    }
    show(0, `<div class="ln-card ln-learn">${head}${body}</div>`, bar, dir);
    on('[data-switch]', () => { prefs.set('learnMode', modeOf() === 'find' ? 'read' : 'find'); learn(step, ex, 0); });
    on('[data-skip]', () => check(0));
    on('[data-prev]', () => (step === 1 ? (ex > 0 ? learn(1, ex - 1, -1) : learn(0, 0, -1)) : learn(1, s.examples.length - 1, -1)));
    const next = on('[data-next]', () => {
      if (step === 0) learn(1, 0);
      else if (step === 1) learn(ex < s.examples.length - 1 ? 1 : 2, ex + 1);
      else { prefs.set(seenKey, 1); check(0); }
    });
    if (step === 1) wireExample(next);
  }

  // 一句例句：直接看＝整句上色；邊看邊找＝依序把公式的每一塊劃起來
  function exampleHTML(e, parts, ex) {
    const segs = parseExample(e.en);
    const find = modeOf() === 'find';
    const pieces = [];
    segs.forEach((sg, k) => {
      // 區塊裡的字也一個一個拆開（劃記以字為單位），外觀跟一般字一樣，不先透露哪幾個字是一塊
      if (sg.part >= 0) { pieces.push(`<span class="ln-seg${find ? '' : ` lit c${sg.part % 5}`}" data-part="${sg.part}" data-k="${k}">${sg.text.split(/(\s+)/).map((w) => (/^\s+$/.test(w) || !w ? esc(w) : `<span class="ln-w">${esc(w)}</span>`)).join('')}</span>`); return; }
      let text = sg.text;
      // 緊接在標記後面的標點（例如句號）跟前一塊黏在一起，不要自己掉到下一行
      const p = /^[.,!?;:'"”’)]+/.exec(text);
      if (p && pieces.length) { pieces.push(`<span class="nowrap">${pieces.pop()}${esc(p[0])}</span>`); text = text.slice(p[0].length); }
      text.split(/(\s+)/).forEach((w) => pieces.push(/^\s+$/.test(w) || !w ? esc(w) : `<span class="ln-w">${esc(w)}</span>`));
    });
    const order = [...new Set(segs.filter((x) => x.part >= 0).map((x) => x.part))];
    const n = sections[si].examples.length;
    return `<div class="ln-ex-k"><span>例句 ${ex + 1} / ${n}</span><span class="ln-exdots" aria-hidden="true">${Array.from({ length: n }, (_, i) => `<i class="${i === ex ? 'on' : i < ex ? 'done' : ''}"></i>`).join('')}</span></div>
      ${find ? '<p class="ln-ask" data-ask aria-live="polite"></p>' : ''}
      <p class="ln-sent en${find ? ' finding' : ''}" data-order="${order.join(',')}">${pieces.join('')}</p>
      <div data-legend>${find ? '' : legendHTML(parts, order)}</div>
      <div class="ln-ex-foot">
        ${e.zh ? `<button type="button" class="ln-zh-btn" data-zh aria-expanded="false">看中文翻譯</button>` : '<span></span>'}
        ${find ? '<button type="button" class="ln-reveal" data-reveal>直接顯示</button>' : ''}
      </div>
      ${e.zh ? `<p class="ln-zh" data-zh-text hidden>${esc(e.zh)}</p>` : ''}`;
  }
  const legendHTML = (parts, order) => `<div class="ln-legend">${order.map((p) => `<span class="c${p % 5}">${esc((parts[p] || {}).t || '')}</span>`).join('')}</div>`;

  function wireExample(next) {
    const sent = $('.ln-sent');
    const parts = sections[si].g.parts || [];
    const order = sent.dataset.order ? sent.dataset.order.split(',').map(Number) : [];
    on('[data-zh]', (ev) => { const t = $('[data-zh-text]'); t.hidden = !t.hidden; ev.currentTarget.setAttribute('aria-expanded', String(!t.hidden)); ev.currentTarget.textContent = t.hidden ? '看中文翻譯' : '收起翻譯'; });
    if (modeOf() !== 'find' || !order.length) { next.disabled = false; return; }
    let at = 0;
    const ask = $('[data-ask]');
    const words = [...sent.querySelectorAll('.ln-w')]; // 句子裡所有的字，依順序
    const idx = (w) => words.indexOf(w);
    const targetIdx = () => words.map((w, i) => (w.closest(`.ln-seg[data-part="${order[at]}"]`) ? i : -1)).filter((i) => i >= 0);
    let tip = '';
    const paintAsk = () => {
      ask.innerHTML = at < order.length
        ? `<span class="ln-ask-n">${at + 1}/${order.length}</span>劃出 <b class="c${order[at] % 5}">${esc((parts[order[at]] || {}).t || '')}</b>${tip ? `<span class="ln-ask-left">${tip}</span>` : ''}`
        : `<span class="ln-ask-ok">${icon.check}</span>全部找到了`;
    };
    const done = () => {
      sent.classList.remove('finding');
      $('[data-legend]').innerHTML = legendHTML(parts, order);
      $('[data-reveal]')?.remove();
      at = order.length; tip = ''; paintAsk();
      next.disabled = false; next.focus({ preventScroll: true });
    };
    const light = (p) => sent.querySelectorAll(`[data-part="${p}"]`).forEach((x) => x.classList.add('lit', `c${p % 5}`));
    paintAsk();
    // 劃記：按住一個字、劃過去，像螢光筆塗出一段；放開時檢查劃的範圍是不是這一塊（只有一個字的塊點一下就好）
    let from = -1, to = -1;
    const paintSel = () => {
      const lo = Math.min(from, to), hi = Math.max(from, to);
      words.forEach((w, i) => { w.classList.toggle('sel', from >= 0 && i >= lo && i <= hi); w.classList.toggle(`hl${order[at] % 5}`, from >= 0 && i >= lo && i <= hi); });
    };
    const clearSel = () => { from = to = -1; words.forEach((w) => w.classList.remove('sel', 'hl0', 'hl1', 'hl2', 'hl3', 'hl4')); };
    const wordAt = (x, y) => { const el = document.elementFromPoint(x, y); const w = el && el.closest && el.closest('.ln-w'); return w && sent.contains(w) && !w.closest('.lit') ? w : null; };
    sent.addEventListener('pointerdown', (ev) => {
      if (at >= order.length || ev.button > 0) return;
      const w = wordAt(ev.clientX, ev.clientY); if (!w) return;
      ev.preventDefault();
      from = to = idx(w); paintSel();
      try { sent.setPointerCapture(ev.pointerId); } catch { /* 舊瀏覽器 */ }
    });
    sent.addEventListener('pointermove', (ev) => {
      if (from < 0) return;
      const w = wordAt(ev.clientX, ev.clientY);
      if (w && idx(w) !== to) { to = idx(w); paintSel(); }
    });
    const finish = () => {
      if (from < 0) return;
      const lo = Math.min(from, to), hi = Math.max(from, to);
      const want = targetIdx();
      const got = Array.from({ length: hi - lo + 1 }, (_, k) => lo + k);
      const inTarget = got.filter((i) => want.includes(i)).length;
      if (got.length === want.length && inTarget === want.length) {
        clearSel(); light(order[at]); buzz(); at++; tip = '';
        if (at >= order.length) done(); else paintAsk();
        return;
      }
      // 沒劃對：告訴學生差在哪，讓劃的那段晃一下再清掉
      tip = inTarget === got.length && inTarget > 0 ? '還不完整，把整塊劃起來' : inTarget === want.length ? '劃太多了' : inTarget ? '只對了一部分' : '不是這裡';
      const sel = words.filter((w) => w.classList.contains('sel'));
      sel.forEach((w) => { w.classList.add('miss'); });
      ask.classList.remove('nudge'); void ask.offsetWidth; ask.classList.add('nudge');
      paintAsk();
      from = to = -1;
      setTimeout(() => { sel.forEach((w) => w.classList.remove('miss')); clearSel(); }, 420);
    };
    sent.addEventListener('pointerup', finish);
    sent.addEventListener('pointercancel', () => clearSel());
    on('[data-reveal]', () => { order.forEach(light); done(); });
  }

  // ---------- ② 檢測：馬上對答案，不計分；結果從下方滑出 ----------
  function check(ci, dir = 1) {
    const s = sections[si];
    if (ci >= s.checks.length) { if (s.quiz.every((q) => graded[q.id])) sectionResult(); else quiz(0); return; }
    const q = s.checks[ci];
    show(1, `<div class="ln-note"><span class="ln-tag free">不計分</span>確認剛剛看懂了沒・第 ${ci + 1} / ${s.checks.length} 題</div><div data-q></div>`,
      `<button type="button" class="btn ghost" data-relearn>${icon.book} 看說明</button>`, dir);
    on('[data-relearn]', () => learn(0, 0, -1));
    const host = $('[data-q]');
    const opts = { meta: q.kind === 'apply' ? '把單字排成正確的句子' : q.kind === 'fill' ? '填入空格' : '選出正確的答案', onAnswer: (ok) => {
      if (ok) buzz();
      const bar = $('.ln-bar');
      bar.classList.add('fb', ok ? 'ok' : 'no');
      bar.innerHTML = `<div class="ln-fb">
          <b>${ok ? `${icon.check} 答對了` : `${icon.x} 再想想`}</b>
          ${q.explain ? `<p>${esc(q.explain)}</p>` : ''}
        </div>
        <div class="ln-fb-btns">${ok ? '' : `<button type="button" class="btn ghost" data-relearn>${icon.book} 看說明</button>`}<button type="button" class="btn primary" data-go>${ci < s.checks.length - 1 ? '下一題' : '開始驗收'} ${icon.arrowR}</button></div>`;
      on('[data-go]', () => check(ci + 1));
      on('.ln-bar [data-relearn]', () => learn(0, 0, -1));
      $('[data-go]').focus({ preventScroll: true });
    } };
    if (q.kind === 'mc') renderChoiceCard(host, q, opts);
    else if (q.kind === 'fill') renderFillCard(host, q, opts);
    else renderApplyCard(host, q, opts);
  }

  // ---------- ③ 驗收：計分，這一段做完就看結果 ----------
  const hasAns = (q) => String(answers[q.id] || '').trim() !== '';
  // 驗收中可以回頭看說明：收合的小抽屜（用途、結構、一句例句、易錯），不離開題目、不影響作答
  let peekOpen = false;
  const peekHTML = (s) => {
    const g = s.g, parts = g.parts || [];
    if (!g.use && !parts.length && !s.examples.length) return '';
    const e = s.examples[0];
    const ex = e ? parseExample(e.en).map((x) => (x.part >= 0 ? `<span class="ln-hl c${x.part % 5}">${esc(x.text)}</span>` : esc(x.text))).join('') : '';
    return `<details class="ln-peek"${peekOpen ? ' open' : ''}><summary>${icon.book} 看說明</summary><div class="ln-peek-in">
      ${g.use ? `<p class="ln-use">${esc(g.use)}</p>` : ''}
      ${parts.length ? `<div class="ln-formula sm">${parts.map((p, i) => `<div class="ln-part c${i % 5}"><b>${esc(p.t)}</b></div>`).join('<span class="ln-plus" aria-hidden="true">+</span>')}</div>` : ''}
      ${ex ? `<p class="ln-peek-ex en">${ex}</p>` : ''}
      ${g.pitfall ? `<p class="ln-peek-pit">${icon.alert} ${esc(g.pitfall)}</p>` : ''}
    </div></details>`;
  };
  function quiz(qi, dir = 1) {
    const s = sections[si];
    const q = s.quiz[qi];
    const last = qi === s.quiz.length - 1;
    show(2, `<div class="ln-note"><span class="ln-tag score">計分</span>第 ${qi + 1} / ${s.quiz.length} 題</div>
      <div class="ln-qdots" role="group" aria-label="跳到第幾題">${s.quiz.map((x, i) => `<button type="button" class="${i === qi ? 'now' : ''}${hasAns(x) ? ' done' : ''}" data-goq="${i}" aria-label="第 ${i + 1} 題${hasAns(x) ? '（已作答）' : ''}">${i + 1}</button>`).join('')}</div>
      ${peekHTML(s)}<div data-q></div>`,
      `<button type="button" class="btn ghost" data-prev ${qi ? '' : 'disabled'}>${icon.back}</button><button type="button" class="btn primary" data-next>${last ? `看這段結果 ${icon.check}` : `下一題 ${icon.arrowR}`}</button>`, dir);
    const host = $('[data-q]');
    $('.ln-peek')?.addEventListener('toggle', (e) => { peekOpen = e.target.open; });
    const paintDots = () => $$('[data-goq]').forEach((b, i) => b.classList.toggle('done', hasAns(s.quiz[i])));
    const opts = { meta: q.label, deferred: true, initial: states[q.id] ?? null, onPick: (yours, state) => { answers[q.id] = yours; states[q.id] = state; paintDots(); } };
    if (q.kind === 'mc') renderChoiceCard(host, q, opts);
    else if (q.kind === 'fill') renderFillCard(host, q, opts);
    else renderApplyCard(host, q, opts);
    $$('[data-goq]').forEach((b) => b.addEventListener('click', () => { const i = Number(b.dataset.goq); if (i !== qi) quiz(i, i > qi ? 1 : -1); }));
    on('[data-prev]', () => quiz(qi - 1, -1));
    on('[data-next]', () => {
      if (!last) { quiz(qi + 1); return; }
      const left = s.quiz.filter((x) => !hasAns(x)).length;
      if (left) {
        const b = $('[data-next]');
        if (b.dataset.sure !== '1') { b.dataset.sure = '1'; b.innerHTML = `還有 ${left} 題沒作答，仍要看結果`; return; }
      }
      gradeSection();
    });
  }

  // 批改這一段：正式測驗交給伺服器，預覽或沒鎖答案就在本機判斷
  async function gradeSection() {
    const s = sections[si];
    const b = $('[data-next]');
    if (b) { b.disabled = true; b.innerHTML = '<span class="spinner"></span>批改中…'; }
    try {
      await Promise.all(s.quiz.filter((q) => !graded[q.id]).map(async (q) => {
        const y = answers[q.id] || '';
        graded[q.id] = grade ? await grade(q, y) : { got: q.kind === 'apply' ? applyScore(q, y) : (judge(q, y) ? 1 : 0), q };
      }));
    } catch {
      if (b) { b.disabled = false; b.innerHTML = '連不上伺服器，再試一次'; }
      return;
    }
    sectionResult();
  }

  const pointsOf = (q) => Number((graded[q.id] || {}).got) || 0;
  const fullOf = (q) => (graded[q.id] && graded[q.id].q) || q;
  const fmt = (n) => String(Math.round(n * 100) / 100);

  function sectionResult() {
    const s = sections[si];
    const got = s.quiz.reduce((n, q) => n + pointsOf(q), 0);
    const ratio = got / s.quiz.length;
    const last = si === sections.length - 1;
    const verdict = ratio >= 1 ? '全部答對' : ratio >= 0.65 ? '大致掌握了' : '建議再看一次說明';
    const cards = s.quiz.map((q, i) => {
      const card = reviewCardHTML(fullOf(q), answers[q.id] || '', '', i + 1);
      // 答對的收起來，答錯的直接展開
      return pointsOf(q) === 1 ? `<details class="ln-rv-ok"><summary>${icon.check} 第 ${i + 1} 題・答對</summary>${card}</details>` : card;
    }).join('');
    show(3, `<div class="ln-card ln-sec ${ratio >= 0.65 ? 'good' : 'low'}">
        <div class="ln-sec-score"><b>${fmt(got)}</b><span>/ ${s.quiz.length}</span></div>
        <div class="ln-sec-bar"><i style="--w:${(ratio * 100).toFixed(0)}%"></i></div>
        <p><b>${esc(s.g.name || s.tag)}</b>・${verdict}</p>
      </div>
      <div class="ln-review">${cards}</div>`,
      `${ratio < 0.65 ? `<button type="button" class="btn ghost" data-relearn>${icon.book} 再看說明</button>` : ''}<button type="button" class="btn primary" data-go>${last ? `交卷 ${icon.check}` : `下一個句型 ${icon.arrowR}`}</button>`);
    on('[data-relearn]', () => learn(0, 0, -1));
    on('[data-go]', () => {
      if (!last) { si++; learn(0); return; }
      const all = sections.flatMap((x) => x.quiz);
      // 各句型平均配分，總分 100
      const pct = Math.round(sections.reduce((n, x) => n + x.quiz.reduce((m, q) => m + pointsOf(q), 0) / x.quiz.length, 0) / sections.length * 100);
      onFinish?.({ pct, sections: sections.map((x) => ({ tag: x.tag, name: x.g.name, got: x.quiz.reduce((m, q) => m + pointsOf(q), 0), n: x.quiz.length })), details: all.map((q) => ({ word: q.id, yours: answers[q.id] || '', points: pointsOf(q) })) });
    });
  }

  if (!sections.length) { stage.innerHTML = '<p class="muted">這個單元還沒有可以練習的句型。</p>'; return; }
  learn(0);
  return { sections };
}
