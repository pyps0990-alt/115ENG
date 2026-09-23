// 單字正式測驗：選擇＋拼字混合，作答中不顯示對錯，交卷後送出成績
import { store } from '../storage.js';
import { sample, shuffle, nowStamp, confirmDialog } from '../util.js';
import { icon } from '../icons.js';
import { buildMC, buildSpell, renderMC, renderSpell, gradeMC, gradeSpell, promptText, answerText } from '../components/question.js';
import { renderResult } from '../components/result.js';
import { examGate, submitStateHTML, stampHTML } from '../components/exam-gate.js';
import { submitScore } from '../submit.js';

export function mount(stage, ctx) {
  const words = ctx.allWords;
  const count = Math.min(ctx.exam.count, words.length);
  let alive = true;
  const unload = (e) => { e.preventDefault(); e.returnValue = ''; };

  examGate(stage, ctx, { count, rules: '選擇題與拼字題各半', onStart: (s) => run(s) });

  function run(student) {
    document.body.dataset.busy = '1';
    window.addEventListener('beforeunload', unload);
    const picked = sample(words, count);
    const qs = shuffle(picked.map((w, i) => (i % 2 === 0 ? buildMC(w, words, 'mix') : buildSpell(w, 'spell'))));
    const answers = new Array(qs.length).fill(null);
    const t0 = Date.now();
    let idx = 0;

    stage.innerHTML = `
      <div class="quiz">
        <div class="quiz-bar"><div class="bar"><span></span></div><span class="quiz-stat" data-n></span></div>
        <div data-q></div>
        <div class="q-foot">
          <button class="btn ghost" type="button" data-prev>${icon.back} 上一題</button>
          <button class="btn primary" type="button" data-next></button>
        </div>
      </div>`;
    const prevBtn = stage.querySelector('[data-prev]');
    const nextBtn = stage.querySelector('[data-next]');

    const show = () => {
      stage.querySelector('.bar > span').style.width = `${(answers.filter((a) => a != null && a !== '').length / qs.length) * 100}%`;
      stage.querySelector('[data-n]').textContent = `${idx + 1} / ${qs.length}`;
      prevBtn.disabled = idx === 0;
      nextBtn.innerHTML = idx === qs.length - 1 ? `${icon.send} 交卷` : `下一題 ${icon.arrowR}`;
      const host = stage.querySelector('[data-q]');
      host.innerHTML = '';
      const q = qs[idx];
      const label = `第 ${idx + 1} 題 · ${q.type === 'mc' ? (q.dir === 'en2zh' ? '選出中文意思' : '選出英文單字') : '看中文拼出英文'}`;
      const refresh = () => { stage.querySelector('.bar > span').style.width = `${(answers.filter((a) => a != null && a !== '').length / qs.length) * 100}%`; };
      if (q.type === 'mc') renderMC(host, q, { feedback: false, label, selected: answers[idx], onAnswer: (i) => { answers[idx] = i; refresh(); } });
      else renderSpell(host, q, { feedback: false, label, value: answers[idx] || '', onInput: (v) => { answers[idx] = v; refresh(); } });
    };

    prevBtn.onclick = () => { if (idx > 0) { idx--; show(); } };
    nextBtn.onclick = async () => {
      if (idx < qs.length - 1) { idx++; show(); return; }
      const blank = answers.filter((a) => a == null || a === '').length;
      const ok = await confirmDialog({
        title: '確定要交卷嗎？',
        body: blank ? `還有 <b>${blank}</b> 題沒有作答。交卷後就不能修改。` : '所有題目都作答了。交卷後就不能修改。',
        ok: '交卷',
        cancel: '再檢查',
      });
      if (ok && alive) finish();
    };

    async function finish() {
      window.removeEventListener('beforeunload', unload);
      delete document.body.dataset.busy;
      const results = qs.map((q, i) => (q.type === 'mc' ? gradeMC(q, answers[i]) : gradeSpell(q, answers[i] || '')));
      const score = results.filter(Boolean).length;
      const pct = Math.round((score / qs.length) * 100);
      const stamp = nowStamp();
      const durationSec = Math.round((Date.now() - t0) / 1000);
      store.setBest(ctx.unit.id, 'exam', pct);
      const wrong = qs.map((q, i) => ({ q, i })).filter(({ i }) => !results[i]);
      wrong.forEach(({ q }) => store.addWrong(ctx.unit.id, q.word.word));

      stage.innerHTML = '';
      const box = renderResult(stage, {
        title: `${ctx.unit.title} 測驗完成`,
        pct,
        scoreText: `${score} / ${qs.length}`,
        pills: [`${icon.clock} ${Math.floor(durationSec / 60)} 分 ${durationSec % 60} 秒`],
        extraHTML: `${stampHTML(student, ctx.unit.title, stamp)}<div data-submit>${submitStateHTML('sending')}</div>`,
        wrong: wrong.map(({ q, i }) => ({
          p: promptText(q),
          a: answerText(q),
          y: q.type === 'mc' ? (answers[i] == null ? '（未作答）' : q.options[answers[i]]) : (answers[i] || '（未作答）'),
        })),
        actions: [
          { label: '練習錯的字', icon: icon.redo, primary: true, onClick: () => { ctx.setScope('weak'); ctx.go('flashcards'); } },
          { label: '回單元首頁', icon: icon.list, onClick: () => ctx.go('list') },
        ],
      });
      const res = await submitScore({
        clientTs: stamp,
        cls: student.cls,
        seat: student.seat,
        name: student.name,
        unit: ctx.unit.id,
        unitTitle: ctx.unit.title,
        mode: 'vocab-exam',
        score,
        total: qs.length,
        pct,
        durationSec,
        wrong: wrong.map(({ q }) => q.word.word),
      });
      const slot = box.querySelector('[data-submit]');
      if (slot) slot.innerHTML = submitStateHTML(res.status);
    }

    show();
  }

  return () => {
    alive = false;
    window.removeEventListener('beforeunload', unload);
  };
}

