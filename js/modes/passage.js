// 題組引擎：閱讀／文法／克漏字。文章中的 {{n}} 會變成可點擊的空格。
// 練習模式即時回饋＋詳解；正式測驗交卷後才顯示，並送出成績。
import { store } from '../storage.js';
import { esc, nowStamp, confirmDialog } from '../util.js';
import { icon } from '../icons.js';
import { renderResult } from '../components/result.js';
import { examGate, submitStateHTML, stampHTML } from '../components/exam-gate.js';
import { submitScore } from '../submit.js';

const KEYS = ['A', 'B', 'C', 'D', 'E'];

export function mount(stage, ctx) {
  const data = ctx.data;
  const qs = data.questions || [];
  const isExam = ctx.mode === 'exam';
  let alive = true;
  const unload = (e) => { e.preventDefault(); e.returnValue = ''; };

  if (!qs.length) {
    stage.innerHTML = '<div class="empty"><div class="big">📄</div><p>這個單元還沒有題目。</p></div>';
    return;
  }

  if (isExam) {
    examGate(stage, ctx, { count: qs.length, rules: '閱讀文章後作答', onStart: (s) => run(s) });
  } else {
    run(null);
  }

  function run(student) {
    const answers = new Array(qs.length).fill(null);
    let graded = false;
    const t0 = Date.now();
    if (isExam) { document.body.dataset.busy = '1'; window.addEventListener('beforeunload', unload); }

    const paraHTML = (p) => esc(p).replace(/\{\{(\d+)\}\}/g, (_, n) => {
      const i = Number(n) - 1;
      return `<button class="blank-chip" type="button" data-blank="${i}" aria-label="第 ${n} 題空格"><span class="n">${n}</span><span class="fill">&nbsp;</span></button>`;
    });
    const hasBlanks = (data.passage || []).some((p) => /\{\{\d+\}\}/.test(p));

    stage.innerHTML = `
      <div class="summary-slot" data-summary></div>
      <div class="passage-layout">
        <article class="card passage-card">
          <div class="eyebrow">${esc(data.kind === 'cloze' ? 'Cloze' : data.kind === 'grammar' ? 'Grammar' : 'Reading')}</div>
          ${data.instructions ? `<p class="instr">${esc(data.instructions)}</p>` : ''}
          ${(data.passage || []).map((p) => `<p>${paraHTML(p)}</p>`).join('')}
        </article>
        <section class="pq-list">
          ${qs.map((q, i) => `<div class="card pq" id="pq-${i}" data-q="${i}">
            <div class="pq-head"><span class="pq-num">${i + 1}</span>
              <span class="pq-q">${q.q ? esc(q.q) : `<span class="muted">${hasBlanks ? `選出空格 ${i + 1} 的最佳答案` : ''}</span>`}</span></div>
            <div class="options">${q.options.map((o, j) => `<button class="opt" type="button" data-i="${j}">
              <span class="opt-key">${KEYS[j]}</span><span class="opt-text en">${esc(o)}</span><span class="opt-mark" aria-hidden="true"></span></button>`).join('')}</div>
            <div class="explain" hidden></div>
          </div>`).join('')}
        </section>
      </div>
      <div class="passage-foot">
        <span class="count" data-count></span>
        <button class="btn primary" type="button" data-submit-btn></button>
      </div>`;

    const foot = stage.querySelector('[data-submit-btn]');
    const countEl = stage.querySelector('[data-count]');
    const updateFoot = () => {
      const n = answers.filter((a) => a != null).length;
      countEl.textContent = graded ? `得分 ${score()} / ${qs.length}` : `已作答 ${n} / ${qs.length}`;
      if (isExam) {
        foot.innerHTML = graded ? `${icon.check} 已交卷` : `${icon.send} 交卷`;
        foot.disabled = graded;
      } else {
        foot.innerHTML = `${icon.redo} 重做`;
        foot.hidden = n === 0;
      }
    };
    const score = () => answers.filter((a, i) => a === qs[i].answer).length;

    const setBlank = (i, cls) => {
      const chip = stage.querySelector(`[data-blank="${i}"]`);
      if (!chip) return;
      chip.querySelector('.fill').textContent = answers[i] == null ? ' ' : qs[i].options[answers[i]];
      chip.classList.toggle('filled', answers[i] != null);
      chip.classList.remove('ok', 'no', 'flash');
      if (cls) chip.classList.add(cls);
      void chip.offsetWidth;
      chip.classList.add('flash');
    };

    const reveal = (i) => {
      const card = stage.querySelector(`[data-q="${i}"]`);
      const q = qs[i];
      const ok = answers[i] === q.answer;
      card.querySelectorAll('.opt').forEach((o, j) => {
        o.disabled = true;
        o.classList.remove('selected');
        if (j === q.answer) { o.classList.add('correct'); if (!ok) o.classList.add('reveal'); o.querySelector('.opt-mark').innerHTML = icon.check; }
        else if (j === answers[i]) { o.classList.add('wrong'); o.querySelector('.opt-mark').innerHTML = icon.x; }
        else o.classList.add('dim');
      });
      if (q.explain) {
        const ex = card.querySelector('.explain');
        ex.hidden = false;
        ex.innerHTML = `<b>${ok ? '✓ 答對' : `✗ 正解是 ${KEYS[q.answer]}`}</b>　${esc(q.explain)}`;
      }
      setBlank(i, ok ? 'ok' : 'no');
    };

    stage.querySelectorAll('.pq').forEach((card) => {
      const i = Number(card.dataset.q);
      card.querySelectorAll('.opt').forEach((o) => o.addEventListener('click', () => {
        if (graded) return;
        const j = Number(o.dataset.i);
        if (!isExam) {
          if (answers[i] != null) return;
          answers[i] = j;
          reveal(i);
          updateFoot();
          if (answers.every((a) => a != null)) practiceDone();
          else {
            const nextQ = answers.findIndex((a, k) => k > i && a == null);
            if (nextQ > -1) setTimeout(() => alive && scrollToQ(nextQ, false), 700);
          }
          return;
        }
        answers[i] = j;
        card.querySelectorAll('.opt').forEach((x, k) => x.classList.toggle('selected', k === j));
        setBlank(i, null);
        updateFoot();
      }));
    });

    const scrollToQ = (i, flash = true) => {
      const card = stage.querySelector(`#pq-${i}`);
      if (!card) return;
      card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      if (flash) { card.classList.remove('flash'); void card.offsetWidth; card.classList.add('flash'); }
    };
    stage.querySelectorAll('[data-blank]').forEach((b) => b.addEventListener('click', () => scrollToQ(Number(b.dataset.blank))));

    foot.addEventListener('click', async () => {
      if (!isExam) { run(null); window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
      if (graded) return;
      const blank = answers.filter((a) => a == null).length;
      const ok = await confirmDialog({
        title: '確定要交卷嗎？',
        body: blank ? `還有 <b>${blank}</b> 題沒有作答。交卷後就不能修改。` : '所有題目都作答了。交卷後就不能修改。',
        ok: '交卷', cancel: '再檢查',
      });
      if (ok && alive) examDone();
    });

    function summary(extraHTML = '', actions = []) {
      const slot = stage.querySelector('[data-summary]');
      slot.innerHTML = '';
      const pct = Math.round((score() / qs.length) * 100);
      const box = renderResult(slot, {
        pct,
        scoreText: `${score()} / ${qs.length}`,
        extraHTML,
        actions,
      });
      slot.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return { box, pct };
    }

    function practiceDone() {
      graded = true;
      updateFoot();
      foot.hidden = false;
      const { pct } = summary('', [
        { label: '重做一次', icon: icon.redo, primary: true, onClick: () => { run(null); window.scrollTo({ top: 0, behavior: 'smooth' }); } },
        ...(ctx.exam.open ? [{ label: '去正式測驗', icon: icon.trophy, onClick: () => ctx.go('exam') }] : []),
      ]);
      store.setBest(ctx.unit.id, 'practice', pct);
    }

    async function examDone() {
      graded = true;
      window.removeEventListener('beforeunload', unload);
      delete document.body.dataset.busy;
      qs.forEach((_, i) => reveal(i));
      updateFoot();
      const stamp = nowStamp();
      const durationSec = Math.round((Date.now() - t0) / 1000);
      const { box, pct } = summary(
        `${stampHTML(student, ctx.unit.title, stamp)}<div data-submit>${submitStateHTML('sending')}</div>`,
        [{ label: '回到練習', icon: icon.book, onClick: () => ctx.go('practice') }],
      );
      store.setBest(ctx.unit.id, 'exam', pct);
      const res = await submitScore({
        clientTs: stamp,
        cls: student.cls,
        seat: student.seat,
        name: student.name,
        unit: ctx.unit.id,
        unitTitle: ctx.unit.title,
        mode: `${data.kind || 'passage'}-exam`,
        score: score(),
        total: qs.length,
        pct,
        durationSec,
        wrong: answers.map((a, i) => (a === qs[i].answer ? null : `Q${i + 1}`)).filter(Boolean),
      });
      const slot = box.querySelector('[data-submit]');
      if (slot) slot.innerHTML = submitStateHTML(res.status);
    }

    updateFoot();
  }

  return () => {
    alive = false;
    window.removeEventListener('beforeunload', unload);
  };
}
