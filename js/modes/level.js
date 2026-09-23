// 單字片語測驗（基礎／進階／精熟）：逐題即時回饋，完成後送出成績
import { store } from '../storage.js';
import { esc, nowStamp, wait } from '../util.js';
import { icon } from '../icons.js';
import { renderMC, renderSpell, promptText, answerText } from '../components/question.js';
import { renderResult } from '../components/result.js';
import { testGate, submitStateHTML, stampHTML } from '../components/gate.js';
import { submitScore } from '../submit.js';
import { LEVELS, PASS, pickWords } from '../levels.js';

const HINT_COST = 0.25;

export function mount(stage, ctx) {
  const level = ctx.level;
  const unitId = ctx.unit.id;
  const all = ctx.allWords;
  const count = Math.min(ctx.questionCount, all.length);
  let alive = true;
  let advanceTimer = null;
  let onKey = null;

  const best = store.best(unitId)[level.id];
  testGate(stage, {
    eyebrow: `${level.en} · 單字片語`,
    title: `${ctx.unit.title}｜${level.name}測驗`,
    rules: [`共 <b>${count}</b> 題：${level.items.join('、')}`, `答對率達 <b>${PASS}%</b> 就算通過這個等級`],
    best,
    onStart: (s) => run(s, pickWords(all, count), true),
  });

  // official = true：完整測驗，完成後送出成績；false：只重練錯題，不送出
  function run(student, words, official) {
    const qs = level.build(words, all);
    let idx = 0; let points = 0; let streak = 0; let bestStreak = 0;
    const wrong = [];
    const t0 = Date.now();
    let current = null;
    document.body.dataset.busy = '1';
    document.getElementById('fx').replaceChildren();

    stage.innerHTML = `
      <div class="quiz">
        <div class="quiz-bar">
          ${official ? '' : '<span class="level-chip">錯題練習</span>'}
          <div class="bar"><span></span></div>
          <span class="quiz-stat" data-n></span>
          <span class="quiz-stat streak" data-streak title="連續答對">${icon.flame}<b>0</b></span>
        </div>
        <div data-q></div>
        <div class="q-foot"><div class="feedback" data-fb aria-live="polite"></div><button class="btn primary" type="button" data-next hidden></button></div>
      </div>`;
    const nextBtn = stage.querySelector('[data-next]');
    nextBtn.addEventListener('click', next);

    function show() {
      stage.querySelector('.bar > span').style.width = `${(idx / qs.length) * 100}%`;
      stage.querySelector('[data-n]').textContent = `${idx + 1} / ${qs.length}`;
      stage.querySelector('[data-fb]').innerHTML = '';
      nextBtn.hidden = true;
      const host = stage.querySelector('[data-q]');
      host.innerHTML = '';
      const q = qs[idx];
      current = q.type === 'mc'
        ? renderMC(host, q, { onAnswer: (ok, chosen) => answered(q, ok, ok ? 1 : 0, q.options[chosen]) })
        : renderSpell(host, q, { onAnswer: (ok, { hints, typed }) => answered(q, ok, ok ? Math.max(0, 1 - hints * HINT_COST) : 0, typed, hints) });
    }

    function answered(q, ok, got, yours, hints = 0) {
      points += got;
      const fb = stage.querySelector('[data-fb]');
      const st = stage.querySelector('[data-streak]');
      if (ok) {
        streak++; bestStreak = Math.max(bestStreak, streak);
        fb.className = 'feedback ok';
        fb.innerHTML = `${icon.check} ${hints ? `答對（提示 ${hints} 次）` : streak >= 3 ? `連對 ${streak} 題！` : '答對了！'}`;
        st.classList.remove('bump'); void st.offsetWidth; st.classList.add('bump');
      } else {
        streak = 0;
        wrong.push({ q, yours });
        store.addWrong(unitId, q.word.word);
        fb.className = 'feedback no';
        fb.innerHTML = q.type === 'mc' ? `${icon.x} 正確答案：<b class="en">${esc(answerText(q))}</b>` : `${icon.x} 再記一下`;
      }
      st.querySelector('b').textContent = streak;
      nextBtn.hidden = false;
      nextBtn.innerHTML = idx === qs.length - 1 ? `看成績 ${icon.arrowR}` : `下一題 ${icon.arrowR}`;
      setTimeout(() => nextBtn.focus({ preventScroll: true }), 30);
      if (ok && q.type === 'mc') { clearTimeout(advanceTimer); advanceTimer = setTimeout(() => alive && next(), 1100); }
    }

    async function next() {
      clearTimeout(advanceTimer);
      if (!alive || nextBtn.hidden) return;
      idx++;
      if (idx >= qs.length) { finish(); return; }
      await wait(10);
      show();
    }

    async function finish() {
      current = null;
      delete document.body.dataset.busy;
      const pct = Math.round((points / qs.length) * 100);
      const durationSec = Math.round((Date.now() - t0) / 1000);
      const stamp = nowStamp();
      if (official) store.setBest(unitId, level.id, pct);
      const passed = pct >= PASS;
      const nextLevel = LEVELS[LEVELS.findIndex((l) => l.id === level.id) + 1];
      const nextOpen = nextLevel && ctx.levels.some((l) => l.id === nextLevel.id);
      stage.innerHTML = '';
      const actions = [];
      if (passed && nextOpen && official) actions.push({ label: `挑戰${nextLevel.name}`, icon: icon.arrowR, primary: true, onClick: () => ctx.go(nextLevel.id) });
      if (wrong.length) actions.push({ label: `練習錯的 ${wrong.length} 題`, icon: icon.redo, primary: !actions.length, onClick: () => run(student, wrong.map((w) => w.q.word), false) });
      actions.push({ label: '重新測驗', icon: icon.shuffle, primary: !actions.length, onClick: () => run(student, pickWords(all, count), true) });
      const box = renderResult(stage, {
        title: official ? (passed ? `${level.name}通過！` : `${level.name}測驗完成`) : '錯題練習完成',
        pct,
        scoreText: `${fmt(points)} / ${qs.length}`,
        pills: [`${level.name}`, `${icon.clock} ${Math.floor(durationSec / 60)} 分 ${durationSec % 60} 秒`, `${icon.flame} 最長連對 ${bestStreak}`],
        extraHTML: official ? `${stampHTML(student, `${ctx.unit.title}｜${level.name}`, stamp)}<div data-submit>${submitStateHTML('sending')}</div>`
          : '<p class="muted" style="margin:0">錯題練習不會送出成績</p>',
        wrong: wrong.map((w) => ({ p: promptText(w.q), a: answerText(w.q), y: w.yours })),
        actions,
      });
      if (!official) return;
      const res = await submitScore({
        clientTs: stamp, cls: student.cls, seat: student.seat, name: student.name,
        unit: unitId, unitTitle: ctx.unit.title, mode: `vocab-${level.id}`, level: level.name,
        score: Number(fmt(points)), total: qs.length, pct, durationSec,
        wrong: wrong.map((w) => w.q.word.word),
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
    clearTimeout(advanceTimer);
    if (onKey) document.removeEventListener('keydown', onKey);
  };
}

const fmt = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0$/, ''));
