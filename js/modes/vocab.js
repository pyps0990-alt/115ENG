// 單字片語測驗：同一組單字，依序連續完成基礎 → 進階 → 精熟三段，最後一張總成績單
import { typeLabel } from '../types.js';
import { store } from '../storage.js';
import { esc, nowStamp, wait, shuffle, centerInView, confirmDialog } from '../util.js';
import { icon } from '../icons.js';
import { renderMC, renderSpell, promptText, answerText, explainWrong, classifyError, errorOf, questionFromRecord } from '../components/question.js';
import { renderResult } from '../components/result.js';
import { unitWindow } from '../remote-config.js';
import { testGate, submitStateHTML, stampHTML } from '../components/gate.js';
import { mountReview, completeReview } from '../components/review.js';
import { exampleHTML } from '../util.js';
import { progress, leaveBody } from '../resume.js';
import { diffAnswer } from '../components/diff.js';
import { submitScore } from '../submit.js';
import { statusBarHTML, mountDeadline } from '../components/status.js';
import { PASS, stageSizes, partitionWords, pickWords, PER_TEST, weigh } from '../levels.js';


export function mount(stage, ctx) {
  const levels = ctx.levels;
  const all = ctx.allWords;
  const unitId = ctx.unit.id;
  const perTest = Math.min(all.length, ctx.perTest || PER_TEST); // 一次考幾個字（老師在出題設定填的，沒填就是 PER_TEST；單元的字比較多就抽題）
  const sizes = stageSizes(perTest, levels.length);
  const nPhrase = all.filter((w) => w.type === 'phrase').length;
  // 例句記憶：記下這位學生每個字考過哪幾句例句（存在這台裝置），下次換一句沒考過的；全部考過才重新開始
  const pickEx = (word, n) => {
    const key = `${unitId}:ex`;
    const used = store.bag(key);
    const mine = used.filter((e) => e.slice(e.indexOf('|') + 1) === word).map((e) => Number(e.slice(0, e.indexOf('|'))));
    let fresh = Array.from({ length: n }, (_, i) => i).filter((i) => !mine.includes(i));
    let keep = used;
    if (!fresh.length) {
      // 這個字每句都考過了：重新開始一輪，但不要連續考到同一句
      const last = mine[mine.length - 1];
      fresh = Array.from({ length: n }, (_, i) => i).filter((i) => i !== last || n === 1);
      keep = used.filter((e) => e.slice(e.indexOf('|') + 1) !== word);
    }
    const idx = fresh[Math.floor(Math.random() * fresh.length)];
    store.setBag(key, [...keep, `${idx}|${word}`]);
    return idx;
  };
  let alive = true;
  let advanceTimer = null;
  let hold = null; // 自動下一題時，碰一下畫面就停的監聽
  const dropHold = () => { if (!hold) return; document.removeEventListener('pointerdown', hold, true); document.removeEventListener('keydown', hold, true); hold = null; };
  let onKey = null;
  const unload = (e) => { e.preventDefault(); e.returnValue = ''; };

  // 逐題檢討答錯的字；details 是那次測驗的逐題紀錄（剛做完的，或從 Firestore 讀回的第一次測驗）
  function reviewItemHTML(d) {
    const w = all.find((x) => x.word === d.word) || { word: d.word || '' };
    const yours = String(d.yours || '').trim();
    // 例句題顯示當時考的那句（同一個字可能存了不只一句例句），不是字典裡的第一句
    const exEn = d.exampleEn || w.example;
    const exZh = d.exampleZh || w.exampleZh;
    // 拼寫題（拼字、例句拼寫）把拼錯的字母標出來；選擇題的答案是整個選項，不標
    const spellKind = /拼/.test(String(d.kind || ''));
    const mark = spellKind && yours ? diffAnswer(yours, [d.correct || '']) : null;
    // 能重建題目就用完整版解析：解題步驟在前，最後才揭曉正確答案、例句與翻譯
    const q = questionFromRecord(d, all, ctx.analysis);
    if (q) {
      const full = explainWrong(q, yours, all, 'full');
      return `<div class="rv-card">
        <div class="rv-meta">${esc(d.stage || '')}・${esc(d.kind || '')}</div>
        <div class="rv-prompt ${/[a-z]/i.test(d.q || d.question || '') ? 'en' : ''}">${esc(d.q || d.question || '')}</div>
        <div class="rv-row no"><span>你的答案</span><b class="en">${yours ? esc(yours) : '（未作答）'}</b></div>
        ${full.html}
      </div>`;
    }
    const xp = d.err ? errorOf(d, all) : { err: '' }; // 錯誤原因依兩個字的關係重新判斷（舊紀錄的選擇題都記成「意思混淆」）
    return `<div class="rv-card">
        <div class="rv-meta">${esc(d.stage || '')}・${esc(d.kind || '')}</div>
        <div class="rv-prompt ${/[a-z]/i.test(d.q || d.question || '') ? 'en' : ''}">${esc(d.q || d.question || '')}</div>
        <div class="rv-row no"><span>你的答案</span><b class="en">${yours ? (spellKind ? mark.yoursHTML : esc(yours)) : '（未作答）'}</b></div>
        <div class="rv-row ok"><span>正確答案</span><b class="en">${spellKind && yours ? mark.correctHTML : esc(d.correct || '')}</b></div>
        ${xp.err ? `<p class="xp-tip"><span class="xp-tag">${esc(xp.err)}</span>${esc(xp.tip)}</p>` : ''}
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
    rules: [
      all.length > perTest
        ? `共 <b>${all.length}</b> 個（單字 ${all.length - nPhrase}、片語 ${nPhrase}），每次測驗抽 <b>${perTest}</b> 個，分成 <b>${levels.length}</b> 段（${sizes.join('、')} 題）；上次沒考到的字優先，做 ${Math.ceil(all.length / perTest)} 次就輪完全部`
        : `共 <b>${all.length}</b> 個（單字 ${all.length - nPhrase}、片語 ${nPhrase}），分成 <b>${levels.length}</b> 段（${sizes.join('、')} 題），每個字這次只考一次，全部都會考到`,
      '複習時單字會重新分配到不同的階段，題型和例句也會換',
      ...levels.map((l, i) => `第 ${i + 1} 段 <b>${l.name}</b>：${esc(l.desc)}`),
    ],
    best: () => store.best(unitId).vocab,
    review: () => store.done(unitId),
    reviewed: () => store.reviewed(unitId),
    retake: () => store.tried(unitId) && !store.done(unitId),
    onStart: (s, review) => play(s, stagesNow(), true, review),
    onReview: () => startReview((store.first(unitId) || {}).details),
    resume: () => {
      const r = progress.load(unitId, 'vocab');
      if (!r || !r.stages || !r.stages.every((s) => levels.some((l) => l.id === s.levelId))) return null;
      const total = r.stages.reduce((n, s) => n + s.qs.length, 0);
      return { label: `第 ${Math.min(r.done + 1, total)} / ${total} 題`, onResume: (s) => play(s, null, true, !!r.review, r), discard: () => progress.clear(unitId) };
    },
  });

  // 每次開始（含複習）重新分配：這次要考的字（超過 PER_TEST 個就抽題）分到各階段，每個字只考一次
  const stagesNow = () => {
    const groups = partitionWords(pickWords(all, unitId, perTest), levels.length, unitId);
    return levels.map((l, i) => ({ level: l, words: groups[i] })).filter((x) => x.words.length);
  };

  // stagesIn: [{ level, words }]；official=false 為錯題練習，不送出成績；review=true 為做過正式測驗後的複習
  // saved：從「繼續上次」接回來的進度（題目、順序、得分都照原樣）
  function play(student, stagesIn, official, review = false, saved = null) {
    const stages = saved
      ? saved.stages.map(({ levelId, ...r }) => ({ ...r, level: levels.find((l) => l.id === levelId) }))
      : stagesIn.map(({ level, words }) => ({ level, qs: level.build(shuffle(words), all, { analysis: ctx.analysis, pickEx }), points: 0, wrong: [] }));
    const total = stages.reduce((s, x) => s + x.qs.length, 0);
    let si = saved ? saved.si : 0; let qi = saved ? saved.qi : 0; let done = saved ? saved.done : 0;
    let streak = saved ? saved.streak : 0; let bestStreak = saved ? saved.bestStreak : 0;
    const details = saved ? saved.details : [];
    // 正式測驗與複習每換一題就存一次進度（錯題練習不存）
    const persist = () => {
      if (!official) return;
      progress.save(unitId, 'vocab', { review, si, qi, done, streak, bestStreak, details, inCard, elapsed: Date.now() - t0,
        stages: stages.map(({ level, ...r }) => ({ ...r, levelId: level.id })) });
    };
    let current = null;
    let inCard = false;
    const t0 = Date.now() - (saved ? saved.elapsed : 0);
    document.body.dataset.busy = '1';
    document.getElementById('fx').replaceChildren();
    if (official) window.addEventListener('beforeunload', unload);

    const stKind = !official ? 'redo' : review ? 'review' : 'official';
    stage.innerHTML = `
      <div class="quiz">
        ${statusBarHTML({ kind: stKind, note: { official: '這次的分數會送給老師。', review: '複習不會改變你的成績。', redo: '只練剛剛錯的題目，不計分也不送出。' }[stKind], mid: `<div class="quiz-bar">
          <div class="bar"><span></span></div>
          <span class="quiz-stat" data-n></span>
          <span class="quiz-all" data-all title="全部題數"></span>
          <span class="quiz-stat streak" data-streak title="連續答對">${icon.flame}<b>0</b></span>
        </div>` })}
        <ol class="stepper" aria-label="測驗進度">${stages.map((s, i) => `<li data-step="${i}">
          <span class="step-dot">${i + 1}</span><span class="step-name">${s.level.name}</span><span class="step-score"></span></li>`).join('')}</ol>
        <div class="auto-opt">
          <button class="link-btn leave" type="button" data-leave>離開測驗</button>
          <button class="switch" type="button" role="switch" data-auto-toggle><span class="sw" aria-hidden="true"></span>自動下一題</button>
        </div>
        <div data-q></div>
        <div class="q-foot"><div class="feedback" data-fb aria-live="polite"></div><button class="btn primary" type="button" data-next hidden></button></div>
        <p class="quiz-note"><span class="kb-hint">按 1–4 或 A–D 選答案，Enter 下一題</span><span class="auto-cue" data-auto-cue hidden>輕點畫面可暫停自動下一題</span></p>
      </div>`;
    mountDeadline(stage, official && !review ? unitWindow(ctx.config, unitId) : null);
    const nextBtn = stage.querySelector('[data-next]');
    // 自動下一題：答對選擇題後等 AUTO_MS 毫秒自動跳，可以關掉（記在這台裝置）；進度條動畫與計時共用同一個數字
    const AUTO_MS = 2400;
    const getFlag = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : v === '1'; } catch { return d; } };
    const setFlag = (k, v) => { try { localStorage.setItem(k, v ? '1' : '0'); } catch { /* ignore */ } };
    const autoToggle = stage.querySelector('[data-auto-toggle]');
    const autoCue = stage.querySelector('[data-auto-cue]');
    const paintAuto = () => autoToggle.setAttribute('aria-checked', getFlag('b5p:auto', true) ? 'true' : 'false');
    paintAuto();
    autoToggle.addEventListener('click', () => {
      setFlag('b5p:auto', !getFlag('b5p:auto', true));
      if (!getFlag('b5p:auto', true)) { clearTimeout(advanceTimer); dropHold(); nextBtn.classList.remove('auto'); autoCue.hidden = true; }
      paintAuto();
    });
    // 離開測驗：先確認，這次作答不會送出
    stage.querySelector('[data-leave]').addEventListener('click', async () => {
      const ok = await confirmDialog({ title: '要離開這次測驗嗎？', body: leaveBody(unitId), ok: '離開', cancel: '繼續作答', danger: true });
      // 先解除「作答中」鎖定再換頁，不然全站的離開確認會再問第二次
      if (ok) { window.removeEventListener('beforeunload', unload); delete document.body.dataset.busy; location.hash = '#/'; }
    });
    const foot = stage.querySelector('.q-foot');
    nextBtn.addEventListener('click', next);

    const paintStepper = () => {
      const w = weigh(stages, details);
      stage.querySelectorAll('[data-step]').forEach((li, i) => {
        const s = stages[i];
        li.classList.toggle('now', i === si && !s.finished);
        li.classList.toggle('done', !!s.finished);
        li.setAttribute('aria-current', i === si && !s.finished ? 'step' : 'false');
        li.querySelector('.step-dot').innerHTML = s.finished ? icon.check : String(i + 1);
        li.querySelector('.step-score').textContent = s.finished ? `${Math.round(w.stages[i])}/${Math.round(w.max)}` : '';
      });
      // 進度條與「第幾題」以目前這一段為準（每段從頭開始，比較知道這段還剩多少）；全部題數放在旁邊小字
      const cur = stages[Math.min(si, stages.length - 1)];
      stage.querySelector('.bar > span').style.setProperty('--w', `${(Math.min(qi, cur.qs.length) / cur.qs.length) * 100}%`);
      stage.querySelector('[data-n]').textContent = `第 ${Math.min(qi + 1, cur.qs.length)} / ${cur.qs.length} 題`;
      stage.querySelector('[data-all]').textContent = `全部 ${Math.min(done + 1, total)}/${total}`;
    };

    function show() {
      inCard = false;
      persist();
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
        : renderSpell(host, q, { label: `${label}・${q.variant === 'cloze' ? '拼出空格的字詞' : '看中文拼出英文'}`, onAnswer: (ok, { hints, typed }) => answered(q, ok, ok ? 1 : 0, typed, hints) });
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
        extras: ok || !q.extras || !q.extras.length ? undefined : q.extras, // 課外選項（答錯時要知道學生選的是哪個字、什麼意思）
        options: ok || q.type !== 'mc' ? undefined : q.options, // 答錯的選擇題記下當時的選項：逐題檢討要重跑解題步驟
        exIdx: ok || !Number.isInteger(q.exIdx) ? undefined : q.exIdx, // 考的是第幾句例句（對應錯誤分析結果）
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
        fb.innerHTML = ''; // 答錯不另外寫字：正確答案與錯誤類型都在下方解析裡
      }
      st.querySelector('b').textContent = streak;
      const lastInStage = qi === s.qs.length - 1;
      nextBtn.hidden = false;
      nextBtn.innerHTML = !lastInStage ? `下一題 ${icon.arrowR}` : si === stages.length - 1 ? `看總成績 ${icon.arrowR}` : `完成${s.level.name} ${icon.arrowR}`;
      setTimeout(() => nextBtn.focus({ preventScroll: true }), 30);
      // 答對選擇題會自動下一題；碰一下畫面（或按任何鍵）就停住，自己按「下一題」。開啟減少動態效果的人不自動跳
      if (ok && q.type === 'mc' && getFlag('b5p:auto', true) && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
        clearTimeout(advanceTimer);
        nextBtn.style.setProperty('--auto-ms', `${AUTO_MS}ms`);
        nextBtn.classList.add('auto');
        autoCue.hidden = false;
        advanceTimer = setTimeout(() => alive && next(), AUTO_MS);
        dropHold();
        hold = (ev) => {
          if (ev.target === nextBtn || ev.target.closest('[data-auto-toggle]') || (ev.type === 'keydown' && ev.key === 'Enter')) return;
          clearTimeout(advanceTimer); nextBtn.classList.remove('auto'); autoCue.hidden = true;
        };
        document.addEventListener('pointerdown', hold, { once: true, capture: true });
        document.addEventListener('keydown', hold, { once: true, capture: true });
      }
    }

    async function next() {
      clearTimeout(advanceTimer);
      dropHold();
      nextBtn.classList.remove('auto');
      autoCue.hidden = true;
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
      persist();
      current = null;
      const s = stages[si];
      const nx = stages[si + 1];
      paintStepper();
      foot.hidden = true;
      const w = weigh(stages, details);
      const pct = Math.round((w.stages[si] / w.max) * 100);
      const host = stage.querySelector('[data-q]');
      host.innerHTML = `<div class="stage-card slide-in">
          <div class="stage-done"><span class="stage-badge">${icon.check}</span><div><div class="eyebrow">第 ${si + 1} 段完成</div><h2>${s.level.name}</h2></div>
            <div class="stage-score"><div class="ss-frac"><b>${Math.round(w.stages[si])}</b><i>/ ${Math.round(w.max)}</i></div><span>${pct}%</span></div></div>
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
      if (official) progress.clear(unitId);
      delete document.body.dataset.busy;
      window.removeEventListener('beforeunload', unload);
      // 滿分 100 分：三段平均分配，段內每題同分，拼字提示扣分（js/levels.js 的 weigh）；明細的 points 改成實際拿到的分數
      const w = weigh(stages, details);
      const points = w.total;
      const pct = Math.round(points);
      const durationSec = Math.round((Date.now() - t0) / 1000);
      const stamp = nowStamp();
      const per = Object.fromEntries(stages.map((s, i) => [s.level.id, `${Math.round(w.stages[i])}/${Math.round(w.max)}`]));
      if (official) {
        store.setBest(unitId, 'vocab', pct);
        store.setLast(unitId, Object.fromEntries(stages.map((s, i) => [s.level.id, Math.round((w.stages[i] / w.max) * 100)])));
      }
      const wrong = stages.flatMap((s) => s.wrong.map((w) => ({ ...w, level: s.level })));
      stage.innerHTML = '';
      const bars = `<div class="stage-bars">${stages.map((s, i) => {
        const p = Math.round((w.stages[i] / w.max) * 100);
        return `<div class="stage-bar"><span class="sb-name">${s.level.name}</span>
          <span class="bar"><span style="--w:${p}%"></span></span><span class="sb-score">${Math.round(w.stages[i])}/${Math.round(w.max)}</span></div>`;
      }).join('')}</div>`;
      const passed = pct >= PASS;
      const wasTried = official && !review && store.tried(unitId);
      if (official && !review) { if (passed) store.setDone(unitId); else store.setTried(unitId); }
      const firstTest = official && !review;
      if (firstTest) store.setFirst(unitId, { mode: 'vocab', details });
      const actions = [];
      if (firstTest) {
        // 第一次正式測驗：先檢討，檢討完才能複習
        if (details.every((d) => d.ok)) {
          // 全部答對：沒有要檢討的，直接視為檢討完成（才能開始複習），按鈕改成返回首頁
          completeReview(unitId);
          actions.push({ label: '返回首頁', icon: icon.home, primary: true, onClick: () => { location.hash = '#/'; } });
        } else actions.push({ label: '開始檢討', icon: icon.bulb, primary: true, onClick: () => startReview(details) });
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
        title: !official ? '錯題練習完成' : `${review ? '複習' : '三段測驗'}${passed ? '通過！' : firstTest ? '未通過' : '完成'}`,
        pct,
        scoreText: `${pct} / 100`,
        passLine: firstTest,
        pills: [`${icon.clock} ${Math.floor(durationSec / 60)} 分 ${durationSec % 60} 秒`, `${icon.flame} 最長連對 ${bestStreak}`],
        extraHTML: bars + (official
          ? `${stampHTML(student, ctx.unit.title, stamp)}<div data-submit role="status" aria-live="polite">${submitStateHTML('sending')}</div>`
          : '<p class="muted">錯題練習不會送出成績</p>'),
        // 正式測驗的錯題改用逐題檢討，這裡只在錯題練習時列出
        wrong: official ? [] : wrong.map((w) => ({ p: `〔${w.level.name}〕${promptText(w.q)}`, a: answerText(w.q), y: w.yours, x: w.xp })),
        actions,
      });
      if (!official) return;
      const res = await submitScore({
        clientTs: stamp, cls: student.cls, seat: student.seat, name: student.name,
        unit: unitId, unitTitle: ctx.unit.title, mode: 'vocab', review,
        level: `${review ? '複習 · ' : wasTried ? '補考 · ' : ''}${stages.map((s) => s.level.name).join('→')}`,
        score: Math.round(points * 100) / 100, total: 100, pct, durationSec,
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
    if (saved && saved.inCard) stageCard(); else show();
  }

  return () => {
    alive = false;
    clearTimeout(advanceTimer);
    dropHold();
    window.removeEventListener('beforeunload', unload);
    if (onKey) document.removeEventListener('keydown', onKey);
  };
}
