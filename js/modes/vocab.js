// 單字片語測驗：同一組單字，依序連續完成基礎 → 進階 → 精熟三段，最後一張總成績單
import { store } from '../storage.js';
import { esc, nowStamp, wait, shuffle } from '../util.js';
import { icon } from '../icons.js';
import { renderMC, renderSpell, promptText, answerText, explainWrong } from '../components/question.js';
import { renderResult } from '../components/result.js';
import { testGate, submitStateHTML, stampHTML } from '../components/gate.js';
import { submitScore } from '../submit.js';
import { PASS, pickWords } from '../levels.js';

const HINT_COST = 0.25;
const fmt = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0$/, ''));

export function mount(stage, ctx) {
  const levels = ctx.levels;
  const all = ctx.allWords;
  const unitId = ctx.unit.id;
  const n = Math.min(ctx.questionCount, all.length);
  let alive = true;
  let advanceTimer = null;
  let onKey = null;
  const unload = (e) => { e.preventDefault(); e.returnValue = ''; };

  testGate(stage, {
    eyebrow: levels.map((l) => l.en).join(' → '),
    title: `${ctx.unit.title}連續測驗`,
    rules: [
      `連續 <b>${levels.length}</b> 段，每段 <b>${n}</b> 題，共 <b>${levels.length * n}</b> 題，同一組單字片語越考越難`,
      ...levels.map((l, i) => `第 ${i + 1} 段 <b>${l.name}</b>：${esc(l.desc)}`),
      `三段總分達 <b>${PASS}%</b> 就算通過`,
    ],
    best: store.best(unitId).vocab,
    onStart: (s) => play(s, levels.map((l) => ({ level: l, words: pickedWords() })), true),
  });

  let picked = null;
  function pickedWords() {
    // 三段共用同一組單字，第一次呼叫時抽字
    if (!picked) picked = pickWords(all, n);
    return picked;
  }

  // stagesIn: [{ level, words }]；official=false 為錯題練習，不送出成績
  function play(student, stagesIn, official) {
    picked = null;
    const stages = stagesIn.map(({ level, words }) => ({ level, qs: level.build(shuffle(words), all), points: 0, wrong: [] }));
    const total = stages.reduce((s, x) => s + x.qs.length, 0);
    let si = 0; let qi = 0; let done = 0; let streak = 0; let bestStreak = 0;
    const details = [];
    let current = null;
    let inCard = false;
    const t0 = Date.now();
    document.body.dataset.busy = '1';
    document.getElementById('fx').replaceChildren();
    if (official) window.addEventListener('beforeunload', unload);

    stage.innerHTML = `
      <div class="quiz">
        <ol class="stepper" aria-label="測驗進度">${stages.map((s, i) => `<li data-step="${i}">
          <span class="step-dot">${i + 1}</span><span class="step-name">${s.level.name}</span><span class="step-score"></span></li>`).join('')}</ol>
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
    const foot = stage.querySelector('.q-foot');
    nextBtn.addEventListener('click', next);

    const paintStepper = () => {
      stage.querySelectorAll('[data-step]').forEach((li, i) => {
        const s = stages[i];
        li.classList.toggle('now', i === si && !s.finished);
        li.classList.toggle('done', !!s.finished);
        li.querySelector('.step-dot').innerHTML = s.finished ? icon.check : String(i + 1);
        li.querySelector('.step-score').textContent = s.finished ? `${fmt(s.points)}/${s.qs.length}` : '';
      });
      stage.querySelector('.bar > span').style.width = `${(done / total) * 100}%`;
      stage.querySelector('[data-n]').textContent = `${Math.min(done + 1, total)} / ${total}`;
    };

    function show() {
      inCard = false;
      paintStepper();
      foot.hidden = false;
      stage.querySelector('[data-fb]').innerHTML = '';
      nextBtn.hidden = true;
      const host = stage.querySelector('[data-q]');
      host.innerHTML = '';
      const s = stages[si];
      const q = s.qs[qi];
      const label = `${s.level.name}・第 ${qi + 1} 題`;
      current = q.type === 'mc'
        ? renderMC(host, q, { label: `${label}・${q.dir === 'en2zh' ? '選出中文意思' : q.dir === 'cloze' ? '選出空格的字詞' : '選出英文字詞'}`, onAnswer: (ok, chosen) => answered(q, ok, ok ? 1 : 0, q.options[chosen]) })
        : renderSpell(host, q, { label: `${label}・${q.variant === 'cloze' ? '拼出空格的字詞' : '看中文拼出英文'}`, onAnswer: (ok, { hints, typed }) => answered(q, ok, ok ? Math.max(0, 1 - hints * HINT_COST) : 0, typed, hints) });
    }

    function answered(q, ok, got, yours, hints = 0) {
      const s = stages[si];
      s.points += got;
      details.push({
        stage: s.level.name, n: qi + 1, kind: q.type === 'mc' ? (q.dir === 'en2zh' ? '英→中' : q.dir === 'cloze' ? '例句選字' : '中→英') : (q.variant === 'cloze' ? '例句拼寫' : '拼字'),
        q: promptText(q), correct: answerText(q), yours: yours == null ? '' : String(yours), ok, points: got, hints,
      });
      const fb = stage.querySelector('[data-fb]');
      const st = stage.querySelector('[data-streak]');
      if (ok) {
        streak++; bestStreak = Math.max(bestStreak, streak);
        fb.className = 'feedback ok';
        fb.innerHTML = `${icon.check} ${hints ? `答對（提示 ${hints} 次）` : streak >= 3 ? `連對 ${streak} 題！` : '答對了！'}`;
        st.classList.remove('bump'); void st.offsetWidth; st.classList.add('bump');
      } else {
        streak = 0;
        const xp = explainWrong(q, yours, all);
        s.wrong.push({ q, yours, xp: xp.text });
        store.addWrong(unitId, q.word.word);
        stage.querySelector('[data-q]').insertAdjacentHTML('beforeend', xp.html);
        fb.className = 'feedback no';
        fb.innerHTML = q.type === 'mc' ? `${icon.x} 正確答案：<b class="en">${esc(answerText(q))}</b>` : `${icon.x} 再記一下`;
      }
      st.querySelector('b').textContent = streak;
      const lastInStage = qi === s.qs.length - 1;
      nextBtn.hidden = false;
      nextBtn.innerHTML = !lastInStage ? `下一題 ${icon.arrowR}` : si === stages.length - 1 ? `看總成績 ${icon.arrowR}` : `完成${s.level.name} ${icon.arrowR}`;
      setTimeout(() => nextBtn.focus({ preventScroll: true }), 30);
      if (ok && q.type === 'mc') { clearTimeout(advanceTimer); advanceTimer = setTimeout(() => alive && next(), 1100); }
    }

    async function next() {
      clearTimeout(advanceTimer);
      if (!alive || nextBtn.hidden || inCard) return;
      done++;
      qi++;
      if (qi < stages[si].qs.length) { await wait(10); show(); return; }
      stages[si].finished = true;
      if (si === stages.length - 1) { finish(); return; }
      stageCard();
    }

    // 段落之間的過場卡：顯示這段成績與下一段說明，不回到選單
    function stageCard() {
      inCard = true;
      current = null;
      const s = stages[si];
      const nx = stages[si + 1];
      paintStepper();
      foot.hidden = true;
      const pct = Math.round((s.points / s.qs.length) * 100);
      const host = stage.querySelector('[data-q]');
      host.innerHTML = `<div class="stage-card slide-in">
          <div class="stage-done"><span class="stage-badge">${icon.check}</span><div><div class="eyebrow">第 ${si + 1} 段完成</div><h2>${s.level.name}</h2></div>
            <div class="stage-score"><b>${fmt(s.points)}</b> / ${s.qs.length}<span>${pct}%</span></div></div>
          <div class="stage-next">
            <div class="eyebrow">下一段 · 第 ${si + 2} 段</div>
            <h3>${nx.level.name}<span class="en">${nx.level.en}</span></h3>
            <p>${esc(nx.level.desc)}</p>
            <ul>${nx.level.items.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
          </div>
          <button class="btn primary" type="button" data-continue>繼續：${nx.level.name} ${icon.arrowR}</button>
        </div>`;
      const btn = host.querySelector('[data-continue]');
      btn.addEventListener('click', () => { si++; qi = 0; show(); });
      setTimeout(() => btn.focus({ preventScroll: true }), 30);
    }

    async function finish() {
      current = null;
      delete document.body.dataset.busy;
      window.removeEventListener('beforeunload', unload);
      const points = stages.reduce((s, x) => s + x.points, 0);
      const pct = Math.round((points / total) * 100);
      const durationSec = Math.round((Date.now() - t0) / 1000);
      const stamp = nowStamp();
      const per = Object.fromEntries(stages.map((s) => [s.level.id, `${fmt(s.points)}/${s.qs.length}`]));
      if (official) {
        store.setBest(unitId, 'vocab', pct);
        store.setLast(unitId, Object.fromEntries(stages.map((s) => [s.level.id, Math.round((s.points / s.qs.length) * 100)])));
      }
      const wrong = stages.flatMap((s) => s.wrong.map((w) => ({ ...w, level: s.level })));
      stage.innerHTML = '';
      const bars = `<div class="stage-bars">${stages.map((s) => {
        const p = Math.round((s.points / s.qs.length) * 100);
        return `<div class="stage-bar"><span class="sb-name">${s.level.name}</span>
          <span class="bar"><span style="width:${p}%"></span></span><span class="sb-score">${fmt(s.points)}/${s.qs.length}</span></div>`;
      }).join('')}</div>`;
      const passed = pct >= PASS;
      const actions = [];
      if (wrong.length) {
        actions.push({
          label: `練習錯的 ${wrong.length} 題`, icon: icon.redo, primary: true,
          onClick: () => play(student, stages.filter((s) => s.wrong.length).map((s) => ({ level: s.level, words: s.wrong.map((w) => w.q.word) })), false),
        });
      }
      actions.push({ label: '重新測驗', icon: icon.shuffle, primary: !wrong.length, onClick: () => play(student, levels.map((l) => ({ level: l, words: pickedWords() })), true) });
      const box = renderResult(stage, {
        title: official ? (passed ? '三段測驗通過！' : '三段測驗完成') : '錯題練習完成',
        pct,
        scoreText: `${fmt(points)} / ${total}`,
        pills: [`${icon.clock} ${Math.floor(durationSec / 60)} 分 ${durationSec % 60} 秒`, `${icon.flame} 最長連對 ${bestStreak}`],
        extraHTML: bars + (official
          ? `${stampHTML(student, ctx.unit.title, stamp)}<div data-submit>${submitStateHTML('sending')}</div>`
          : '<p class="muted">錯題練習不會送出成績</p>'),
        wrong: wrong.map((w) => ({ p: `〔${w.level.name}〕${promptText(w.q)}`, a: answerText(w.q), y: w.yours, x: w.xp })),
        actions,
      });
      if (!official) return;
      const res = await submitScore({
        clientTs: stamp, cls: student.cls, seat: student.seat, name: student.name,
        unit: unitId, unitTitle: ctx.unit.title, mode: 'vocab',
        level: stages.map((s) => s.level.name).join('→'),
        score: Number(fmt(points)), total, pct, durationSec,
        basic: per.basic || '', advanced: per.advanced || '', mastery: per.mastery || '',
        wrong: [...new Set(wrong.map((w) => w.q.word.word))],
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
    clearTimeout(advanceTimer);
    window.removeEventListener('beforeunload', unload);
    if (onKey) document.removeEventListener('keydown', onKey);
  };
}
