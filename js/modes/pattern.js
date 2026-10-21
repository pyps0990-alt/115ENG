// 句型練習：一次一題，選擇、填空、應用（重組句子）混合出現
// 正式測驗（比照課文理解）：先全部作答、可以回上一題改，最後一次交卷；伺服器計分後才回傳答案與解析，接著逐題檢討
// 複習、錯題重練：作答後立刻看到解析（用完整題目：交過這個單元才拿得到，存在這台裝置）
// 答案不公開（js/answers.js）
import { typeLabel } from '../types.js';
import { store } from '../storage.js';
import { esc, nowStamp, wait, shuffle, centerInView, confirmDialog } from '../util.js';
import { icon } from '../icons.js';
import { renderResult } from '../components/result.js';
import { unitWindow } from '../remote-config.js';
import { testGate, submitStateHTML, stampHTML } from '../components/gate.js';
import { mountReview, completeReview } from '../components/review.js';
import { submitScore, fetchKey, cachedKey, newAttemptId, checkAnswer } from '../submit.js';
import { mountLearn, guidePeekHTML } from '../components/learn.js';
import { learnPrefs } from '../learn-prefs.js';
import { statusBarHTML, mountDeadline } from '../components/status.js';
import { progress } from '../resume.js';
import { PASS } from '../levels.js';
import { flattenPattern, renderChoiceCard, renderFillCard, renderApplyCard, explainHTML, reviewCardHTML, correctText, KIND_LABEL, judge, applyScore } from '../components/items.js';

const fmt = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0$/, ''));

