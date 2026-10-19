// 課文理解：先讀文章，再作答閱讀測驗；交卷後送出成績，再逐題檢討（一次一題，可標出原文依據）
import { store } from '../storage.js';
import { esc, nowStamp, confirmDialog, centerInView } from '../util.js';
import { icon } from '../icons.js';
import { renderResult } from '../components/result.js';
import { unitWindow, unitCfg } from '../remote-config.js';
import { parseQuiz } from '../levels.js';
import { wordsOf, paraHTML, rangeOfKey, rangeOfRef, keywordHits, paintMarks, openNote, mountAnnotator } from '../components/annotate.js';
import { testGate, submitStateHTML, stampHTML } from '../components/gate.js';
import { mountReview, completeReview } from '../components/review.js';
import { submitScore, fetchKey, cachedKey } from '../submit.js';
import { statusBarHTML, mountDeadline } from '../components/status.js';
import { progress } from '../resume.js';
import { PASS, typeLabel } from '../types.js';

const KEYS = ['A', 'B', 'C', 'D', 'E'];

export function mount(stage, ctx) {
  const data = ctx.data;
  // 答案不公開（js/answers.js）：作答時只有題目和選項；交卷後伺服器才把完整題目（答案、解析、依據）給這位學生
  const version = ((ctx.config && ctx.config.content && ctx.config.content[ctx.unit.id]) || {}).updated || '';
  let qs = data.questions || [];
  let keyed = !data.locked;
  const useKey = (full) => {
    const list = full && Array.isArray(full.questions) ? full.questions : null;
    if (!list || list.length !== qs.length) return false;
    qs = list; keyed = true; return true;
  };
  if (!keyed) useKey(cachedKey(ctx.unit.id, version));
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
    onReview: () => { const first = store.first(unitId) || {}; openReview(answersFromDetails(first.details), Array.isArray(first.marks) ? first.marks : null); },
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
    //   平板、電腦：文章預設在左邊、題目在右邊；按「收起文章」→ 題目移到中間，文章縮成左上角的懸浮按鈕，按它再展開。
    //   切換用 View Transitions 讓文章和按鈕之間直接變形（不支援的瀏覽器就直接切換）。收起或展開記在這台裝置
    //   （檢討時文章與題目並排，見 startReview）
    let shut = false;
    try { shut = localStorage.getItem('b5p:rd-passage') === 'closed'; } catch { /* 無痕模式 */ }
    stage.innerHTML = `
      ${statusBarHTML({ kind: review ? 'review' : 'official', note: review ? '複習不會改變你的成績。' : '這次的分數會送給老師。全部作答完再交卷，交卷前都可以修改。', mid: '<div class="quiz-bar" title="作答進度"><div class="bar"><span></span></div></div>' })}
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
    stopAnnotator = annotateOn ? mountAnnotator(stage.querySelector('.reading-quiz'), paras, marks, persist, { nQ: qs.length }) : null;
    // 收起／展開文章（平板、電腦）：動畫直接做在畫面上的元素
    // （不用 View Transitions：截圖層會蓋過導覽列，按鈕放大成文章卡時字會糊掉）
    const quiz = stage.querySelector('.reading-quiz');
    const EASE = 'cubic-bezier(.22, .8, .24, 1)';
    let moving = false;
    const setPassage = (open) => {
      try { localStorage.setItem('b5p:rd-passage', open ? 'open' : 'closed'); } catch { /* 無痕模式 */ }
      const apply = () => { quiz.dataset.passage = open ? 'open' : 'closed'; };
      const list = quiz.querySelector('.pq-list'), side = quiz.querySelector('.rd-side'), btn = stage.querySelector('.rd-float');
      if (moving || matchMedia('(prefers-reduced-motion: reduce)').matches || !side.animate) { apply(); return; }
      moving = true;
      // 題目區：寬度和位置一起平滑變過去（字跟著重新排，不會拉伸，也不會先跳成新寬度）
      const morphList = () => {
        const a = list.getBoundingClientRect(); apply(); const b = list.getBoundingClientRect();
        return list.animate([{ transform: `translate(${a.left - b.left}px, ${a.top - b.top}px)`, width: `${a.width}px` }, { transform: 'none', width: `${b.width}px` }],
          { duration: 480, easing: EASE }).finished.catch(() => {});
      };
      if (open) { // 題目區變窄滑到右邊，文章從左邊淡入滑進來
        const done = morphList();
        side.animate([{ opacity: 0, transform: 'translateX(-28px)' }, { opacity: 1, transform: 'none' }], { duration: 420, delay: 140, easing: EASE, fill: 'backwards' });
        done.finally(() => { moving = false; });
        return;
      }
      // 收起：文章往左淡出，接著題目區變寬滑到中間，左上角的「文章」按鈕淡入
      side.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateX(-28px)' }], { duration: 220, easing: 'cubic-bezier(.4, 0, 1, 1)', fill: 'forwards' })
        .finished.catch(() => {}).finally(() => {
          side.getAnimations().forEach((x) => x.cancel());
          morphList().finally(() => { moving = false; });
          btn.animate([{ opacity: 0, transform: 'scale(.85)' }, { opacity: 1, transform: 'none' }], { duration: 300, delay: 200, easing: EASE, fill: 'backwards' });
        });
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
    if (!review) mountDeadline(stage, unitWindow(ctx.config, unitId)); else mountDeadline(stage, null);
    const updateFoot = () => {
      const k = answers.filter((a) => a != null).length;
      countEl.textContent = `已作答 ${k} / ${qs.length}`;
      stage.querySelector('[data-st-bar] .bar > span').style.setProperty('--w', `${(k / qs.length) * 100}%`);
    };

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
    const stamp = nowStamp();
    const durationSec = Math.round((Date.now() - t0) / 1000);
    const official = !review;
    const wasTried = official && store.tried(unitId);
    const firstTest = !review;
    const keepMarks = annotateOn ? marks.map((m) => ({ p: m.p, f: m.f, t: m.t, k: m.k, ...(m.n ? { n: m.n } : {}), ...(Number.isInteger(m.q) ? { q: m.q } : {}) })) : null;
    // 作答內容：網站看不到答案時，對錯、分數交給伺服器
    const judgeAt = (i) => (keyed ? { correct: `${KEYS[qs[i].answer]}. ${qs[i].options[qs[i].answer]}`, ok: answers[i] === qs[i].answer, points: answers[i] === qs[i].answer ? 1 : 0 } : { correct: '', ok: false, points: 0 });
    const mine = qs.map((q, i) => ({
      stage: '課文理解', n: i + 1, kind: q.skill || '', q: q.q || '', word: `Q${i + 1} ${String(q.q || '').slice(0, 50)}`,
      yours: answers[i] == null ? '' : `${KEYS[answers[i]]}. ${q.options[answers[i]]}`, hints: 0, ...judgeAt(i),
    }));
    const local = keyed ? mine.filter((d) => d.ok).length : null;
    stage.innerHTML = '<div class="loading"><span class="spinner"></span>交卷中，伺服器正在計分…</div>';
    window.scrollTo(0, 0);
    const res = await submitScore({
      clientTs: stamp, cls: student.cls, seat: student.seat, name: student.name,
      unit: unitId, unitTitle: ctx.unit.title, mode: 'reading', review, level: review ? '複習 · 課文理解' : wasTried ? '補考 · 課文理解' : '課文理解',
      score: local, total: qs.length, pct: local == null ? null : Math.round((local / qs.length) * 100), durationSec,
      wrong: keyed ? answers.map((x, i) => (x === qs[i].answer ? null : `Q${i + 1}`)).filter(Boolean) : [],
      details: mine,
      ...(keepMarks && keepMarks.length ? { marks: keepMarks } : {}),
    });
    if (!alive) return;
    const result = res.result || null;
    if (result && result.data) useKey(result.data);
    const graded = !!result && typeof result.pct === 'number';
    let details;
    if (graded && Array.isArray(result.details) && result.details.length === qs.length) {
      details = result.details.map((d, i) => ({ ...mine[i], correct: d.correct, ok: !!d.ok, points: Number(d.points) || 0 }));
    } else details = qs.map((q, i) => ({ ...mine[i], ...judgeAt(i) }));
    if (firstTest) store.setFirst(unitId, { mode: 'reading', details, ...(keepMarks ? { marks: keepMarks } : {}) });
    stage.innerHTML = '';

    // 還沒拿到分數（離線、伺服器忙）：成績在這台裝置排隊，送出後會通知；這時還不能檢討
    if (!graded && !keyed) {
      if (official) store.setTried(unitId);
      const box = document.createElement('div');
      box.className = 'card gate-card';
      box.innerHTML = `<h2>已交卷</h2><p class="gate-lead">成績會在送到伺服器後算出來（右下角會通知）。送出後回到這個單元，就能逐題檢討。</p>
        ${stampHTML(student, ctx.unit.title, stamp)}<div data-submit role="status" aria-live="polite">${submitStateHTML(res.status)}</div>
        <div class="btn-row"><button class="btn primary" type="button" data-home>${icon.home} 返回首頁</button></div>`;
      box.querySelector('[data-home]').addEventListener('click', () => { location.hash = '#/'; });
      stage.append(box);
      return;
    }
    const score = graded ? result.score : local;
    const pct = graded ? result.pct : Math.round((local / qs.length) * 100);
    store.setBest(unitId, 'reading', pct);
    const passed = pct >= PASS;
    if (official) { if (passed) store.setDone(unitId); else store.setTried(unitId); }
    const perfect = firstTest && details.every((d) => d.ok);
    // 全部答對：沒有要檢討的，直接視為檢討完成（才能開始複習），按鈕改成返回首頁
    if (perfect) completeReview(unitId);
    const actions = [perfect ? { label: '返回首頁', icon: icon.home, primary: true, onClick: () => { location.hash = '#/'; } } : { label: firstTest ? '開始檢討' : '逐題檢討', icon: icon.bulb, primary: true, onClick: () => openReview(answers, keepMarks) }];
    if (!firstTest) actions.push({ label: '再複習一次', icon: icon.redo, onClick: () => run(student, true) });
    renderResult(stage, {
      title: review ? '複習完成' : passed ? '通過！' : '未通過',
      pct,
      scoreText: `${score} / ${qs.length}`,
      pills: [`${icon.clock} ${Math.floor(durationSec / 60)} 分 ${durationSec % 60} 秒`, official && !passed ? '' : firstTest ? '接著逐題檢討，完成後才能複習' : '可以逐題檢討這次的作答'].filter(Boolean),
      passLine: official,
      extraHTML: `${stampHTML(student, ctx.unit.title, stamp)}<div data-submit role="status" aria-live="polite">${submitStateHTML(res.status)}</div>`,
      actions,
    });
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

  // 依「對照這一題」的劃記判斷錯在哪個環節（只看學生選了題號的劃記，便利貼不算；樣式不影響）
  function diagnose(q, i, ev, kw, marks) {
    const mine = marks.filter((m) => m.q === i && m.k !== 'note');
    if (!mine.length) {
      return marks.some((m) => m.k !== 'note')
        ? '<span class="rd-diag muted">沒有對照這題</span>你有劃記，但沒有一筆選了「對照第 ' + (i + 1) + ' 題」。劃記時在工具盤選題號，檢討時就能告訴你錯在哪個環節。'
        : '<span class="rd-diag muted">沒有劃記</span>這題你沒有劃記。下次可以先把題目關鍵字和找到的依據句劃起來，並選「對照第 ' + (i + 1) + ' 題」（劃記不計分）。';
    }
    const where = (m) => `第 ${m.p + 1} 段「<span class="en">${esc(wordsOf(paras[m.p]).slice(m.f, m.t + 1).join(' '))}</span>」`;
    if (!ev) return `<span class="rd-diag muted">無法比對</span>這題沒有設定答案依據，你劃的是${where(mine[0])}。`;
    const evLen = ev.t - ev.f + 1;
    const covered = new Set();
    mine.forEach((m) => { if (m.p === ev.p) for (let k = Math.max(m.f, ev.f); k <= Math.min(m.t, ev.t); k++) covered.add(k); });
    const cover = covered.size / evLen;
    if (cover >= 0.6) return `<span class="rd-diag ok">改寫沒看懂</span>你劃的地方就是答案依據，位置找對了！問題出在選項把原文換了說法：${pairsHTML(q) || '對照依據句和正確選項，找出意思相同、說法不同的地方。'}`;
    if (cover > 0) return `<span class="rd-diag">只抓到一部分</span>你只劃到答案依據的一部分（約 ${Math.round(cover * 100)}%），關鍵的部分漏掉了。把綠筆那整句讀完，答案常在後半句。`;
    const samePara = mine.filter((m) => m.p === ev.p);
    if (samePara.length) return `<span class="rd-diag">句子抓錯</span>段落找對了（第 ${ev.p + 1} 段），但你劃的是${where(samePara[0])}，答案在同一段的綠筆那句。找到段落後，要確認那一句真的在回答題目。`;
    const hitKw = mine.some((m) => kw[m.p] && [...kw[m.p]].some((k) => k >= m.f && k <= m.t));
    if (hitKw) return `<span class="rd-diag">找到關鍵字，答案在別處</span>你劃到了題目的關鍵字（${where(mine.find((m) => kw[m.p]))}），但答案在第 ${ev.p + 1} 段。同一個關鍵字可能出現好幾次，要找跟題目問的事情一樣的那一次。`;
    return `<span class="rd-diag">定位錯誤</span>你劃的是${where(mine[0])}，但答案在第 ${ev.p + 1} 段。下次先用題目的關鍵字回文章定位，再確認那一句是不是在回答這個問題。`;
  }

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
      if (Array.isArray(marks)) steps.push(['你錯在哪個環節', diagnose(q, i, ev, kw, marks)]);
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
        if (Array.isArray(marks)) paintMarks(root, marks, { tagQ: i });
        root.querySelector('.passage-card')?.addEventListener('click', (e) => {
          const pin = e.target.closest('.note-pin'); if (!pin) return;
          const m = marks[Number(pin.dataset.note)]; if (m) openNote(root, paras, m, { readOnly: true });
        });
        const go = () => stage.querySelector('.review-layout .ev')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.querySelector('.ref-btn')?.addEventListener('click', go);
      },
    };
  }

  // 檢討要用完整題目：還沒拿到就先跟伺服器拿（交過這個單元才給；這台裝置存過就不用再問）
  async function openReview(answers, marks = null) {
    if (!keyed) {
      stage.innerHTML = '<div class="loading"><span class="spinner"></span>讀取答案與解析…</div>';
      let ok = false;
      try { ok = useKey(await fetchKey(unitId, version)); } catch { ok = false; }
      if (!alive) return;
      if (!ok) {
        stage.innerHTML = '<div class="card gate-card"><p class="gate-lead">讀不到答案與解析：成績可能還在排隊送出，或網路不穩，請稍後再試。</p><div class="btn-row"><button class="btn primary" type="button" data-back>返回</button></div></div>';
        stage.querySelector('[data-back]').addEventListener('click', () => { gate.redraw(); window.scrollTo(0, 0); });
        return;
      }
    }
    startReview(answers, marks);
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
