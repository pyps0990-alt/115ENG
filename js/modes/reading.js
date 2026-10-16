// 課文理解：先讀文章，再作答閱讀測驗；交卷後送出成績，再逐題檢討（一次一題，可標出原文依據）
import { store } from '../storage.js';
import { esc, nowStamp, confirmDialog, centerInView } from '../util.js';
import { icon } from '../icons.js';
import { renderResult } from '../components/result.js';
import { unitWindow, unitCfg } from '../remote-config.js';
import { parseQuiz } from '../levels.js';
import { paraHTML, rangeOfKey, rangeOfRef, keywordHits, paintMarks, openNote, mountAnnotator } from '../components/annotate.js';
import { testGate, submitStateHTML, stampHTML } from '../components/gate.js';
import { mountReview, completeReview } from '../components/review.js';
import { submitScore } from '../submit.js';
import { progress } from '../resume.js';
import { PASS, typeLabel } from '../types.js';

const KEYS = ['A', 'B', 'C', 'D', 'E'];

export function mount(stage, ctx) {
  const data = ctx.data;
  const qs = data.questions || [];
  const paras = data.passage || [];
  const unitId = ctx.unit.id;
  let alive = true;
  const unload = (e) => { e.preventDefault(); e.returnValue = ''; };

  if (!qs.length) {
    stage.innerHTML = `<div class="empty"><div class="big">${icon.file}</div><p>這個單元還沒有題目。</p></div>`;
    return;
  }
  try { document.fonts && document.fonts.load('400 1em Merriweather'); } catch { /* 舊瀏覽器 */ }
  const nWords = paras.join(' ').split(/\s+/).filter(Boolean).length;
  // 文章劃記：老師在後台「單元設定」開啟才有（不計分）
  const annotateOn = !!(parseQuiz(unitCfg(ctx.config, unitId).quiz) || {}).annotate;
  let stopAnnotator = null;
  const minutes = Math.max(1, Math.round(nWords / 150));

  const gate = testGate(stage, {
    timeWindow: () => unitWindow(ctx.config, unitId),
    rules: [
      `文章約 <b>${nWords}</b> 字，建議閱讀 ${minutes} 分鐘`,
      `共 <b>${qs.length}</b> 題，題目經過改寫，要理解文意才答得出來`,
      '交卷後逐題檢討，看答案、解析與原文依據',
    ],
    best: () => store.best(unitId).reading,
    review: () => store.done(unitId),
    reviewed: () => store.reviewed(unitId),
    retake: () => store.tried(unitId) && !store.done(unitId),
    onStart: (s, review) => run(s, review),
    onReview: () => { const first = store.first(unitId) || {}; startReview(answersFromDetails(first.details), Array.isArray(first.marks) ? first.marks : null); },
    resume: () => {
      const r = progress.load(unitId, 'reading');
      if (!r || !Array.isArray(r.answers) || r.answers.length !== qs.length) return null;
      return { label: `已作答 ${r.answers.filter((a) => a != null).length} / ${qs.length}`, onResume: (s) => run(s, !!r.review, r), discard: () => progress.clear(unitId) };
    },
  });

  /* ---------------- 文章與原文依據 ---------------- */
  // 文章拆成一個個字（js/components/annotate.js）：劃記、答案依據（綠筆劃線）、題目關鍵字都用「第幾段第幾個字」標
  function passageHTML(opts = {}) {
    return `<article class="passage-card ann-text">
        <div class="eyebrow">Passage · ${nWords} words</div>
        <h2 class="passage-title en">${esc(data.title || '')}</h2>
        ${paras.map((p, i) => `<p data-p="${i}"><span class="pnum">${i + 1}</span><span class="ptext">${paraHTML(i, p, { ev: opts.ev, kw: opts.kw && opts.kw[i] })}</span></p>`).join('')}
      </article>`;
  }
  // 這題的答案依據在文章哪裡：優先用關鍵字句（key），沒有就用原文依據句（ref）
  const evidenceOf = (q) => rangeOfKey(paras, q.key) || rangeOfRef(paras, q.ref);

  /* ---------------- 作答 ---------------- */
  function run(student, review = false, saved = null) {
    const answers = saved ? saved.answers.slice() : new Array(qs.length).fill(null);
    const marks = annotateOn && saved && Array.isArray(saved.marks) ? saved.marks.slice() : [];
    const t0 = Date.now() - (saved ? saved.elapsed : 0);
    const persist = () => progress.save(unitId, 'reading', { review, answers, elapsed: Date.now() - t0, ...(annotateOn ? { marks } : {}) });
    document.body.dataset.busy = '1';
    window.addEventListener('beforeunload', unload);

    // 文章怎麼顯示：
    //   手機：文章收在題目上方，建議搭配課本，需要時原地展開
    //   平板、電腦：文章預設在左邊、題目在右邊；按「收起文章」→ 題目移到中間，文章縮成右上角的懸浮按鈕（在導覽列下面），按它再展開。
    //   切換用 View Transitions 讓文章和按鈕之間直接變形（不支援的瀏覽器就直接切換）。收起或展開記在這台裝置
    //   （檢討時文章與題目並排，見 startReview）
    let shut = false;
    try { shut = localStorage.getItem('b5p:rd-passage') === 'closed'; } catch { /* 無痕模式 */ }
    stage.innerHTML = `
      <div class="reading-quiz" data-passage="${shut ? 'closed' : 'open'}">
        <details class="rd-fold"><summary>${icon.book} 看文章<span class="rd-fold-note">建議搭配課本使用</span></summary>${passageHTML()}</details>
        <aside class="rd-side" aria-label="文章">
          <div class="rd-side-bar"><span class="muted">沒帶課本時可以看這篇文章</span>
            <button class="btn small ghost" type="button" data-passage-close aria-label="收起文章，題目移到中間">${icon.x} 收起文章</button></div>
          ${passageHTML()}
        </aside>
        <section class="pq-list" aria-label="閱讀測驗">
          <div class="pq-intro"><span class="eyebrow">Questions${review ? ' · 複習' : ''}</span><span class="muted rd-hint-phone">建議搭配課本作答，需要時展開上面的文章</span><span class="muted rd-hint-wide">對照課本或文章作答</span></div>
          ${qs.map((q, i) => `<div class="pq" data-q="${i}">
            <div class="pq-head"><span class="pq-num">${i + 1}</span>
              <div><span class="skill">${esc(q.skill || '')}</span><div class="pq-q">${esc(q.q || '')}</div></div></div>
            <div class="options">${q.options.map((o, j) => `<button class="opt" type="button" data-i="${j}">
              <span class="opt-key">${KEYS[j]}</span><span class="opt-text en">${esc(o)}</span><span class="opt-mark" aria-hidden="true"></span></button>`).join('')}</div>
          </div>`).join('')}
        </section>
      </div>
      <button class="rd-float" type="button" data-passage-open aria-label="展開文章">${icon.book}<span>文章</span></button>
      <div class="passage-foot">
        <span class="count" data-count></span>
        <button class="btn primary" type="button" data-submit-btn>${icon.send} 交卷</button>
      </div>`;

    centerInView(stage.querySelector('.reading-quiz'), 'start');
    // 文章劃記（老師開啟才有）：工具在右下角的圓形按鈕，劃記跟著進度存起來
    stopAnnotator?.();
    stopAnnotator = annotateOn ? mountAnnotator(stage.querySelector('.reading-quiz'), paras, marks, persist) : null;
    // 收起／展開文章（平板、電腦）：有 View Transitions 就讓文章卡和懸浮按鈕互相變形，題目滑到新位置
    const quiz = stage.querySelector('.reading-quiz');
    const setPassage = (open) => {
      const apply = () => { quiz.dataset.passage = open ? 'open' : 'closed'; };
      try { localStorage.setItem('b5p:rd-passage', open ? 'open' : 'closed'); } catch { /* 無痕模式 */ }
      if (document.startViewTransition && !matchMedia('(prefers-reduced-motion: reduce)').matches) document.startViewTransition(apply);
      else apply();
    };
    stage.querySelector('[data-passage-close]').addEventListener('click', () => {
      setPassage(false);
      setTimeout(() => stage.querySelector('[data-passage-open]')?.focus({ preventScroll: true }), 600);
    });
    stage.querySelector('[data-passage-open]').addEventListener('click', () => setPassage(true));
    // 手機：文章原地展開／收合，高度平滑變化（減少動態效果時直接切換）
    const fold = stage.querySelector('.rd-fold');
    const card = fold.querySelector('.passage-card');
    // 動畫做在整個 <details> 的高度上（關起來＝只剩標題列那一條的高度），收到底和關起來一樣高，關掉的瞬間不會跳
    const sum = fold.querySelector('summary');
    sum.addEventListener('click', (e) => {
      if (matchMedia('(prefers-reduced-motion: reduce)').matches || !fold.animate) return;
      e.preventDefault();
      const opening = !fold.open;
      const from = fold.getBoundingClientRect().height;
      if (opening) fold.open = true;
      fold.getAnimations().forEach((x) => x.cancel());
      card.getAnimations().forEach((x) => x.cancel());
      const closed = sum.getBoundingClientRect().height + (fold.offsetHeight - fold.clientHeight); // 標題列＋上下框線
      const full = fold.scrollHeight + (fold.offsetHeight - fold.clientHeight);
      const to = opening ? full : closed;
      const duration = Math.min(520, 240 + Math.abs(to - from) / 8);
      const anim = fold.animate([{ height: `${from}px` }, { height: `${to}px` }], { duration, easing: 'cubic-bezier(.2, .8, .2, 1)' });
      card.animate(opening ? [{ opacity: 0 }, { opacity: 1 }] : [{ opacity: 1 }, { opacity: 0 }], { duration: duration * .8, easing: 'ease', fill: 'forwards' })
        .onfinish = function () { this.cancel(); };
      // 收合：動畫結束才真的關起來；另外用計時器保底（分頁在背景、動畫沒播的時候也會關）
      if (!opening) {
        const token = (fold.dataset.t = String(Date.now()));
        const close = () => { if (fold.dataset.t === token) { fold.open = false; anim.cancel(); } };
        anim.onfinish = close;
        setTimeout(close, duration + 80);
      } else {
        fold.dataset.t = '';
      }
    });
    const countEl = stage.querySelector('[data-count]');
    const updateFoot = () => { countEl.textContent = `已作答 ${answers.filter((a) => a != null).length} / ${qs.length}`; };

    stage.querySelectorAll('.pq').forEach((card) => {
      const i = Number(card.dataset.q);
      if (answers[i] != null) { // 接回上次的作答
        card.querySelectorAll('.opt').forEach((x, k) => x.classList.toggle('selected', k === answers[i]));
        card.classList.add('done');
      }
      card.querySelectorAll('.opt').forEach((o) => o.addEventListener('click', () => {
        answers[i] = Number(o.dataset.i);
        card.querySelectorAll('.opt').forEach((x, k) => x.classList.toggle('selected', k === answers[i]));
        card.classList.add('done');
        updateFoot();
        persist();
      }));
    });

    stage.querySelector('[data-submit-btn]').addEventListener('click', async () => {
      const blank = answers.filter((a) => a == null).length;
      const ok = await confirmDialog({
        title: '確定要交卷嗎？',
        body: blank ? `還有 <b>${blank}</b> 題沒有作答。交卷後就不能修改。` : '所有題目都作答了。交卷後就不能修改。',
        ok: '交卷', cancel: '再檢查',
      });
      if (ok && alive) finish(student, review, answers, t0, marks);
    });
    updateFoot();
  }

  async function finish(student, review, answers, t0, marks = []) {
    stopAnnotator?.(); stopAnnotator = null;
    progress.clear(unitId);
    window.removeEventListener('beforeunload', unload);
    delete document.body.dataset.busy;
    const score = answers.filter((a, i) => a === qs[i].answer).length;
    const stamp = nowStamp();
    const durationSec = Math.round((Date.now() - t0) / 1000);
    const pct = Math.round((score / qs.length) * 100);
    store.setBest(unitId, 'reading', pct);
    const official = !review;
    const wasTried = official && store.tried(unitId);
    const passed = pct >= PASS;
    if (official) { if (passed) store.setDone(unitId); else store.setTried(unitId); }
    const details = qs.map((q, i) => ({
      stage: '課文理解', n: i + 1, kind: q.skill || '', q: q.q || '', word: `Q${i + 1} ${String(q.q || '').slice(0, 50)}`,
      correct: `${KEYS[q.answer]}. ${q.options[q.answer]}`,
      yours: answers[i] == null ? '' : `${KEYS[answers[i]]}. ${q.options[answers[i]]}`,
      ok: answers[i] === q.answer, points: answers[i] === q.answer ? 1 : 0, hints: 0,
    }));
    const firstTest = !review;
    const keepMarks = annotateOn ? marks.map((m) => ({ p: m.p, f: m.f, t: m.t, k: m.k, ...(m.n ? { n: m.n } : {}) })) : null;
    if (firstTest) store.setFirst(unitId, { mode: 'reading', details, ...(keepMarks ? { marks: keepMarks } : {}) });

    stage.innerHTML = '';
    window.scrollTo(0, 0);
    const perfect = firstTest && details.every((d) => d.ok);
    // 全部答對：沒有要檢討的，直接視為檢討完成（才能開始複習），按鈕改成返回首頁
    if (perfect) completeReview(unitId);
    const actions = [perfect ? { label: '返回首頁', icon: icon.home, primary: true, onClick: () => { location.hash = '#/'; } } : { label: firstTest ? '開始檢討' : '逐題檢討', icon: icon.bulb, primary: true, onClick: () => startReview(answers, keepMarks) }];
    if (!firstTest) actions.push({ label: '再複習一次', icon: icon.redo, onClick: () => run(student, true) });
    const box = renderResult(stage, {
      title: review ? '複習完成' : passed ? '通過！' : '未通過',
      pct,
      scoreText: `${score} / ${qs.length}`,
      pills: [`${icon.clock} ${Math.floor(durationSec / 60)} 分 ${durationSec % 60} 秒`, official && !passed ? '' : firstTest ? '接著逐題檢討，完成後才能複習' : '可以逐題檢討這次的作答'].filter(Boolean),
      passLine: official,
      extraHTML: `${stampHTML(student, ctx.unit.title, stamp)}<div data-submit role="status" aria-live="polite">${submitStateHTML('sending')}</div>`,
      actions,
    });
    const res = await submitScore({
      clientTs: stamp, cls: student.cls, seat: student.seat, name: student.name,
      unit: unitId, unitTitle: ctx.unit.title, mode: 'reading', review, level: review ? '複習 · 課文理解' : wasTried ? '補考 · 課文理解' : '課文理解',
      score, total: qs.length, pct, durationSec,
      wrong: answers.map((a, i) => (a === qs[i].answer ? null : `Q${i + 1}`)).filter(Boolean),
      details,
      ...(keepMarks && keepMarks.length ? { marks: keepMarks } : {}),
    });
    const s = box.querySelector('[data-submit]');
    if (s) s.innerHTML = submitStateHTML(res.status);
  }

  /* ---------------- 逐題檢討 ---------------- */
  // Firestore 讀回的紀錄只有「A. 選項文字」，轉回選項索引
  function answersFromDetails(details) {
    return qs.map((_, i) => {
      const d = (details || []).find((x) => Number(x.n) === i + 1);
      const m = d && /^([A-E])\./.exec(String(d.yours || ''));
      return m ? KEYS.indexOf(m[1]) : null;
    });
  }

  // 依題型的解題方向
  const STRATEGY = {
    主旨: '主旨題：看每段的第一句和最後一句，找出整篇共同在講的事。選項不能只講其中一段（範圍太小），也不能講得比文章還廣（範圍太大）。',
    細節: '細節題：先圈出題目的關鍵字，回文章找到同一句，再比對選項是不是把那句話換個說法。',
    字義: '字義題：回到那個字所在的句子，看前後文在說什麼，用上下文推出意思，不要只靠字面或字典的第一個意思。',
    推論: '推論題：答案不會照抄原文。先找到依據句，再往前推一步——文章「暗示」了什麼，但不能推得比文章說的還遠。',
    態度: '態度題：注意作者用的形容詞、副詞和語氣詞（例如 unfortunately、surprisingly），判斷作者是正面、負面還是中立。',
  };
  const pairsHTML = (q) => (Array.isArray(q.pairs) && q.pairs.length
    ? `<ul class="rd-pairs">${q.pairs.map((x) => `<li><span class="en">${esc(x.a)}</span><span class="rd-arrow" aria-label="換成">→</span><span class="en">${esc(x.b)}</span></li>`).join('')}</ul>` : '');
  const paraList = (list) => list.map((p) => `第 ${p + 1} 段`).join('、');

  // 一題的檢討：答錯時依序是 1 這題在考什麼 → 2 答案在哪裡 → 3 你錯在哪個環節（有劃記才有）→ 4 你選的選項為什麼錯
  function reviewItem(q, i, a, marks) {
    const ok = a === q.answer;
    const ev = evidenceOf(q);
    const kw = keywordHits(paras, q.kw);
    const kwParas = Object.keys(kw).map(Number).sort((x, y) => x - y);
    const steps = [];
    if (!ok) {
      steps.push(['這題在考什麼', STRATEGY[q.skill] || STRATEGY.細節]);
      const where = ev ? `答案依據在<b>第 ${ev.p + 1} 段</b>（文章裡綠筆劃線的地方）。` : '';
      const kwText = kwParas.length && Array.isArray(q.kw) && q.kw.length
        ? `題目的關鍵字 ${q.kw.map((k) => `<b class="en">${esc(k)}</b>`).join('、')} 出現在${paraList(kwParas)}（虛線標出），用它們就能找到答案的位置。` : '';
      if (where || kwText) steps.push(['答案在哪裡', where + kwText]);
      if (Array.isArray(marks)) {
        const hit = ev && marks.some((m) => m.p === ev.p && m.f <= ev.t && m.t >= ev.f);
        const marked = [...new Set(marks.map((m) => m.p))].sort((x, y) => x - y);
        let diag;
        if (hit) diag = `<span class="rd-diag ok">改寫沒看懂</span>你有劃到答案依據，地方找對了！問題出在選項把原文換了說法：${pairsHTML(q) || '對照依據句和正確選項，找出意思相同、說法不同的地方。'}`;
        else if (marked.length) diag = `<span class="rd-diag">定位錯誤</span>你劃的重點在${paraList(marked)}，但答案在第 ${ev ? ev.p + 1 : '?'} 段。下次先用題目的關鍵字回文章定位，再確認那一句是不是在回答這個問題。`;
        else diag = '<span class="rd-diag muted">沒有劃記</span>這題你沒有劃記。下次可以先把題目關鍵字和找到的依據句劃起來，比較不會找錯地方（劃記不計分）。';
        steps.push(['你錯在哪個環節', diag]);
      }
      const trap = a != null && Array.isArray(q.traps) ? q.traps[a] : null;
      const mine = a == null ? '這題沒有作答。'
        : trap && trap.t ? `你選的 <b>${KEYS[a]}</b>：<span class="trap-tag">${esc(trap.t)}</span>${esc(trap.why || '')}`
        : `你選的是 <b>${KEYS[a]}</b>。`;
      const showPairs = !Array.isArray(marks) && pairsHTML(q) ? `<div class="rd-sub">正確選項換了說法：${pairsHTML(q)}</div>` : '';
      steps.push(['為什麼選錯', `${mine}<div class="rd-sub">正確答案 <b>${KEYS[q.answer]}</b>：${esc(q.explain || '')}</div>${showPairs}`]);
    }
    return {
      html: `<div class="pq rv-pq ${ok ? 'is-ok' : 'is-no'}">
          <div class="pq-head"><span class="pq-num">${i + 1}</span>
            <div><span class="skill">${esc(q.skill || '')}</span><div class="pq-q">${esc(q.q || '')}</div></div></div>
          <div class="options">${q.options.map((o, j) => {
    const cls = j === q.answer ? `correct${ok ? '' : ' reveal'}` : j === a ? 'wrong' : 'dim';
    const mark = j === q.answer ? icon.check : j === a ? icon.x : '';
    return `<div class="opt ${cls}"><span class="opt-key">${KEYS[j]}</span><span class="opt-text en">${esc(o)}</span><span class="opt-mark" aria-hidden="true">${mark}</span></div>`;
  }).join('')}</div>
          <div class="explain">
            <b class="ex-head ${ok ? 'ok' : 'no'}">${ok ? `${icon.check} 答對` : a == null ? `${icon.x} 未作答・正解 ${KEYS[q.answer]}` : `${icon.x} 你選 ${KEYS[a]}・正解 ${KEYS[q.answer]}`}</b>
            ${ok ? `<p>${esc(q.explain || '')}</p>` : `<ol class="rd-steps">${steps.map(([t, body], k) => `<li><span class="wt-n">${k + 1}</span><div><b class="rd-step-t">${t}</b><div class="rd-step-b">${body}</div></div></li>`).join('')}</ol>`}
            ${ev ? `<button class="btn small ghost ref-btn" type="button">${icon.book} 捲到答案依據</button>` : ''}
          </div>
        </div>`,
      // 換到這一題：文章重畫成「這題的依據（綠筆劃線）＋題目關鍵字（虛線）＋自己的劃記」
      mount: (el) => {
        const card = stage.querySelector('.review-layout .passage-card');
        if (card) card.outerHTML = passageHTML({ ev, kw: ok ? null : kw });
        const root = stage.querySelector('.review-layout');
        if (Array.isArray(marks)) paintMarks(root, marks);
        root.querySelector('.passage-card')?.addEventListener('click', (e) => {
          const pin = e.target.closest('.note-pin'); if (!pin) return;
          const m = marks[Number(pin.dataset.note)]; if (m) openNote(root, paras, m, { readOnly: true });
        });
        const go = () => stage.querySelector('.review-layout .ev')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.querySelector('.ref-btn')?.addEventListener('click', go);
      },
    };
  }

  function startReview(answers, marks = null) {
    const firstTime = !store.reviewed(unitId);
    stage.innerHTML = `<div class="passage-layout review-layout">${passageHTML()}<section class="pq-list" data-review></section></div>`;
    window.scrollTo(0, 0);
    mountReview(stage.querySelector('[data-review]'), {
      title: `${ctx.unit.title}｜${firstTime ? '檢討' : '再看一次檢討'}`,
      items: qs.map((q, i) => reviewItem(q, i, answers[i], marks)),
      onDone: () => { if (firstTime) completeReview(unitId); gate.redraw(); window.scrollTo(0, 0); },
      onExit: () => { document.querySelector('.note-pop')?.remove(); gate.redraw(); window.scrollTo(0, 0); },
    });
  }

  return () => {
    alive = false;
    stopAnnotator?.(); stopAnnotator = null;
    window.removeEventListener('beforeunload', unload);
  };
}
