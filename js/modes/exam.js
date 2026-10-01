// 段考複習：像真的考卷，一頁看完所有題目（選擇、拼寫、閱讀、綜合），一次交卷；交卷後看各題型成績，再逐題檢討答錯的題目
import { store } from '../storage.js';
import { esc, nowStamp, confirmDialog, centerInView } from '../util.js';
import { icon } from '../icons.js';
import { renderResult } from '../components/result.js';
import { unitWindow } from '../remote-config.js';
import { testGate, submitStateHTML, stampHTML } from '../components/gate.js';
import { mountReview, completeReview } from '../components/review.js';
import { submitScore } from '../submit.js';
import { PASS } from '../levels.js';
import { flattenExam, KEYS, blankHTML, reviewCardHTML, correctText, judge, KIND_LABEL } from '../components/items.js';

const SECTION = { mc: '詞彙・選擇題', spell: '單字拼寫', phrase: '片語拼寫', reading: '閱讀測驗', cloze: '綜合測驗（克漏字）', bank: '文意選填', struct: '篇章結構' };
// 綜合測驗的文章：(1) ____ 換成有編號的小圓標
const clozeHTML = (t) => esc(t).replace(/\((\d+)\)\s*(?:_+)?/g, '<span class="cloze-no">$1</span>');

