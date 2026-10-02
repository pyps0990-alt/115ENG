// 段考複習：像真的考卷，一頁看完所有題目（選擇、拼寫、閱讀、綜合），一次交卷；交卷後看各題型成績，再逐題檢討答錯的題目
import { store } from '../storage.js';
import { esc, nowStamp, confirmDialog, centerInView, splitSentences } from '../util.js';
import { icon } from '../icons.js';
import { renderResult } from '../components/result.js';
import { unitWindow } from '../remote-config.js';
import { testGate, submitStateHTML, stampHTML } from '../components/gate.js';
import { mountReview, completeReview } from '../components/review.js';
import { submitScore } from '../submit.js';
import { PASS } from '../levels.js';
import { flattenExam, KEYS, blankHTML, reviewCardHTML, correctText, judge } from '../components/items.js';

const SECTION = { mc: '詞彙・選擇題', spell: '單字拼寫', phrase: '片語拼寫', reading: '閱讀測驗', cloze: '綜合測驗（克漏字）', bank: '文意選填', struct: '篇章結構', translate: '中譯英（不計分）', essay: '英文作文（不計分）' };
const wordCount = (t) => (String(t).match(/[A-Za-z0-9'’-]+/g) || []).length;
// 綜合測驗的文章：(1) ____ 換成有編號的小圓標
const clozeHTML = (t) => esc(t).replace(/\((\d+)\)\s*(?:_+)?/g, '<span class="cloze-no">$1</span>');

export function mount(stage, ctx) {
  const data = ctx.data || {};
  const blocks = data.blocks || [];
  const all = flattenExam(blocks);
  const byId = Object.fromEntries(all.map((q) => [q.id, q]));
  const scored = all.filter((q) => q.kind !== 'open'); // 翻譯、作文沒有標準答案，不算分數
  const openQs = all.filter((q) => q.kind === 'open');
  const unitId = ctx.unit.id;
  let alive = true;
  const unload = (e) => { e.preventDefault(); e.returnValue = ''; };

  if (!all.length) {
    stage.innerHTML = `<div class="empty"><div class="big">${icon.file}</div><p>這個單元還沒有題目。</p></div>`;
    return;
  }
  const kinds = [...new Set(scored.map((q) => q.label))];
  const kindCount = kinds.map((k) => `${k} ${scored.filter((q) => q.label === k).length} 題`).join('、');

  // 文意選填、篇章結構：文章上方列出共用的字庫／句子庫
  const bankHTML = (b) => (b.type === 'bank' || b.type === 'struct')
    ? `<ol class="bank-list ${b.type}" type="A">${(b.bank || []).map((o, j) => `<li><span class="opt-key">${KEYS[j]}</span><span class="en">${esc(o)}</span></li>`).join('')}</ol>` : '';

  /* ---------------- 文章（閱讀、綜合）---------------- */
  const passageCard = (b) => `<article class="passage-card">
      <div class="eyebrow">${b.type === 'cloze' ? 'Cloze Test' : b.type === 'bank' ? 'Word Bank' : b.type === 'struct' ? 'Text Structure' : 'Passage'}</div>
      ${b.title ? `<h2 class="passage-title en">${esc(b.title)}</h2>` : ''}
      ${bankHTML(b)}${(b.passage || []).map((p) => `<p><span class="ptext">${b.type === 'cloze' || b.type === 'bank' || b.type === 'struct' ? clozeHTML(p) : esc(p)}</span></p>`).join('')}
    </article>`;
  // 檢討時：展開文章並標亮這題的原文依據（關鍵字句，或原文句子編號 段-句）
  const normQ = (t) => String(t).replace(/[‘’]/g, "'").replace(/[“”]/g, '"').toLowerCase();
  const evidencePassage = (b, q) => {
    const key = String((q && q.key) || '').replace(/\s+/g, ' ').trim();
    const refs = String((q && q.ref) || '').split(',').map((r) => r.trim()).filter(Boolean);
    let found = false;
    const paras = (b.passage || []).map((p, i) => {
      if (key) {
        const at = normQ(p).indexOf(normQ(key));
        if (at >= 0) { found = true; return `${esc(p.slice(0, at))}<mark class="evidence">${esc(p.slice(at, at + key.length))}</mark>${esc(p.slice(at + key.length))}`; }
        return esc(p);
      }
      return splitSentences(p).map((s, j) => {
        const hit = refs.includes(`${i + 1}-${j + 1}`);
        found = found || hit;
        return hit ? `<mark class="evidence">${esc(s)}</mark>` : esc(s);
      }).join(' ');
    });
    return { found, html: paras.map((p) => `<p><span class="ptext">${p}</span></p>`).join('') };
  };
  const passageText = (b, q) => {
    if (b.type === 'reading' && q && (q.key || q.ref)) {
      const ev = evidencePassage(b, q);
      if (ev.found) return `<details class="rv-passage" open><summary>${icon.book} 原文依據</summary><article class="passage-card">${b.title ? `<h2 class="passage-title en">${esc(b.title)}</h2>` : ''}${ev.html}</article></details>`;
    }
    return passageText0(b);
  };
  const passageText0 = (b) => `<details class="rv-passage"><summary>${icon.book} 看文章</summary>${passageCard(b)}</details>`;

  // 翻譯、作文：沒有標準答案，並排你的答案、參考答案與評分重點，讓學生自己對照
  const openReviewHTML = (q, yours) => `<div class="pq rv-pq open-rv">
      <div class="pq-head"><span class="pq-num">${icon.pencil}</span><div><span class="skill">${esc(q.label)}・自己對照</span><div class="pq-q ${q.open === 'translate' ? '' : 'en'}">${esc(q.stem)}</div></div></div>
      <div class="rv-row"><span>你的答案</span><p class="open-ans en">${yours ? esc(yours) : '（沒有作答）'}</p></div>
      <div class="rv-row ok"><span>參考${q.open === 'translate' ? '答案' : '範文'}</span><p class="open-ans en">${esc(String(q.answer || '').split('|').join('\n')).replace(/\n/g, '<br>')}</p></div>
      ${q.explain ? `<div class="explain"><b class="ex-head ok">${icon.bulb} 評分重點</b><p>${esc(q.explain)}</p></div>` : ''}
    </div>`;
  const writingSummaryHTML = (details) => {
    const list = (details || []).filter((d) => byId[d.word] && byId[d.word].kind === 'open');
    if (!list.length) return '';
    return `<div class="writing-sum"><h3>${icon.pencil} 寫作題（不計分，請自己對照）</h3>${list.map((d) => `<details class="open-sum"><summary>${esc(byId[d.word].label)}：${esc(String(byId[d.word].stem).slice(0, 40))}</summary>${openReviewHTML(byId[d.word], d.yours)}</details>`).join('')}</div>`;
  };

  /* ---------------- 交卷後逐題檢討 ---------------- */
  function startReview(details) {
    document.getElementById('fx').replaceChildren();
    const firstTime = !store.reviewed(unitId);
    const wrong = (details || []).filter((d) => !d.ok && !(byId[d.word] && byId[d.word].kind === 'open'));
    const writing = (details || []).filter((d) => byId[d.word] && byId[d.word].kind === 'open');
    mountReview(stage, {
      title: `${ctx.unit.title}｜${firstTime ? '檢討' : '再看一次檢討'}`,
      items: wrong.map((d) => {
        const q = byId[d.word];
        if (!q) return { html: `<div class="rv-card"><div class="rv-prompt">${esc(d.q || d.question || '')}</div><div class="rv-row ok"><span>正確答案</span><b class="en">${esc(d.correct || '')}</b></div></div>` };
        const b = blocks[q.block];
        return { html: reviewCardHTML(q, d.yours, q.group ? passageText(b, q.group === 'reading' ? (b.questions || [])[q.sub] : null) : '') };
      }).concat(writing.map((d) => ({ html: openReviewHTML(byId[d.word], d.yours) }))),
      onDone: () => { if (firstTime) completeReview(unitId); gate.redraw(); window.scrollTo(0, 0); },
      onExit: () => { gate.redraw(); window.scrollTo(0, 0); },
    });
    window.scrollTo(0, 0);
  }

  const gate = testGate(stage, {
    timeWindow: () => unitWindow(ctx.config, unitId),
    eyebrow: 'Exam Review',
    title: `${ctx.unit.title}｜${data.topic || '段考複習'}`,
    rules: [
      `共 <b>${scored.length}</b> 題計分：${esc(kindCount)}${openQs.length ? `；另有 <b>${openQs.length}</b> 題寫作（翻譯／作文）不計分，交卷後對照參考答案自己檢查` : ''}`,
      '像真的考卷一樣，一頁看完全部題目，最後一次交卷',
      `總分達 <b>${PASS}%</b> 就算通過；交卷後看各題型成績，再逐題檢討答錯的題目`,
    ],
    best: () => store.best(unitId).exam,
    review: () => store.done(unitId),
    reviewed: () => store.reviewed(unitId),
    retake: () => store.tried(unitId) && !store.done(unitId),
    onStart: (s, review) => run(s, review),
    onReview: () => startReview((store.first(unitId) || {}).details),
  });

  /* ---------------- 作答 ---------------- */
  // redo：只重練指定的題目（錯題重練），不計成績、不送出
  let stopNav = () => {};
  function run(student, review = false, redo = null) {
    const scope = redo ? scored.filter((q) => redo.includes(q.id)) : all;
    const inScope = new Set(scope.map((q) => q.id));
    const scopeScored = scope.filter((q) => q.kind !== 'open');
    const scopeOpen = scope.filter((q) => q.kind === 'open');
    const ans = {};
    const t0 = Date.now();
    document.body.dataset.busy = '1';
    window.addEventListener('beforeunload', unload);

    let no = 0;
    let prev = '';
    const choiceCard = (q) => `<div class="pq" data-id="${q.id}">
        <div class="pq-head"><span class="pq-num">${++no}</span>
          <div>${q.tag ? `<span class="skill">${esc(q.tag)}</span>` : ''}<div class="pq-q en">${q.group === 'cloze' ? `<b>${esc(q.stem)}</b>` : blankHTML(q.stem)}</div></div></div>
        <div class="options">${q.options.map((o, j) => `<button class="opt" type="button" data-i="${j}">
          <span class="opt-key">${KEYS[j]}</span><span class="opt-text en">${esc(o)}</span><span class="opt-mark" aria-hidden="true"></span></button>`).join('')}</div>
      </div>`;
    const selectCard = (q) => `<div class="pq sel-pq" data-id="${q.id}">
        <div class="pq-head"><span class="pq-num">${++no}</span><div class="pq-q">${esc(q.stem)}</div></div>
        <select class="bank-select" data-select aria-label="${esc(q.stem)}"><option value="">請選擇</option>${q.options.map((o, j) => `<option value="${j}">${KEYS[j]}${q.group === 'bank' ? `. ${esc(o)}` : ''}</option>`).join('')}</select>
      </div>`;
    const spellCard = (q) => `<div class="pq" data-id="${q.id}">
        <div class="pq-head"><span class="pq-num">${++no}</span>
          <div><div class="pq-q en">${blankHTML(q.stem)}</div>${q.hint ? `<div class="muted">${esc(q.hint)}</div>` : ''}</div></div>
        <input class="fill-input en" data-spell type="text" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" aria-label="輸入答案" placeholder="輸入答案">
      </div>`;

    const openCard = (q) => `<div class="pq open-pq" data-id="${q.id}">
        <div class="pq-head"><span class="pq-num">${++no}</span>
          <div><div class="pq-q ${q.open === 'translate' ? '' : 'en'}">${esc(q.stem)}</div>${q.hint ? `<div class="muted">${esc(q.hint)}</div>` : ''}
          ${q.open === 'essay' && q.minWords ? `<div class="muted">至少 ${q.minWords} 個英文字</div>` : ''}</div></div>
        <textarea class="open-input en" data-open rows="${q.open === 'essay' ? 9 : 3}" autocomplete="off" autocapitalize="sentences" spellcheck="false" aria-label="${q.open === 'essay' ? '作文' : '翻譯'}" placeholder="${q.open === 'essay' ? '在這裡寫作文…' : '在這裡寫出英文翻譯…'}"></textarea>
        ${q.open === 'essay' ? `<div class="wc" data-wc>0${q.minWords ? ` / ${q.minWords}` : ''} 字</div>` : ''}
      </div>`;

    const parts = blocks.map((b, i) => {
      if (redo && !scope.some((q) => q.block === i)) return '';
      const head = prev !== b.type ? `<h3 class="exam-sec">${esc(SECTION[b.type])}</h3>` : '';
      prev = b.type;
      if (b.type === 'mc') return head + choiceCard(byId[`b${i}`]);
      if (b.type === 'spell' || b.type === 'phrase') return head + spellCard(byId[`b${i}`]);
      if (b.type === 'translate' || b.type === 'essay') return head + openCard(byId[`b${i}`]);
      const qs = scope.filter((q) => q.block === i);
      const card = b.type === 'bank' || b.type === 'struct' ? selectCard : choiceCard;
      return `${head}<div class="passage-layout exam-group">${passageCard(b)}<section class="pq-list">${qs.map(card).join('')}</section></div>`;
    }).join('');

    stage.innerHTML = `
      <div class="exam-body">
        <div class="pq-intro"><span class="eyebrow">${redo ? '錯題重練' : `Exam${review ? ' · 複習' : ''}`}</span><span class="muted">${redo ? '只有剛才答錯的題目，這次練習不計成績' : '全部題目在這一頁，可以隨時回頭修改，最後按「交卷」'}</span></div>
        ${parts}
      </div>
      <div class="exam-nav" data-nav hidden role="dialog" aria-label="題號導覽">
        <div class="en-head"><b>題號導覽</b><span class="muted" data-nav-sum></span>
          <button class="en-close" type="button" data-nav-close aria-label="關閉">${icon.x}</button></div>
        <div class="en-body" data-nav-body></div>
        <button class="btn small" type="button" data-nav-next>${icon.arrowR} 跳到下一題還沒作答的</button>
      </div>
      <div class="passage-foot">
        <button class="btn small ghost nav-btn" type="button" data-nav-btn aria-expanded="false">${icon.list} 題號</button>
        <span class="count" data-count></span>
        <button class="btn primary" type="button" data-submit-btn>${icon.send} ${redo ? '看結果' : '交卷'}</button>
      </div>`;
    centerInView(stage.querySelector('.exam-body'), 'start');

    const filled = (v) => v !== '' && v != null;
    const answeredN = () => scopeScored.filter((q) => filled(ans[q.id])).length;
    const openFilledN = () => scopeOpen.filter((q) => filled(ans[q.id])).length;
    const countEl = stage.querySelector('[data-count]');
    /* ---- 題號導覽：看每題有沒有作答，點題號快速前往 ---- */
    const navEl = stage.querySelector('[data-nav]');
    const navBtn = stage.querySelector('[data-nav-btn]');
    const cards = [...stage.querySelectorAll('.pq')];
    const numOf = Object.fromEntries(cards.map((c) => [c.dataset.id, c.querySelector('.pq-num').textContent.trim()]));
    const groups = [];
    scope.forEach((q) => {
      const label = SECTION[blocks[q.block].type].replace(/（.*?）/, '');
      let g = groups[groups.length - 1];
      if (!g || g.label !== label) groups.push(g = { label, ids: [] });
      g.ids.push(q.id);
    });
    stage.querySelector('[data-nav-body]').innerHTML = groups.map((g) => `<div class="en-group"><span class="en-label">${esc(g.label)}</span><div class="en-chips">${g.ids.map((qid) => `<button class="en-chip${byId[qid].kind === 'open' ? ' open' : ''}" type="button" data-go="${qid}" aria-label="第 ${numOf[qid]} 題">${numOf[qid]}</button>`).join('')}</div></div>`).join('');
    const chipOf = (qid) => navEl.querySelector(`[data-go="${qid}"]`);
    let curId = null;
    const setNavOpen = (on) => { navEl.hidden = !on; navBtn.setAttribute('aria-expanded', String(on)); navBtn.classList.toggle('on', on); };
    const go = (qid) => {
      const card = stage.querySelector(`.pq[data-id="${qid}"]`);
      if (!card) return;
      card.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
      card.classList.add('flash'); setTimeout(() => card.classList.remove('flash'), 1200);
      if (window.innerWidth < 700) setNavOpen(false);
    };
    navBtn.addEventListener('click', () => setNavOpen(navEl.hidden));
    navEl.querySelector('[data-nav-close]').addEventListener('click', () => setNavOpen(false));
    navEl.addEventListener('click', (e) => { const b = e.target.closest('[data-go]'); if (b) go(b.dataset.go); });
    navEl.querySelector('[data-nav-next]').addEventListener('click', () => {
      const order = scope.map((q) => q.id);
      const from = Math.max(0, order.indexOf(curId));
      const next = [...order.slice(from + 1), ...order.slice(0, from + 1)].find((qid) => !filled(ans[qid]) && byId[qid].kind !== 'open') || order.find((qid) => !filled(ans[qid]));
      if (next) go(next);
    });
    // 目前看到哪一題（畫面中間附近的那張卡片）
    const io = 'IntersectionObserver' in window ? new IntersectionObserver((entries) => {
      entries.forEach((en) => { if (en.isIntersecting) { curId = en.target.dataset.id; navEl.querySelectorAll('.en-chip.cur').forEach((c) => c.classList.remove('cur')); chipOf(curId)?.classList.add('cur'); } });
    }, { rootMargin: '-40% 0px -45% 0px' }) : null;
    cards.forEach((c) => io && io.observe(c));
    stopNav = () => { if (io) io.disconnect(); };
    const paintNav = () => {
      scope.forEach((q) => chipOf(q.id)?.classList.toggle('done', filled(ans[q.id])));
      const left = scopeScored.length - answeredN();
      stage.querySelector('[data-nav-sum]').textContent = left ? `還有 ${left} 題沒作答` : '都作答了';
    };
    const updateFoot = () => { paintNav(); countEl.textContent = `已作答 ${answeredN()} / ${scopeScored.length}${scopeOpen.length ? `・寫作 ${openFilledN()} / ${scopeOpen.length}` : ''}`; };
    stage.querySelectorAll('.pq').forEach((card) => {
      const id = card.dataset.id;
      card.querySelectorAll('.opt').forEach((o) => o.addEventListener('click', () => {
        ans[id] = Number(o.dataset.i);
        card.querySelectorAll('.opt').forEach((x, k) => x.classList.toggle('selected', k === ans[id]));
        card.classList.add('done');
        updateFoot();
      }));
      card.querySelector('[data-select]')?.addEventListener('change', (e) => {
        ans[id] = e.target.value === '' ? null : Number(e.target.value);
        card.classList.toggle('done', ans[id] != null);
        updateFoot();
      });
      card.querySelector('[data-open]')?.addEventListener('input', (e) => {
        ans[id] = e.target.value.trim();
        card.classList.toggle('done', !!ans[id]);
        const wc = card.querySelector('[data-wc]');
        if (wc) { const n = wordCount(e.target.value); const min = byId[id].minWords; wc.textContent = `${n}${min ? ` / ${min}` : ''} 字`; wc.classList.toggle('ok', !!min && n >= min); }
        updateFoot();
      });
      card.querySelector('[data-spell]')?.addEventListener('input', (e) => { ans[id] = e.target.value.trim(); card.classList.toggle('done', !!ans[id]); updateFoot(); });
    });
    stage.querySelector('[data-submit-btn]').addEventListener('click', async () => {
      const blank = scopeScored.length - answeredN();
      const blankOpen = scopeOpen.length - openFilledN();
      const ok = await confirmDialog({
        title: redo ? '要看結果了嗎？' : '確定要交卷嗎？',
        body: (blank ? `還有 <b>${blank}</b> 題沒有作答。` : '所有題目都作答了。') + (blankOpen ? `寫作題有 <b>${blankOpen}</b> 題還沒寫（不計分）。` : '') + (redo ? '' : '交卷後就不能修改。'),
        ok: redo ? '看結果' : '交卷', cancel: '再檢查',
      });
      if (ok && alive) finish(student, review, ans, t0, scope, redo);
    });
    updateFoot();
  }

  async function finish(student, review, ans, t0, scope = all, redo = null) {
    window.removeEventListener('beforeunload', unload);
    delete document.body.dataset.busy;
    stopNav();
    const stamp = nowStamp();
    const durationSec = Math.round((Date.now() - t0) / 1000);
    const details = scope.map((q, i) => {
      const a = ans[q.id];
      if (q.kind === 'open') {
        return { stage: '段考複習', n: i + 1, kind: q.label, q: q.stem, correct: correctText(q), yours: String(a || ''), ok: true, open: true, points: 0, hints: 0, word: q.id, err: '' };
      }
      const yours = q.kind === 'mc' ? (a == null ? '' : `${KEYS[a]}. ${q.options[a]}`) : String(a || '');
      const ok = !!yours && judge(q, yours);
      return { stage: '段考複習', n: i + 1, kind: q.label, q: q.stem, correct: correctText(q), yours, ok, points: ok ? 1 : 0, hints: 0, word: q.id, err: '' };
    });
    const sd = details.filter((d) => !d.open); // 計分的題目
    const points = sd.filter((d) => d.ok).length;
    const pct = sd.length ? Math.round((points / sd.length) * 100) : 100;
    if (!redo) store.setBest(unitId, 'exam', pct);
    const official = !review && !redo;
    const wasTried = official && store.tried(unitId);
    const passed = pct >= PASS;
    if (official) { if (passed) store.setDone(unitId); else store.setTried(unitId); }
    const byKind = {};
    sd.forEach((d) => { const k = (byKind[d.kind] = byKind[d.kind] || { ok: 0, n: 0 }); k.n++; if (d.ok) k.ok++; });
    const per = Object.entries(byKind).map(([k, v]) => `${k} ${v.ok}/${v.n}`).join('・');
    const firstTest = !review && !redo;
    if (firstTest) store.setFirst(unitId, { mode: 'exam', details });

    stage.innerHTML = '';
    window.scrollTo(0, 0);
    const bars = `<div class="stage-bars">${Object.entries(byKind).map(([k, v]) => {
      const p = Math.round((v.ok / v.n) * 100);
      return `<div class="stage-bar"><span class="sb-name">${esc(k)}</span><span class="bar"><span style="width:${p}%"></span></span><span class="sb-score">${v.ok}/${v.n}</span></div>`;
    }).join('')}</div>`;
    const wrongIds = sd.filter((d) => !d.ok).map((d) => d.word);
    const wrongN = wrongIds.length;
    const actions = [];
    if (redo) {
      if (wrongN) actions.push({ label: `再練錯的 ${wrongN} 題`, icon: icon.shuffle, primary: true, onClick: () => run(student, review, wrongIds) });
      actions.push({ label: '完成', icon: icon.check, primary: !wrongN, onClick: () => { gate.redraw(); window.scrollTo(0, 0); } });
    } else {
      if (firstTest) actions.push({ label: '開始檢討', icon: icon.bulb, primary: true, onClick: () => startReview(details) });
      else {
        if (wrongN) actions.push({ label: `檢討錯的 ${wrongN} 題`, icon: icon.bulb, primary: true, onClick: () => startReview(details) });
        actions.push({ label: '再做一次', icon: icon.redo, primary: !wrongN, onClick: () => run(student, true) });
      }
      if (official && !passed) actions.push({ label: '馬上補考', icon: icon.redo, onClick: () => run(student, false) });
      if (wrongN) actions.push({ label: `重練錯的 ${wrongN} 題（不計成績）`, icon: icon.shuffle, onClick: () => run(student, review, wrongIds) });
    }
    const box = renderResult(stage, {
      title: redo ? '錯題重練完成' : `${review ? '複習' : '段考複習'}${passed ? '通過！' : official ? '未通過' : '完成'}`,
      pct,
      scoreText: `${points} / ${sd.length}`,
      pills: [`${icon.clock} ${Math.floor(durationSec / 60)} 分 ${durationSec % 60} 秒`, redo ? '這是練習，不計入成績' : official && !passed ? `需要補考：先檢討，再重新做一次，總分達 ${PASS}% 才通過` : firstTest ? '接著逐題檢討，完成後才能複習' : '可以再看一次檢討'],
      extraHTML: `${bars}${writingSummaryHTML(details)}${redo ? '' : `${stampHTML(student, ctx.unit.title, stamp)}<div data-submit>${submitStateHTML('sending')}</div>`}`,
      actions,
    });
    if (redo) return;
    const res = await submitScore({
      clientTs: stamp, cls: student.cls, seat: student.seat, name: student.name,
      unit: unitId, unitTitle: ctx.unit.title, mode: 'exam', review,
      level: `${review ? '複習 · ' : wasTried ? '補考 · ' : ''}段考複習 ${per}`.slice(0, 60),
      score: points, total: sd.length, pct, durationSec,
      wrong: wrongIds,
      details,
    });
    const s = box.querySelector('[data-submit]');
    if (s) s.innerHTML = submitStateHTML(res.status);
  }

  return () => {
    alive = false;
    window.removeEventListener('beforeunload', unload);
  };
}
