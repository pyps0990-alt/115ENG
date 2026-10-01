// 單字片語測驗：同一組單字，依序連續完成基礎 → 進階 → 精熟三段，最後一張總成績單
import { store } from '../storage.js';
import { esc, nowStamp, wait, shuffle, centerInView } from '../util.js';
import { icon } from '../icons.js';
import { renderMC, renderSpell, promptText, answerText, explainWrong, classifyError, ERR_TIPS } from '../components/question.js';
import { renderResult } from '../components/result.js';
import { unitWindow } from '../remote-config.js';
import { testGate, submitStateHTML, stampHTML } from '../components/gate.js';
import { mountReview, completeReview } from '../components/review.js';
import { exampleHTML } from '../util.js';
import { submitScore } from '../submit.js';
import { PASS, stageSizes, partitionWords } from '../levels.js';

const HINT_COST = 0.25;
const fmt = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0$/, ''));

export function mount(stage, ctx) {
  const levels = ctx.levels;
  const all = ctx.allWords;
  const unitId = ctx.unit.id;
  const sizes = stageSizes(all.length, levels.length);
  const nPhrase = all.filter((w) => w.type === 'phrase').length;
  let alive = true;
  let advanceTimer = null;
  let onKey = null;
  const unload = (e) => { e.preventDefault(); e.returnValue = ''; };

  // 逐題檢討答錯的字；details 是那次測驗的逐題紀錄（剛做完的，或從 Firestore 讀回的第一次測驗）
  function reviewItemHTML(d) {
    const w = all.find((x) => x.word === d.word) || { word: d.word || '' };
    const yours = String(d.yours || '').trim();
    // 例句題顯示當時考的那句（同一個字可能存了不只一句例句），不是字典裡的第一句
    const exEn = d.exampleEn || w.example;
    const exZh = d.exampleZh || w.exampleZh;
    return `<div class="rv-card">
        <div class="rv-meta">${esc(d.stage || '')}・${esc(d.kind || '')}</div>
        <div class="rv-prompt ${/[a-z]/i.test(d.q || d.question || '') ? 'en' : ''}">${esc(d.q || d.question || '')}</div>
        <div class="rv-row no"><span>你的答案</span><b class="en">${yours ? esc(yours) : '（未作答）'}</b></div>
        <div class="rv-row ok"><span>正確答案</span><b class="en">${esc(d.correct || '')}</b></div>
        ${d.err ? `<p class="xp-tip"><span class="xp-tag">${esc(d.err)}</span>${esc(ERR_TIPS[d.err] || '')}</p>` : ''}
        <div class="xp-main"><span class="xp-word en">${esc(w.word)}</span>${w.pos ? `<span class="pos">${esc(w.pos)}</span>` : ''}<span class="xp-zh">${esc(w.zh || '')}</span></div>
        ${exEn ? `<p class="xp-ex en">${exampleHTML(exEn)}</p>` : ''}
        ${exZh ? `<p class="xp-exzh">${esc(exZh)}</p>` : ''}
      </div>`;
  }

  function startReview(details) {
    document.getElementById('fx').replaceChildren();
    const firstTime = !store.reviewed(unitId);
    mountReview(stage, {
      title: `${ctx.unit.title}｜${firstTime ? '檢討' : '再看一次檢討'}`,
      items: (details || []).filter((d) => !d.ok).map((d) => ({ html: reviewItemHTML(d) })),
      onDone: () => { if (firstTime) completeReview(unitId); gate.redraw(); window.scrollTo(0, 0); },
      onExit: () => { gate.redraw(); window.scrollTo(0, 0); },
    });
    window.scrollTo(0, 0);
  }

  const gate = testGate(stage, {
    timeWindow: () => unitWindow(ctx.config, unitId),
    eyebrow: levels.map((l) => l.en).join(' → '),
    title: `${ctx.unit.title}連續測驗`,
    rules: [
      `共 <b>${all.length}</b> 個（單字 ${all.length - nPhrase}、片語 ${nPhrase}），分成 <b>${levels.length}</b> 段（${sizes.join('、')} 題），每個字這次只考一次，全部都會考到`,
      '複習時單字會重新分配到不同的階段，題型和例句也會換',
      ...levels.map((l, i) => `第 ${i + 1} 段 <b>${l.name}</b>：${esc(l.desc)}`),
      `三段總分達 <b>${PASS}%</b> 就算通過`,
    ],
    best: () => store.best(unitId).vocab,
    review: () => store.done(unitId),
    reviewed: () => store.reviewed(unitId),
    onStart: (s, review) => play(s, stagesNow(), true, review),
    onReview: () => startReview((store.first(unitId) || {}).details),
  });

  // 每次開始（含複習）重新分配：全部單字分到各階段，每個字只考一次
  const stagesNow = () => {
    const groups = partitionWords(all, levels.length, unitId);
    return levels.map((l, i) => ({ level: l, words: groups[i] })).filter((x) => x.words.length);
  };

  // stagesIn: [{ level, words }]；official=false 為錯題練習，不送出成績；review=true 為做過正式測驗後的複習
  function play(student, stagesIn, official, review = false) {
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
          ${official ? (review ? '<span class="level-chip">複習</span>' : '') : '<span class="level-chip">錯題練習</span>'}
          <div class="bar"><span></span></div>
          <span class="quiz-stat" data-n></span>
          <span class="quiz-all" data-all title="全部題數"></span>
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
      // 進度條與「第幾題」以目前這一段為準（每段從頭開始，比較知道這段還剩多少）；全部題數放在旁邊小字
      const cur = stages[Math.min(si, stages.length - 1)];
      stage.querySelector('.bar > span').style.width = `${(Math.min(qi, cur.qs.length) / cur.qs.length) * 100}%`;
      stage.querySelector('[data-n]').textContent = `第 ${Math.min(qi + 1, cur.qs.length)} / ${cur.qs.length} 題`;
      stage.querySelector('[data-all]').textContent = `全部 ${Math.min(done + 1, total)}/${total}`;
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
      centerInView(host.querySelector('.q-card'));
    }

    function answered(q, ok, got, yours, hints = 0) {
      const s = stages[si];
      s.points += got;
      // 例句題把當時考的那句一起記下來，逐題檢討時要顯示同一句，不是字典裡預設那句
      const clozeQ = (q.type === 'mc' && q.dir === 'cloze') || (q.type === 'spell' && q.variant === 'cloze');
      details.push({
        stage: s.level.name, n: qi + 1, kind: q.type === 'mc' ? (q.dir === 'en2zh' ? '英→中' : q.dir === 'cloze' ? '例句選字' : '中→英') : (q.variant === 'cloze' ? '例句拼寫' : '拼字'),
        q: promptText(q), correct: answerText(q), yours: yours == null ? '' : String(yours), ok, points: got, hints,
        word: q.word.word, err: ok ? '' : classifyError(q, yours, all),
        exampleEn: clozeQ ? `${q.parts.before}[${q.parts.answer}]${q.parts.after}` : '',
        exampleZh: clozeQ ? (q.exampleZh || '') : '',
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
      const firstTest = official && !review;
      if (firstTest) store.setFirst(unitId, { mode: 'vocab', details });
      const actions = [];
      if (firstTest) {
        // 第一次正式測驗：先檢討，檢討完才能複習
        actions.push({ label: '開始檢討', icon: icon.bulb, primary: true, onClick: () => startReview(details) });
      } else {
        if (wrong.length) {
          actions.push({
            label: `練習錯的 ${wrong.length} 題`, icon: icon.redo, primary: true,
            onClick: () => play(student, stages.filter((s) => s.wrong.length).map((s) => ({ level: s.level, words: s.wrong.map((w) => w.q.word) })), false),
          });
        }
        if (official) actions.push({ label: '逐題檢討', icon: icon.bulb, onClick: () => startReview(details) });
        actions.push({ label: '再複習一次', icon: icon.shuffle, primary: !wrong.length, onClick: () => play(student, stagesNow(), true, true) });
      }
      const box = renderResult(stage, {
        title: !official ? '錯題練習完成' : `${review ? '複習' : '三段測驗'}${passed ? '通過！' : '完成'}`,
        pct,
        scoreText: `${fmt(points)} / ${total}`,
        pills: [`${icon.clock} ${Math.floor(durationSec / 60)} 分 ${durationSec % 60} 秒`, `${icon.flame} 最長連對 ${bestStreak}`],
        extraHTML: bars + (official
          ? `${stampHTML(student, ctx.unit.title, stamp)}<div data-submit>${submitStateHTML('sending')}</div>`
          : '<p class="muted">錯題練習不會送出成績</p>'),
        // 正式測驗的錯題改用逐題檢討，這裡只在錯題練習時列出
        wrong: official ? [] : wrong.map((w) => ({ p: `〔${w.level.name}〕${promptText(w.q)}`, a: answerText(w.q), y: w.yours, x: w.xp })),
        actions,
      });
      if (!official) return;
      const res = await submitScore({
        clientTs: stamp, cls: student.cls, seat: student.seat, name: student.name,
        unit: unitId, unitTitle: ctx.unit.title, mode: 'vocab', review,
        level: `${review ? '複習 · ' : ''}${stages.map((s) => s.level.name).join('→')}`,
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