export function mount(stage, ctx) {
  const data = ctx.data || {};
  const blocks = data.blocks || [];
  const all = flattenExam(blocks);
  const byId = Object.fromEntries(all.map((q) => [q.id, q]));
  const unitId = ctx.unit.id;
  let alive = true;
  const unload = (e) => { e.preventDefault(); e.returnValue = ''; };

  if (!all.length) {
    stage.innerHTML = `<div class="empty"><div class="big">${icon.file}</div><p>這個單元還沒有題目。</p></div>`;
    return;
  }
  const kinds = [...new Set(all.map((q) => q.label))];
  const kindCount = kinds.map((k) => `${k} ${all.filter((q) => q.label === k).length} 題`).join('、');

  // 文意選填、篇章結構：文章上方列出共用的字庫／句子庫
  const bankHTML = (b) => (b.type === 'bank' || b.type === 'struct')
    ? `<ol class="bank-list ${b.type}" type="A">${(b.bank || []).map((o, j) => `<li><span class="opt-key">${KEYS[j]}</span><span class="en">${esc(o)}</span></li>`).join('')}</ol>` : '';

  /* ---------------- 文章（閱讀、綜合）---------------- */
  const passageCard = (b) => `<article class="passage-card">
      <div class="eyebrow">${b.type === 'cloze' ? 'Cloze Test' : b.type === 'bank' ? 'Word Bank' : b.type === 'struct' ? 'Text Structure' : 'Passage'}</div>
      ${b.title ? `<h2 class="passage-title en">${esc(b.title)}</h2>` : ''}
      ${bankHTML(b)}${(b.passage || []).map((p) => `<p><span class="ptext">${b.type === 'cloze' || b.type === 'bank' || b.type === 'struct' ? clozeHTML(p) : esc(p)}</span></p>`).join('')}
    </article>`;
  const passageText = (b) => `<details class="rv-passage"><summary>${icon.book} 看文章</summary>${passageCard(b)}</details>`;

  /* ---------------- 交卷後逐題檢討 ---------------- */
  function startReview(details) {
    document.getElementById('fx').replaceChildren();
    const firstTime = !store.reviewed(unitId);
    const wrong = (details || []).filter((d) => !d.ok);
    mountReview(stage, {
      title: `${ctx.unit.title}｜${firstTime ? '檢討' : '再看一次檢討'}`,
      items: wrong.map((d) => {
        const q = byId[d.word];
        if (!q) return { html: `<div class="rv-card"><div class="rv-prompt">${esc(d.q || d.question || '')}</div><div class="rv-row ok"><span>正確答案</span><b class="en">${esc(d.correct || '')}</b></div></div>` };
        const b = blocks[q.block];
        return { html: reviewCardHTML(q, d.yours, q.group ? passageText(b) : '') };
      }),
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
      `共 <b>${all.length}</b> 題：${esc(kindCount)}`,
      '像真的考卷一樣，一頁看完全部題目，最後一次交卷',
      `總分達 <b>${PASS}%</b> 就算通過；交卷後看各題型成績，再逐題檢討答錯的題目`,
    ],
    best: () => store.best(unitId).exam,
    review: () => store.done(unitId),
    reviewed: () => store.reviewed(unitId),
    onStart: (s, review) => run(s, review),
    onReview: () => startReview((store.first(unitId) || {}).details),
  });

  /* ---------------- 作答 ---------------- */
  function run(student, review = false) {
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

    const parts = blocks.map((b, i) => {
      const head = prev !== b.type ? `<h3 class="exam-sec">${esc(SECTION[b.type])}</h3>` : '';
      prev = b.type;
      if (b.type === 'mc') return head + choiceCard(byId[`b${i}`]);
      if (b.type === 'spell' || b.type === 'phrase') return head + spellCard(byId[`b${i}`]);
      const qs = all.filter((q) => q.block === i);
      const card = b.type === 'bank' || b.type === 'struct' ? selectCard : choiceCard;
      return `${head}<div class="passage-layout exam-group">${passageCard(b)}<section class="pq-list">${qs.map(card).join('')}</section></div>`;
    }).join('');

    stage.innerHTML = `
      <div class="exam-body">
        <div class="pq-intro"><span class="eyebrow">Exam${review ? ' · 複習' : ''}</span><span class="muted">全部題目在這一頁，可以隨時回頭修改，最後按「交卷」</span></div>
        ${parts}
      </div>
      <div class="passage-foot">
        <span class="count" data-count></span>
        <button class="btn primary" type="button" data-submit-btn>${icon.send} 交卷</button>
      </div>`;
    centerInView(stage.querySelector('.exam-body'), 'start');

    const answeredN = () => Object.values(ans).filter((v) => v !== '' && v != null).length;
    const countEl = stage.querySelector('[data-count]');
    const updateFoot = () => { countEl.textContent = `已作答 ${answeredN()} / ${all.length}`; };
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
      card.querySelector('[data-spell]')?.addEventListener('input', (e) => { ans[id] = e.target.value.trim(); card.classList.toggle('done', !!ans[id]); updateFoot(); });
    });
    stage.querySelector('[data-submit-btn]').addEventListener('click', async () => {
      const blank = all.length - answeredN();
      const ok = await confirmDialog({
        title: '確定要交卷嗎？',
        body: blank ? `還有 <b>${blank}</b> 題沒有作答。交卷後就不能修改。` : '所有題目都作答了。交卷後就不能修改。',
        ok: '交卷', cancel: '再檢查',
      });
      if (ok && alive) finish(student, review, ans, t0);
    });
    updateFoot();
  }

  async function finish(student, review, ans, t0) {
    window.removeEventListener('beforeunload', unload);
    delete document.body.dataset.busy;
    const stamp = nowStamp();
    const durationSec = Math.round((Date.now() - t0) / 1000);
    const details = all.map((q, i) => {
      const a = ans[q.id];
      const yours = q.kind === 'mc' ? (a == null ? '' : `${KEYS[a]}. ${q.options[a]}`) : String(a || '');
      const ok = !!yours && judge(q, yours);
      return { stage: '段考複習', n: i + 1, kind: q.label, q: q.stem, correct: correctText(q), yours, ok, points: ok ? 1 : 0, hints: 0, word: q.id, err: '' };
    });
    const points = details.filter((d) => d.ok).length;
    const pct = Math.round((points / all.length) * 100);
    store.setBest(unitId, 'exam', pct);
    const byKind = {};
    details.forEach((d) => { const k = (byKind[d.kind] = byKind[d.kind] || { ok: 0, n: 0 }); k.n++; if (d.ok) k.ok++; });
    const per = Object.entries(byKind).map(([k, v]) => `${k} ${v.ok}/${v.n}`).join('・');
    const firstTest = !review;
    if (firstTest) store.setFirst(unitId, { mode: 'exam', details });

    stage.innerHTML = '';
    window.scrollTo(0, 0);
    const bars = `<div class="stage-bars">${Object.entries(byKind).map(([k, v]) => {
      const p = Math.round((v.ok / v.n) * 100);
      return `<div class="stage-bar"><span class="sb-name">${esc(k)}</span><span class="bar"><span style="width:${p}%"></span></span><span class="sb-score">${v.ok}/${v.n}</span></div>`;
    }).join('')}</div>`;
    const wrongN = details.length - points;
    const actions = [];
    if (firstTest) actions.push({ label: '開始檢討', icon: icon.bulb, primary: true, onClick: () => startReview(details) });
    else {
      if (wrongN) actions.push({ label: `檢討錯的 ${wrongN} 題`, icon: icon.bulb, primary: true, onClick: () => startReview(details) });
      actions.push({ label: '再做一次', icon: icon.redo, primary: !wrongN, onClick: () => run(student, true) });
    }
    const box = renderResult(stage, {
      title: `${review ? '複習' : '段考複習'}${pct >= PASS ? '通過！' : '完成'}`,
      pct,
      scoreText: `${points} / ${all.length}`,
      pills: [`${icon.clock} ${Math.floor(durationSec / 60)} 分 ${durationSec % 60} 秒`, firstTest ? '接著逐題檢討，完成後才能複習' : '可以再看一次檢討'],
      extraHTML: `${bars}${stampHTML(student, ctx.unit.title, stamp)}<div data-submit>${submitStateHTML('sending')}</div>`,
      actions,
    });
    const res = await submitScore({
      clientTs: stamp, cls: student.cls, seat: student.seat, name: student.name,
      unit: unitId, unitTitle: ctx.unit.title, mode: 'exam', review,
      level: `${review ? '複習 · ' : ''}段考複習 ${per}`.slice(0, 60),
      score: points, total: all.length, pct, durationSec,
      wrong: details.filter((d) => !d.ok).map((d) => d.word),
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