export function mount(stage, ctx) {
  let all = flattenPattern((ctx.data || {}).items);
  const unitId = ctx.unit.id;
  const version = ((ctx.config && ctx.config.content && ctx.config.content[unitId]) || {}).updated || '';
  let keyed = !(ctx.data || {}).locked;
  const useKey = (full) => {
    const list = full && Array.isArray(full.items) ? flattenPattern(full.items) : null;
    if (!list || list.length !== all.length) return false;
    all = list; keyed = true; return true;
  };
  if (!keyed) useKey(cachedKey(unitId, version));
  // 需要完整題目時（複習、錯題重練、檢討）：還沒有就跟伺服器拿，拿不到就顯示說明、回到單元頁
  async function withKey(then) {
    if (!keyed) {
      stage.innerHTML = '<div class="loading"><span class="spinner"></span>讀取題目與解析…</div>';
      let ok = false;
      try { ok = useKey(await fetchKey(unitId, version)); } catch { ok = false; }
      if (!alive) return;
      if (!ok) {
        stage.innerHTML = '<div class="card gate-card"><p class="gate-lead">讀不到答案與解析：成績可能還在排隊送出，或網路不穩，請稍後再試。</p><div class="btn-row"><button class="btn primary" type="button" data-back>返回</button></div></div>';
        stage.querySelector('[data-back]').addEventListener('click', () => { gate.redraw(); window.scrollTo(0, 0); });
        return;
      }
    }
    then();
  }
  const n = Math.min(ctx.questionCount, all.length);
  let alive = true;
  let onKey = null;
  const unload = (e) => { e.preventDefault(); e.returnValue = ''; };

  if (!all.length) {
    stage.innerHTML = `<div class="empty"><div class="big">${icon.file}</div><p>這個單元還沒有題目。</p></div>`;
    return;
  }
  const kindsIn = [...new Set(all.map((q) => KIND_LABEL[q.kind]))].join('、');
  // 有句型說明：正式測驗走循序漸進版（認識 → 檢測 → 驗收，每個句型一段）
  const guides = Array.isArray((ctx.data || {}).guides) ? ctx.data.guides : [];
  const learnFlow = guides.length > 0;
  const tagsIn = [...new Set(all.map((q) => q.tag).filter(Boolean))];

  function startReview(details) {
    if (!keyed) { withKey(() => startReview(details)); return; }
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
    rules: learnFlow ? [
      `共 <b>${tagsIn.length}</b> 個句型，每個句型一段：先認識句型、做不計分的檢測，再做 2～3 題計分的驗收`,
      '每一段做完驗收就看這段的結果；各句型平均配分，總分 100',
      ...(all.some((q) => q.kind === 'apply') ? ['應用題（排句子）部分給分：排進去的單字越多、順序越接近，分數越高'] : []),
      '全部句型做完就交卷，之後可以逐題檢討錯題',
    ] : [
      `共 <b>${n}</b> 題，${esc(kindsIn)}混合出現，每次會從題庫（${all.length} 題）重新抽題`,
      '全部作答完再交卷，交卷前可以回上一題修改；交卷後看答案與解析',
      ...(all.some((q) => q.kind === 'apply') ? ['應用題（排句子）部分給分：排進去的單字越多、順序越接近，分數越高'] : []),
      '做完可以逐題檢討錯題',
    ],
    best: () => store.best(unitId).pattern,
    review: () => store.done(unitId),
    reviewed: () => store.reviewed(unitId),
    retake: () => store.tried(unitId) && !store.done(unitId),
    onStart: (s, review) => play(s, review),
    onReview: () => startReview((store.first(unitId) || {}).details),
    resume: () => {
      const r = progress.load(unitId, 'pattern');
      if (!r || !Array.isArray(r.qs) || !r.qs.length) return null;
      return { label: `第 ${Math.min(r.qi + 1, r.qs.length)} / ${r.qs.length} 題`, onResume: (s) => (r.official ? playOfficial(s, r) : play(s, !!r.review, null, r)), discard: () => progress.clear(unitId) };
    },
  });

  // redo：只重練指定的題目（錯題重練），不計成績、不送出
  function play(student, review = false, redo = null, saved = null) {
    if (!review && !redo) { if (learnFlow && !(saved && saved.official)) playLearn(student); else playOfficial(student, saved && saved.official ? saved : null); return; }
    const official = false;
    if (!official && !keyed) { withKey(() => play(student, review, redo, saved)); return; }
    // 正式測驗：這次作答的編號（也是成績的記錄編號），每題送伺服器判斷時帶著
    const session = official ? (saved && saved.session) || newAttemptId() : null;
    const qs = saved ? saved.qs : redo ? shuffle(all.filter((q) => redo.includes(q.id))) : shuffle(all).slice(0, n);
    let qi = saved ? saved.qi : 0; let streak = saved ? saved.streak : 0; let bestStreak = saved ? saved.bestStreak : 0; let points = saved ? saved.points : 0;
    const details = saved ? saved.details : [];
    let current = null;
    let peekOpen = false;
    const t0 = Date.now() - (saved ? saved.elapsed : 0);
    // 正式測驗與複習每換一題就存一次進度（錯題重練不存）
    const persist = () => { if (!redo) progress.save(unitId, 'pattern', { review, qs, qi, streak, bestStreak, points, details, elapsed: Date.now() - t0, ...(session ? { session } : {}) }); };
    document.body.dataset.busy = '1';
    document.getElementById('fx').replaceChildren();
    window.addEventListener('beforeunload', unload);

    stage.innerHTML = `
      <div class="quiz">
        ${statusBarHTML({ kind: redo ? 'redo' : 'review', note: redo ? '只練剛剛錯的題目，不計分也不送出。' : '每題答完馬上看解析。', mid: `<div class="quiz-bar">
          <div class="bar"><span></span></div>
          <span class="quiz-stat" data-n></span>
          <span class="quiz-stat streak" data-streak title="連續答對">${icon.flame}<b>0</b></span>
        </div>` })}
        <div data-q></div>
        <div class="q-foot"><div class="feedback" data-fb aria-live="polite"></div><button class="btn primary" type="button" data-next hidden></button></div>
      </div>`;
    const nextBtn = stage.querySelector('[data-next]');
    nextBtn.addEventListener('click', () => next());

    function show() {
      persist();
      const q = qs[qi];
      stage.querySelector('.bar > span').style.setProperty('--w', `${(qi / qs.length) * 100}%`);
      stage.querySelector('[data-n]').textContent = `第 ${qi + 1} / ${qs.length} 題`;
      stage.querySelector('[data-fb]').innerHTML = '';
      nextBtn.hidden = true;
      const host = stage.querySelector('[data-q]');
      host.innerHTML = '';
      const done = (ok, yours, score) => answered(q, ok, yours, score);
      const reveal = null; // 複習、錯題重練：題目有答案，直接在畫面上判斷
      // 有句型說明：題目上方可以打開「看說明」（打開後換題仍保持打開）
      const peek = guidePeekHTML(guides.find((g) => g.tag === q.tag), peekOpen);
      if (peek) { host.insertAdjacentHTML('beforeend', peek); host.querySelector('.ln-peek').addEventListener('toggle', (e) => { peekOpen = e.target.open; }); }
      if (q.kind === 'mc') current = renderChoiceCard(host, q, { meta: `第 ${qi + 1} 題・選擇`, onAnswer: done, reveal });
      else if (q.kind === 'fill') current = renderFillCard(host, q, { meta: `第 ${qi + 1} 題・填空`, onAnswer: done, reveal });
      else current = renderApplyCard(host, q, { meta: `第 ${qi + 1} 題・應用`, onAnswer: done, reveal });
      centerInView(host.querySelector('.q-card'));
    }

    // got：這題得幾分。選擇、填空不是 1 就是 0；應用題（重組句子）可以拿到部分分數
    function answered(q, ok, yours, got = ok ? 1 : 0) {
      points = Math.round((points + got) * 100) / 100;
      details.push({
        stage: '句型練習', n: qi + 1, kind: q.label, q: q.kind === 'apply' ? q.zh : q.stem, correct: correctText(q), yours: String(yours || ''),
        ok, points: got, hints: 0, word: q.id, err: '',
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
        fb.innerHTML = got > 0 ? `${icon.x} 差一點，得 ${fmt(got)} 分，看一下解析` : `${icon.x} 看一下解析`;
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
      if (!redo) progress.clear(unitId);
      delete document.body.dataset.busy;
      window.removeEventListener('beforeunload', unload);
      const pct = Math.round((points / qs.length) * 100);
      const durationSec = Math.round((Date.now() - t0) / 1000);
      const stamp = nowStamp();
      if (!redo) store.setBest(unitId, 'pattern', pct);
      const official = !review && !redo;
      const wasTried = official && store.tried(unitId);
      const passed = pct >= PASS;
      if (official) { if (passed) store.setDone(unitId); else store.setTried(unitId); }
      const byKind = {};
      details.forEach((d) => { const k = (byKind[d[barKey]] = byKind[d[barKey]] || { ok: 0, n: 0 }); k.n++; k.ok = Math.round((k.ok + (Number(d.points) || 0)) * 100) / 100; });
      const per = Object.entries(byKind).map(([k, v]) => `${k} ${fmt(v.ok)}/${v.n}`).join('・');
      const firstTest = !review && !redo;
      if (firstTest) store.setFirst(unitId, { mode: 'pattern', details });
      stage.innerHTML = '';
      const bars = `<div class="stage-bars">${Object.entries(byKind).map(([k, v]) => {
        const p = Math.round((v.ok / v.n) * 100);
        return `<div class="stage-bar"><span class="sb-name">${esc(k)}</span><span class="bar"><span style="--w:${p}%"></span></span><span class="sb-score">${fmt(v.ok)}/${v.n}</span></div>`;
      }).join('')}</div>`;
      const wrongN = details.filter((d) => !d.ok).length;
      const actions = [];
      if (redo) {
        const again = details.filter((d) => !d.ok).map((d) => d.word);
        if (again.length) actions.push({ label: `再練錯的 ${again.length} 題`, icon: icon.shuffle, primary: true, onClick: () => play(student, review, again) });
        actions.push({ label: '完成', icon: icon.check, primary: !again.length, onClick: () => { gate.redraw(); window.scrollTo(0, 0); } });
      } else if (firstTest && !wrongN) {
        // 全部答對：沒有要檢討的，直接視為檢討完成（才能開始複習），按鈕改成返回首頁
        completeReview(unitId);
        actions.push({ label: '返回首頁', icon: icon.home, primary: true, onClick: () => { location.hash = '#/'; } });
      } else if (firstTest) actions.push({ label: '開始檢討', icon: icon.bulb, primary: true, onClick: () => startReview(details) });
      else {
        if (wrongN) actions.push({ label: `檢討錯的 ${wrongN} 題`, icon: icon.bulb, primary: true, onClick: () => startReview(details) });
        actions.push({ label: '再練一次', icon: icon.shuffle, primary: !wrongN, onClick: () => play(student, true) });
      }
      const box = renderResult(stage, {
        title: redo ? '錯題重練完成' : `${review ? '複習' : '句型練習'}${passed ? '通過！' : official ? '未通過' : '完成'}`,
        pct,
        scoreText: `${fmt(points)} / ${qs.length}`,
        pills: [`${icon.clock} ${Math.floor(durationSec / 60)} 分 ${durationSec % 60} 秒`, `${icon.flame} 最長連對 ${bestStreak}`],
        passLine: official && !review && !redo,
        extraHTML: `${bars}${redo ? "" : stampHTML(student, ctx.unit.title, stamp)}<div data-submit role="status" aria-live="polite">${submitStateHTML('sending')}</div>`,
        actions,
      });
      if (redo) {
        const slot0 = box.querySelector('[data-submit]');
        if (slot0) slot0.innerHTML = '<p class="muted">這是練習，不計入成績。</p>';
        return;
      }
      const res = await submitScore({
        clientTs: stamp, cls: student.cls, seat: student.seat, name: student.name,
        unit: unitId, unitTitle: ctx.unit.title, mode: 'pattern', review, ...(session ? { attemptId: session } : {}), // 正式測驗：伺服器用這個編號找到逐題作答的紀錄
        level: `${review ? '複習 · ' : wasTried ? '補考 · ' : ''}句型練習 ${per}`.slice(0, 60),
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

  // 正式測驗（比照課文理解）：先全部作答（可以回上一題改），最後一次交卷；伺服器計分後才回傳答案與解析、可以檢討
  function playOfficial(student, saved = null) {
    const session = (saved && saved.session) || newAttemptId();
    const qs = saved ? saved.qs : shuffle(all).slice(0, n);
    const answers = (saved && saved.answers) || {}; // 題目 id → { yours, state }
    let qi = saved ? Math.min(saved.qi || 0, qs.length - 1) : 0;
    let current = null;
    const t0 = Date.now() - (saved ? saved.elapsed || 0 : 0);
    const persist = () => progress.save(unitId, 'pattern', { review: false, official: true, qs, qi, answers, elapsed: Date.now() - t0, session });
    const answered = () => qs.filter((q) => answers[q.id] && String(answers[q.id].yours || '').trim()).length;
    document.body.dataset.busy = '1';
    document.getElementById('fx').replaceChildren();
    window.addEventListener('beforeunload', unload);
    stage.innerHTML = `
      <div class="quiz">
        ${statusBarHTML({ kind: 'official', note: '這次的分數會送給老師。全部作答完再交卷，交卷前可以回上一題修改。', mid: '<div class="quiz-bar"><div class="bar"><span></span></div><span class="quiz-stat" data-n></span></div>' })}
        <div data-q></div>
        <div class="q-nav">
          <button class="btn ghost" type="button" data-prev>${icon.arrowL || '‹'} 上一題</button>
          <div class="q-dots" role="group" aria-label="跳到第幾題"></div>
          <button class="btn primary" type="button" data-next></button>
        </div>
      </div>`;
    mountDeadline(stage, unitWindow(ctx.config, unitId));
    const dots = stage.querySelector('.q-dots');
    const prevBtn = stage.querySelector('[data-prev]'), nextBtn = stage.querySelector('[data-next]');
    function paintNav() {
      const k = answered();
      stage.querySelector('.bar > span').style.setProperty('--w', `${(k / qs.length) * 100}%`);
      stage.querySelector('[data-n]').textContent = `第 ${qi + 1} / ${qs.length} 題・已答 ${k}`;
      dots.innerHTML = qs.map((q, i) => `<button type="button" class="q-dot${i === qi ? ' now' : ''}${answers[q.id] && String(answers[q.id].yours || '').trim() ? ' done' : ''}" data-go="${i}" aria-label="第 ${i + 1} 題${answers[q.id] ? '（已作答）' : ''}">${i + 1}</button>`).join('');
      const cur = dots.querySelector('.q-dot.now');
      if (cur && dots.scrollWidth > dots.clientWidth) dots.scrollLeft = cur.offsetLeft - dots.clientWidth / 2 + cur.offsetWidth / 2; // 手機上題號一排可以左右滑：目前這題放中間
      prevBtn.disabled = qi === 0;
      nextBtn.innerHTML = qi < qs.length - 1 ? `下一題 ${icon.arrowR}` : `交卷 ${icon.check}`;
    }
    function show() {
      persist();
      const q = qs[qi];
      const host = stage.querySelector('[data-q]');
      host.innerHTML = '';
      const a = answers[q.id];
      const opts = { meta: `第 ${qi + 1} 題・${q.label}`, deferred: true, initial: a ? a.state : null, onPick: (yours, state) => { answers[q.id] = { yours, state }; persist(); paintNav(); } };
      if (q.kind === 'mc') current = renderChoiceCard(host, q, opts);
      else if (q.kind === 'fill') current = renderFillCard(host, q, opts);
      else current = renderApplyCard(host, q, opts);
      paintNav();
      centerInView(host.querySelector('.q-card'));
    }
    const go = (i) => { qi = Math.max(0, Math.min(qs.length - 1, i)); show(); };
    prevBtn.addEventListener('click', () => go(qi - 1));
    dots.addEventListener('click', (e) => { const b = e.target.closest('[data-go]'); if (b) go(Number(b.dataset.go)); });
    nextBtn.addEventListener('click', async () => {
      if (qi < qs.length - 1) { go(qi + 1); return; }
      const left = qs.length - answered();
      if (left && !(await confirmDialog({ title: '確定要交卷嗎？', body: `還有 <b>${left}</b> 題沒作答，沒作答的以答錯計。交卷後就不能修改。`, ok: '交卷', cancel: '回去作答' }))) { const i = qs.findIndex((q) => !(answers[q.id] && String(answers[q.id].yours || '').trim())); go(i); return; }
      submitOfficial();
    });
    if (onKey) document.removeEventListener('keydown', onKey);
    onKey = (e) => {
      if (e.target.closest('input, textarea, dialog') || !current) return;
      const k = e.key.toLowerCase(), map = { 1: 0, 2: 1, 3: 2, 4: 3, a: 0, b: 1, c: 2, d: 3 };
      if (current.choose && k in map) current.choose(map[k]);
      else if (k === 'enter' && !e.target.closest('button')) { e.preventDefault(); nextBtn.click(); }
    };
    document.addEventListener('keydown', onKey);
    show();

    async function submitOfficial() {
      current = null;
      progress.clear(unitId);
      delete document.body.dataset.busy;
      window.removeEventListener('beforeunload', unload);
      const durationSec = Math.round((Date.now() - t0) / 1000);
      const stamp = nowStamp();
      const wasTried = store.tried(unitId);
      const mine = qs.map((q, i) => ({ stage: '句型練習', n: i + 1, kind: q.label, q: q.kind === 'apply' ? q.zh : q.stem, correct: '', yours: String((answers[q.id] || {}).yours || ''), ok: false, points: 0, hints: 0, word: q.id, err: '' }));
      stage.innerHTML = '<div class="loading"><span class="spinner"></span>交卷中，伺服器正在計分…</div>';
      window.scrollTo(0, 0);
      const res = await submitScore({
        clientTs: stamp, cls: student.cls, seat: student.seat, name: student.name,
        unit: unitId, unitTitle: ctx.unit.title, mode: 'pattern', review: false, attemptId: session,
        level: `${wasTried ? '補考 · ' : ''}句型練習`.slice(0, 60),
        score: null, total: qs.length, pct: null, durationSec, wrong: [], details: mine,
      });
      if (!alive) return;
      showSubmitted({ student, res, mine, stamp, durationSec, retake: () => playOfficial(student), barKey: 'kind' });
    }
  }

  // 交卷後：伺服器算好分數就顯示結果，還沒拿到就說明成績在排隊
  function showSubmitted({ student, res, mine, stamp, durationSec, retake, barKey }) {
    const result = res.result || null;
    if (result && result.data) useKey(result.data);
    const graded = !!result && typeof result.pct === 'number';
    stage.innerHTML = '';
    if (!graded) {
      // 還沒拿到分數（離線、伺服器忙）：成績在這台裝置排隊，送出後才能檢討
      store.setTried(unitId);
      const box = document.createElement('div');
      box.className = 'card gate-card';
      box.innerHTML = `<h2>已交卷</h2><p class="gate-lead">成績會在送到伺服器後算出來（右下角會通知）。送出後回到這個單元，就能看答案與解析、逐題檢討。</p>
        ${stampHTML(student, ctx.unit.title, stamp)}<div data-submit role="status" aria-live="polite">${submitStateHTML(res.status)}</div>
        <div class="btn-row"><button class="btn primary" type="button" data-home>${icon.home} 返回首頁</button></div>`;
      box.querySelector('[data-home]').addEventListener('click', () => { location.hash = '#/'; });
      stage.append(box);
      return;
    }
    const byWord = new Map((result.details || []).map((d) => [String(d.word), d]));
    const details = mine.map((d) => { const r = byWord.get(d.word) || {}; return { ...d, correct: r.correct || '', ok: !!r.ok, points: Number(r.points) || 0 }; });
    const pct = result.pct, points = result.score;
    const prevBest = store.best(unitId).pattern ?? null;
    store.setBest(unitId, 'pattern', pct);
    const passed = pct >= PASS;
    if (passed) store.setDone(unitId); else store.setTried(unitId);
    store.setFirst(unitId, { mode: 'pattern', details });
    const byKind = {};
    details.forEach((d) => { const k = (byKind[d[barKey]] = byKind[d[barKey]] || { ok: 0, n: 0 }); k.n++; k.ok = Math.round((k.ok + (Number(d.points) || 0)) * 100) / 100; });
    const bars = `<div class="stage-bars">${Object.entries(byKind).map(([k, v]) => `<div class="stage-bar"><span class="sb-name">${esc(k)}</span><span class="bar"><span style="--w:${Math.round((v.ok / v.n) * 100)}%"></span></span><span class="sb-score">${fmt(v.ok)}/${v.n}</span></div>`).join('')}</div>`;
    const wrongN = details.filter((d) => !d.ok).length;
    if (!wrongN) completeReview(unitId);
    const actions = [!wrongN
      ? { label: '返回首頁', icon: icon.home, primary: true, onClick: () => { location.hash = '#/'; } }
      : { label: `看答案與解析（錯 ${wrongN} 題）`, icon: icon.bulb, primary: true, onClick: () => startReview(details) }];
    renderResult(stage, {
      title: passed ? '句型練習通過！' : '未通過',
      pct, scoreText: `${fmt(points)} / ${result.total ?? mine.length}`,
      pills: [`${icon.clock} ${Math.floor(durationSec / 60)} 分 ${durationSec % 60} 秒`, wrongN ? '接著看答案與解析，完成後才能複習' : '全部答對'],
      passLine: true, prevBest, onRetake: retake,
      extraHTML: `${bars}${stampHTML(student, ctx.unit.title, stamp)}<div data-submit role="status" aria-live="polite">${submitStateHTML(res.status)}</div>`,
      actions,
    });
  }

  // 循序漸進版正式測驗：每段驗收做完，交給伺服器批改（第一次作答就鎖定），全部句型做完交卷
  function playLearn(student) {
    const session = newAttemptId();
    const t0 = Date.now();
    progress.clear(unitId);
    document.body.dataset.busy = '1';
    document.getElementById('fx').replaceChildren();
    window.addEventListener('beforeunload', unload);
    stage.innerHTML = '';
    const grade = async (q, yours) => {
      if (keyed) return { got: q.kind === 'apply' ? applyScore(q, yours) : (judge(q, yours) ? 1 : 0), q };
      const j = await checkAnswer({ unit: unitId, session, qid: q.id, yours });
      return { got: Number(j.got) || 0, q: j.q || q };
    };
    const run = mountLearn(stage, {
      guides, items: (ctx.data || {}).items, prefs: learnPrefs(), grade,
      onFinish: async ({ details: done }) => {
        delete document.body.dataset.busy;
        window.removeEventListener('beforeunload', unload);
        const durationSec = Math.round((Date.now() - t0) / 1000);
        const stamp = nowStamp();
        const wasTried = store.tried(unitId);
        const nameOf = new Map(run.sections.flatMap((s) => s.quiz.map((q) => [q.id, s.g.name || s.tag])));
        const byId = new Map(all.map((q) => [q.id, q]));
        const mine = done.map((d, i) => {
          const q = byId.get(d.word) || {};
          return { stage: String(nameOf.get(d.word) || '句型練習').slice(0, 20), n: i + 1, kind: q.label || '', q: q.kind === 'apply' ? q.zh : q.stem, correct: '', yours: String(d.yours || ''), ok: false, points: 0, hints: 0, word: d.word, err: '' };
        });
        stage.innerHTML = '<div class="loading"><span class="spinner"></span>交卷中，伺服器正在計分…</div>';
        window.scrollTo(0, 0);
        const res = await submitScore({
          clientTs: stamp, cls: student.cls, seat: student.seat, name: student.name,
          unit: unitId, unitTitle: ctx.unit.title, mode: 'pattern', flow: 'learn', review: false, attemptId: session,
          level: `${wasTried ? '補考 · ' : ''}句型練習`.slice(0, 60),
          score: null, total: 100, pct: null, durationSec, wrong: [], details: mine,
        });
        if (!alive) return;
        showSubmitted({ student, res, mine, stamp, durationSec, retake: () => playLearn(student), barKey: 'stage' });
      },
    });
  }

  return () => {
    alive = false;
    window.removeEventListener('beforeunload', unload);
    if (onKey) document.removeEventListener('keydown', onKey);
  };
}
