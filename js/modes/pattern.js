// 句型練習：一次一題，選擇、填空、應用（重組句子）混合出現，作答後立刻看到解析；做完逐題檢討錯題
import { store } from '../storage.js';
import { esc, nowStamp, wait, shuffle, centerInView } from '../util.js';
import { icon } from '../icons.js';
import { renderResult } from '../components/result.js';
import { unitWindow } from '../remote-config.js';
import { testGate, submitStateHTML, stampHTML } from '../components/gate.js';
import { mountReview, completeReview } from '../components/review.js';
import { submitScore } from '../submit.js';
import { PASS } from '../levels.js';
import { flattenPattern, renderChoiceCard, renderFillCard, renderApplyCard, explainHTML, reviewCardHTML, correctText, KIND_LABEL } from '../components/items.js';

export function mount(stage, ctx) {
  const all = flattenPattern((ctx.data || {}).items);
  const unitId = ctx.unit.id;
  const n = Math.min(ctx.questionCount, all.length);
  let alive = true;
  let onKey = null;
  const unload = (e) => { e.preventDefault(); e.returnValue = ''; };

  if (!all.length) {
    stage.innerHTML = `<div class="empty"><div class="big">${icon.file}</div><p>這個單元還沒有題目。</p></div>`;
    return;
  }
  const kindsIn = [...new Set(all.map((q) => KIND_LABEL[q.kind]))].join('、');

  function startReview(details) {
    document.getElementById('fx').replaceChildren();
    const firstTime = !store.reviewed(unitId);
    const wrong = (details || []).filter((d) => !d.ok);
    mountReview(stage, {
      title: `${ctx.unit.title}｜${firstTime ? '檢討' : '再看一次檢討'}`,
      items: wrong.map((d) => {
        const q = all.find((x) => x.id === d.word);
        return { html: q ? reviewCardHTML(q, d.yours) : `<div class="rv-card"><div class="rv-prompt">${esc(d.q || d.question || '')}</div><div class="rv-row ok"><span>正確答案</span><b class="en">${esc(d.correct || '')}</b></div></div>` };
      }),
      onDone: () => { if (firstTime) completeReview(unitId); gate.redraw(); window.scrollTo(0, 0); },
      onExit: () => { gate.redraw(); window.scrollTo(0, 0); },
    });
    window.scrollTo(0, 0);
  }

  const gate = testGate(stage, {
    timeWindow: () => unitWindow(ctx.config, unitId),
    eyebrow: 'Sentence Patterns',
    title: `${ctx.unit.title}｜${(ctx.data || {}).topic || '句型練習'}`,
    rules: [
      `共 <b>${n}</b> 題，${esc(kindsIn)}混合出現，每次會從題庫（${all.length} 題）重新抽題`,
      '每題作答後馬上看到解析',
      `總分達 <b>${PASS}%</b> 就算通過，做完可以逐題檢討錯題`,
    ],
    best: () => store.best(unitId).pattern,
    review: () => store.done(unitId),
    reviewed: () => store.reviewed(unitId),
    onStart: (s, review) => play(s, review),
    onReview: () => startReview((store.first(unitId) || {}).details),
  });

  function play(student, review = false) {
    const qs = shuffle(all).slice(0, n);
    let qi = 0; let streak = 0; let bestStreak = 0; let points = 0;
    const details = [];
    let current = null;
    const t0 = Date.now();
    document.body.dataset.busy = '1';
    document.getElementById('fx').replaceChildren();
    window.addEventListener('beforeunload', unload);

    stage.innerHTML = `
      <div class="quiz">
        <div class="quiz-bar">
          ${review ? '<span class="level-chip">複習</span>' : ''}
          <div class="bar"><span></span></div>
          <span class="quiz-stat" data-n></span>
          <span class="quiz-stat streak" data-streak title="連續答對">${icon.flame}<b>0</b></span>
        </div>
        <div data-q></div>
        <div class="q-foot"><div class="feedback" data-fb aria-live="polite"></div><button class="btn primary" type="button" data-next hidden></button></div>
      </div>`;
    const nextBtn = stage.querySelector('[data-next]');
    nextBtn.addEventListener('click', () => next());

    function show() {
      const q = qs[qi];
      stage.querySelector('.bar > span').style.width = `${(qi / qs.length) * 100}%`;
      stage.querySelector('[data-n]').textContent = `第 ${qi + 1} / ${qs.length} 題`;
      stage.querySelector('[data-fb]').innerHTML = '';
      nextBtn.hidden = true;
      const host = stage.querySelector('[data-q]');
      host.innerHTML = '';
      const done = (ok, yours) => answered(q, ok, yours);
      if (q.kind === 'mc') current = renderChoiceCard(host, q, { meta: `第 ${qi + 1} 題・選擇`, onAnswer: done });
      else if (q.kind === 'fill') current = renderFillCard(host, q, { meta: `第 ${qi + 1} 題・填空`, onAnswer: done });
      else current = renderApplyCard(host, q, { meta: `第 ${qi + 1} 題・應用`, onAnswer: done });
      centerInView(host.querySelector('.q-card'));
    }

    function answered(q, ok, yours) {
      if (ok) points++;
      details.push({
        stage: '句型練習', n: qi + 1, kind: q.label, q: q.kind === 'apply' ? q.zh : q.stem, correct: correctText(q), yours: String(yours || ''),
        ok, points: ok ? 1 : 0, hints: 0, word: q.id, err: '',
      });
      const fb = stage.querySelector('[data-fb]');
      const st = stage.querySelector('[data-streak]');
      if (ok) {
        streak++; bestStreak = Math.max(bestStreak, streak);
        fb.className = 'feedback ok';
        fb.innerHTML = `${icon.check} ${streak >= 3 ? `連對 ${streak} 題！` : '答對了！'}`;
        st.classList.remove('bump'); void st.offsetWidth; st.classList.add('bump');
      } else {
        streak = 0;
        fb.className = 'feedback no';
        fb.innerHTML = `${icon.x} 看一下解析`;
      }
      st.querySelector('b').textContent = streak;
      stage.querySelector('[data-q]').insertAdjacentHTML('beforeend', explainHTML(q));
      nextBtn.hidden = false;
      nextBtn.innerHTML = qi < qs.length - 1 ? `下一題 ${icon.arrowR}` : `看總成績 ${icon.arrowR}`;
      setTimeout(() => nextBtn.focus({ preventScroll: true }), 30);
    }

    async function next() {
      if (!alive || nextBtn.hidden) return;
      qi++;
      if (qi < qs.length) { await wait(10); show(); return; }
      finish();
    }

    async function finish() {
      current = null;
      delete document.body.dataset.busy;
      window.removeEventListener('beforeunload', unload);
      const pct = Math.round((points / qs.length) * 100);
      const durationSec = Math.round((Date.now() - t0) / 1000);
      const stamp = nowStamp();
      store.setBest(unitId, 'pattern', pct);
      const byKind = {};
      details.forEach((d) => { const k = (byKind[d.kind] = byKind[d.kind] || { ok: 0, n: 0 }); k.n++; if (d.ok) k.ok++; });
      const per = Object.entries(byKind).map(([k, v]) => `${k} ${v.ok}/${v.n}`).join('・');
      const firstTest = !review;
      if (firstTest) store.setFirst(unitId, { mode: 'pattern', details });
      stage.innerHTML = '';
      const bars = `<div class="stage-bars">${Object.entries(byKind).map(([k, v]) => {
        const p = Math.round((v.ok / v.n) * 100);
        return `<div class="stage-bar"><span class="sb-name">${esc(k)}</span><span class="bar"><span style="width:${p}%"></span></span><span class="sb-score">${v.ok}/${v.n}</span></div>`;
      }).join('')}</div>`;
      const wrongN = details.filter((d) => !d.ok).length;
      const actions = [];
      if (firstTest) actions.push({ label: '開始檢討', icon: icon.bulb, primary: true, onClick: () => startReview(details) });
      else {
        if (wrongN) actions.push({ label: `檢討錯的 ${wrongN} 題`, icon: icon.bulb, primary: true, onClick: () => startReview(details) });
        actions.push({ label: '再練一次', icon: icon.shuffle, primary: !wrongN, onClick: () => play(student, true) });
      }
      const box = renderResult(stage, {
        title: `${review ? '複習' : '句型練習'}${pct >= PASS ? '通過！' : '完成'}`,
        pct,
        scoreText: `${points} / ${qs.length}`,
        pills: [`${icon.clock} ${Math.floor(durationSec / 60)} 分 ${durationSec % 60} 秒`, `${icon.flame} 最長連對 ${bestStreak}`],
        extraHTML: `${bars}${stampHTML(student, ctx.unit.title, stamp)}<div data-submit>${submitStateHTML('sending')}</div>`,
        actions,
      });
      const res = await submitScore({
        clientTs: stamp, cls: student.cls, seat: student.seat, name: student.name,
        unit: unitId, unitTitle: ctx.unit.title, mode: 'pattern', review,
        level: `${review ? '複習 · ' : ''}句型練習 ${per}`.slice(0, 60),
        score: points, total: qs.length, pct, durationSec,
        wrong: details.filter((d) => !d.ok).map((d) => d.word),
        details,
      });
      const slot = box.querySelector('[data-submit]');
      if (slot) slot.innerHTML = submitStateHTML(res.status);
    }

    if (onKey) document.removeEventListener('keydown', onKey);
    onKey = (e) => {
      if (e.target.closest('input, textarea, dialog') || !current) return;
      const k = e.key.toLowerCase();
      const map = { 1: 0, 2: 1, 3: 2, 4: 3, a: 0, b: 1, c: 2, d: 3 };
      if (current.choose && k in map) current.choose(map[k]);
      else if (k === 'enter' && !e.target.closest('button') && !nextBtn.hidden) { e.preventDefault(); next(); }
    };
    document.addEventListener('keydown', onKey);
    show();
  }

  return () => {
    alive = false;
    window.removeEventListener('beforeunload', unload);
    if (onKey) document.removeEventListener('keydown', onKey);
  };
}
