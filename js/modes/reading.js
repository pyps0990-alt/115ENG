// 課文理解：先讀文章，再作答閱讀測驗；交卷後顯示解析並送出成績
import { store } from '../storage.js';
import { esc, nowStamp, confirmDialog } from '../util.js';
import { icon } from '../icons.js';
import { renderResult } from '../components/result.js';
import { testGate, submitStateHTML, stampHTML } from '../components/gate.js';
import { submitScore } from '../submit.js';

const KEYS = ['A', 'B', 'C', 'D', 'E'];

export function mount(stage, ctx) {
  const data = ctx.data;
  const qs = data.questions || [];
  let alive = true;
  const unload = (e) => { e.preventDefault(); e.returnValue = ''; };

  if (!qs.length) {
    stage.innerHTML = '<div class="empty"><div class="big">📄</div><p>這個單元還沒有題目。</p></div>';
    return;
  }
  const nWords = (data.passage || []).join(' ').split(/\s+/).filter(Boolean).length;
  const minutes = Math.max(1, Math.round(nWords / 150));

  testGate(stage, {
    eyebrow: 'Reading Comprehension',
    title: `${ctx.unit.title}｜${data.title || ''}`,
    rules: [
      `文章約 <b>${nWords}</b> 字，建議閱讀 ${minutes} 分鐘`,
      `共 <b>${qs.length}</b> 題，題目經過改寫，要理解文意才答得出來`,
      '交卷後才公布答案與解析',
    ],
    best: store.best(ctx.unit.id).reading,
    onStart: (s) => run(s),
  });

  function run(student) {
    const answers = new Array(qs.length).fill(null);
    let graded = false;
    const t0 = Date.now();
    document.body.dataset.busy = '1';
    window.addEventListener('beforeunload', unload);

    stage.innerHTML = `
      <div class="summary-slot" data-summary></div>
      <div class="passage-layout">
        <article class="passage-card">
          <div class="eyebrow">Passage · ${nWords} words</div>
          <h2 class="passage-title en">${esc(data.title || '')}</h2>
          ${(data.passage || []).map((p, i) => `<p><span class="pnum">${i + 1}</span>${esc(p)}</p>`).join('')}
        </article>
        <section class="pq-list" aria-label="閱讀測驗">
          <div class="pq-intro"><span class="eyebrow">Questions</span><span class="muted">讀完文章後作答，可以隨時回頭查看</span></div>
          ${qs.map((q, i) => `<div class="pq" id="pq-${i}" data-q="${i}">
            <div class="pq-head"><span class="pq-num">${i + 1}</span>
              <div><span class="skill">${esc(q.skill || '')}</span><div class="pq-q">${esc(q.q || '')}</div></div></div>
            <div class="options">${q.options.map((o, j) => `<button class="opt" type="button" data-i="${j}">
              <span class="opt-key">${KEYS[j]}</span><span class="opt-text en">${esc(o)}</span><span class="opt-mark" aria-hidden="true"></span></button>`).join('')}</div>
            <div class="explain" hidden></div>
          </div>`).join('')}
        </section>
      </div>
      <div class="passage-foot">
        <span class="count" data-count></span>
        <button class="btn primary" type="button" data-submit-btn>${icon.send} 交卷</button>
      </div>`;

    const foot = stage.querySelector('[data-submit-btn]');
    const countEl = stage.querySelector('[data-count]');
    const score = () => answers.filter((a, i) => a === qs[i].answer).length;
    const updateFoot = () => {
      const n = answers.filter((a) => a != null).length;
      countEl.textContent = graded ? `得分 ${score()} / ${qs.length}` : `已作答 ${n} / ${qs.length}`;
      foot.innerHTML = graded ? `${icon.redo} 重新作答` : `${icon.send} 交卷`;
    };

    stage.querySelectorAll('.pq').forEach((card) => {
      const i = Number(card.dataset.q);
      card.querySelectorAll('.opt').forEach((o) => o.addEventListener('click', () => {
        if (graded) return;
        answers[i] = Number(o.dataset.i);
        card.querySelectorAll('.opt').forEach((x, k) => x.classList.toggle('selected', k === answers[i]));
        card.classList.add('done');
        updateFoot();
      }));
    });

    foot.addEventListener('click', async () => {
      if (graded) { run(student); window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
      const blank = answers.filter((a) => a == null).length;
      const ok = await confirmDialog({
        title: '確定要交卷嗎？',
        body: blank ? `還有 <b>${blank}</b> 題沒有作答。交卷後就不能修改。` : '所有題目都作答了。交卷後就不能修改。',
        ok: '交卷', cancel: '再檢查',
      });
      if (ok && alive) finish();
    });

    function reveal(i) {
      const card = stage.querySelector(`[data-q="${i}"]`);
      const q = qs[i];
      const ok = answers[i] === q.answer;
      card.classList.add(ok ? 'is-ok' : 'is-no');
      card.querySelectorAll('.opt').forEach((o, j) => {
        o.disabled = true;
        o.classList.remove('selected');
        if (j === q.answer) { o.classList.add('correct'); if (!ok) o.classList.add('reveal'); o.querySelector('.opt-mark').innerHTML = icon.check; }
        else if (j === answers[i]) { o.classList.add('wrong'); o.querySelector('.opt-mark').innerHTML = icon.x; }
        else o.classList.add('dim');
      });
      const ex = card.querySelector('.explain');
      ex.hidden = false;
      ex.innerHTML = `<b>${ok ? '✓ 答對' : answers[i] == null ? `未作答・正解 ${KEYS[q.answer]}` : `✗ 正解 ${KEYS[q.answer]}`}</b>　${esc(q.explain || '')}`;
    }

    async function finish() {
      graded = true;
      window.removeEventListener('beforeunload', unload);
      delete document.body.dataset.busy;
      qs.forEach((_, i) => reveal(i));
      updateFoot();
      const stamp = nowStamp();
      const durationSec = Math.round((Date.now() - t0) / 1000);
      const pct = Math.round((score() / qs.length) * 100);
      store.setBest(ctx.unit.id, 'reading', pct);
      const slot = stage.querySelector('[data-summary]');
      const box = renderResult(slot, {
        pct,
        scoreText: `${score()} / ${qs.length}`,
        pills: [`${icon.clock} ${Math.floor(durationSec / 60)} 分 ${durationSec % 60} 秒`, '往下看每題解析'],
        extraHTML: `${stampHTML(student, ctx.unit.title, stamp)}<div data-submit>${submitStateHTML('sending')}</div>`,
        actions: [{ label: '重新作答', icon: icon.redo, onClick: () => { run(student); window.scrollTo({ top: 0, behavior: 'smooth' }); } }],
      });
      slot.scrollIntoView({ behavior: 'smooth', block: 'start' });
      const res = await submitScore({
        clientTs: stamp, cls: student.cls, seat: student.seat, name: student.name,
        unit: ctx.unit.id, unitTitle: ctx.unit.title, mode: 'reading', level: '課文理解',
        score: score(), total: qs.length, pct, durationSec,
        wrong: answers.map((a, i) => (a === qs[i].answer ? null : `Q${i + 1}`)).filter(Boolean),
      });
      const s = box.querySelector('[data-submit]');
      if (s) s.innerHTML = submitStateHTML(res.status);
    }

    updateFoot();
  }

  return () => {
    alive = false;
    window.removeEventListener('beforeunload', unload);
  };
}
