// 課文理解：先讀文章，再作答閱讀測驗；交卷後送出成績，再逐題檢討（一次一題，可標出原文依據）
import { store } from '../storage.js';
import { esc, nowStamp, confirmDialog, splitSentences } from '../util.js';
import { icon } from '../icons.js';
import { renderResult } from '../components/result.js';
import { unitWindow } from '../remote-config.js';
import { testGate, submitStateHTML, stampHTML } from '../components/gate.js';
import { mountReview, completeReview } from '../components/review.js';
import { submitScore } from '../submit.js';

const KEYS = ['A', 'B', 'C', 'D', 'E'];

// 引號統一、轉小寫；每個字元一對一替換，所以找到的位置可以直接對回原文
const norm = (s) => String(s).replace(/[‘’]/g, "'").replace(/[“”]/g, '"').toLowerCase();

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
  const nWords = paras.join(' ').split(/\s+/).filter(Boolean).length;
  const minutes = Math.max(1, Math.round(nWords / 150));

  const gate = testGate(stage, {
    timeWindow: () => unitWindow(ctx.config, unitId),
    eyebrow: 'Reading Comprehension',
    title: `${ctx.unit.title}｜${data.title || ''}`,
    rules: [
      `文章約 <b>${nWords}</b> 字，建議閱讀 ${minutes} 分鐘`,
      `共 <b>${qs.length}</b> 題，題目經過改寫，要理解文意才答得出來`,
      '交卷後逐題檢討，看答案、解析與原文依據',
    ],
    best: () => store.best(unitId).reading,
    review: () => store.done(unitId),
    reviewed: () => store.reviewed(unitId),
    onStart: (s, review) => run(s, review),
    onReview: () => startReview(answersFromDetails((store.first(unitId) || {}).details)),
  });

  /* ---------------- 文章與原文依據 ---------------- */
  const sentHTML = (p, i) => splitSentences(p).map((s, j) => `<span class="sent" data-ref="${i + 1}-${j + 1}">${esc(s)}</span>`).join(' ');

  function passageHTML() {
    return `<article class="passage-card">
        <div class="eyebrow">Passage · ${nWords} words</div>
        <h2 class="passage-title en">${esc(data.title || '')}</h2>
        ${paras.map((p, i) => `<p data-p="${i}"><span class="pnum">${i + 1}</span><span class="ptext">${sentHTML(p, i)}</span></p>`).join('')}
      </article>`;
  }

  function clearEvidence() {
    stage.querySelectorAll('.passage-card p[data-p]').forEach((el) => {
      const i = Number(el.dataset.p);
      const t = el.querySelector('.ptext');
      if (t.querySelector('mark.evidence')) t.innerHTML = sentHTML(paras[i], i);
    });
    stage.querySelectorAll('.sent.evidence').forEach((s) => s.classList.remove('evidence'));
  }

  // 有 key（原文關鍵字句）就精準標出那一段；沒有的話退回 ref（整句，可用逗號列多句）
  function findKey(key) {
    const k = norm(String(key || '').replace(/\s+/g, ' ').trim());
    if (!k) return null;
    for (let i = 0; i < paras.length; i++) {
      const at = norm(paras[i]).indexOf(k);
      if (at >= 0) return { i, at, len: k.length };
    }
    return null;
  }
  const hasEvidence = (q) => !!(findKey(q.key) || (q.ref && String(q.ref).split(',').some((r) => stage.querySelector(`.sent[data-ref="${r.trim()}"]`))));

  function showEvidence(q) {
    clearEvidence();
    const hit = findKey(q.key);
    let target = null;
    if (hit) {
      const p = paras[hit.i];
      const t = stage.querySelector(`.passage-card p[data-p="${hit.i}"] .ptext`);
      t.innerHTML = `${esc(p.slice(0, hit.at))}<mark class="evidence">${esc(p.slice(hit.at, hit.at + hit.len))}</mark>${esc(p.slice(hit.at + hit.len))}`;
      target = t.querySelector('mark.evidence');
    } else if (q.ref) {
      String(q.ref).split(',').map((r) => r.trim()).forEach((r) => {
        const s = stage.querySelector(`.sent[data-ref="${r}"]`);
        if (s) { s.classList.add('evidence'); target = target || s; }
      });
    }
    target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  /* ---------------- 作答 ---------------- */
  function run(student, review = false) {
    const answers = new Array(qs.length).fill(null);
    const t0 = Date.now();
    document.body.dataset.busy = '1';
    window.addEventListener('beforeunload', unload);

    stage.innerHTML = `
      <div class="passage-layout">
        ${passageHTML()}
        <section class="pq-list" aria-label="閱讀測驗">
          <div class="pq-intro"><span class="eyebrow">Questions${review ? ' · 複習' : ''}</span><span class="muted">讀完文章後作答，可以隨時回頭查看</span></div>
          ${qs.map((q, i) => `<div class="pq" data-q="${i}">
            <div class="pq-head"><span class="pq-num">${i + 1}</span>
              <div><span class="skill">${esc(q.skill || '')}</span><div class="pq-q">${esc(q.q || '')}</div></div></div>
            <div class="options">${q.options.map((o, j) => `<button class="opt" type="button" data-i="${j}">
              <span class="opt-key">${KEYS[j]}</span><span class="opt-text en">${esc(o)}</span><span class="opt-mark" aria-hidden="true"></span></button>`).join('')}</div>
          </div>`).join('')}
        </section>
      </div>
      <div class="passage-foot">
        <span class="count" data-count></span>
        <button class="btn primary" type="button" data-submit-btn>${icon.send} 交卷</button>
      </div>`;

    const countEl = stage.querySelector('[data-count]');
    const updateFoot = () => { countEl.textContent = `已作答 ${answers.filter((a) => a != null).length} / ${qs.length}`; };

    stage.querySelectorAll('.pq').forEach((card) => {
      const i = Number(card.dataset.q);
      card.querySelectorAll('.opt').forEach((o) => o.addEventListener('click', () => {
        answers[i] = Number(o.dataset.i);
        card.querySelectorAll('.opt').forEach((x, k) => x.classList.toggle('selected', k === answers[i]));
        card.classList.add('done');
        updateFoot();
      }));
    });

    stage.querySelector('[data-submit-btn]').addEventListener('click', async () => {
      const blank = answers.filter((a) => a == null).length;
      const ok = await confirmDialog({
        title: '確定要交卷嗎？',
        body: blank ? `還有 <b>${blank}</b> 題沒有作答。交卷後就不能修改。` : '所有題目都作答了。交卷後就不能修改。',
        ok: '交卷', cancel: '再檢查',
      });
      if (ok && alive) finish(student, review, answers, t0);
    });
    updateFoot();
  }

  async function finish(student, review, answers, t0) {
    window.removeEventListener('beforeunload', unload);
    delete document.body.dataset.busy;
    const score = answers.filter((a, i) => a === qs[i].answer).length;
    const stamp = nowStamp();
    const durationSec = Math.round((Date.now() - t0) / 1000);
    const pct = Math.round((score / qs.length) * 100);
    store.setBest(unitId, 'reading', pct);
    const details = qs.map((q, i) => ({
      stage: '課文理解', n: i + 1, kind: q.skill || '', q: q.q || '', word: `Q${i + 1} ${String(q.q || '').slice(0, 50)}`,
      correct: `${KEYS[q.answer]}. ${q.options[q.answer]}`,
      yours: answers[i] == null ? '' : `${KEYS[answers[i]]}. ${q.options[answers[i]]}`,
      ok: answers[i] === q.answer, points: answers[i] === q.answer ? 1 : 0, hints: 0,
    }));
    const firstTest = !review;
    if (firstTest) store.setFirst(unitId, { mode: 'reading', details });

    stage.innerHTML = '';
    window.scrollTo(0, 0);
    const actions = [{ label: firstTest ? '開始檢討' : '逐題檢討', icon: icon.bulb, primary: true, onClick: () => startReview(answers) }];
    if (!firstTest) actions.push({ label: '再複習一次', icon: icon.redo, onClick: () => run(student, true) });
    const box = renderResult(stage, {
      title: review ? '複習完成' : '交卷完成',
      pct,
      scoreText: `${score} / ${qs.length}`,
      pills: [`${icon.clock} ${Math.floor(durationSec / 60)} 分 ${durationSec % 60} 秒`, firstTest ? '接著逐題檢討，完成後才能複習' : '可以逐題檢討這次的作答'],
      extraHTML: `${stampHTML(student, ctx.unit.title, stamp)}<div data-submit>${submitStateHTML('sending')}</div>`,
      actions,
    });
    const res = await submitScore({
      clientTs: stamp, cls: student.cls, seat: student.seat, name: student.name,
      unit: unitId, unitTitle: ctx.unit.title, mode: 'reading', review, level: review ? '複習 · 課文理解' : '課文理解',
      score, total: qs.length, pct, durationSec,
      wrong: answers.map((a, i) => (a === qs[i].answer ? null : `Q${i + 1}`)).filter(Boolean),
      details,
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

  function reviewItem(q, i, a) {
    const ok = a === q.answer;
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
            <p>${esc(q.explain || '')}</p>
            ${hasEvidence(q) ? `<button class="btn small ghost ref-btn" type="button">${icon.book} 看原文依據</button>` : ''}
          </div>
        </div>`,
      mount: (el) => {
        clearEvidence();
        el.querySelector('.ref-btn')?.addEventListener('click', () => showEvidence(q));
      },
    };
  }

  function startReview(answers) {
    const firstTime = !store.reviewed(unitId);
    stage.innerHTML = `<div class="passage-layout review-layout">${passageHTML()}<section class="pq-list" data-review></section></div>`;
    window.scrollTo(0, 0);
    mountReview(stage.querySelector('[data-review]'), {
      title: `${firstTime ? '檢討' : '再看一次檢討'}｜${data.title || ctx.unit.title}`,
      items: qs.map((q, i) => reviewItem(q, i, answers[i])),
      onDone: () => { if (firstTime) completeReview(unitId); gate.redraw(); window.scrollTo(0, 0); },
      onExit: () => { gate.redraw(); window.scrollTo(0, 0); },
    });
  }

  return () => {
    alive = false;
    window.removeEventListener('beforeunload', unload);
  };
}
