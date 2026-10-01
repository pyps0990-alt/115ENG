import { loadIndex, loadUnit, applyImported, addCustomUnits } from './data.js';
import { getConfig, watchConfig, unitVisible, modeOn, questionCount, unitWindow, fmtWhen } from './remote-config.js';
import { store } from './storage.js';
import { esc, confirmDialog } from './util.js';
import { icon } from './icons.js';
import { renderStudentChip, mountInlineForm, historyReady, closeChipPanel } from './student.js';
import { LEVELS, PASS } from './levels.js';
import { initNav, updateNav } from './nav.js';
import { flushOutbox, pendingItems, clearOutbox } from './submit.js';
import { SCRIPT_URL } from './config.js';
import { TYPES, typeOf, typeLabel, bestKey, typeIcon } from './types.js';
// Firebase 程式庫很大，只在需要時才載入（登入、讀紀錄、老師頁面），不拖慢首頁
const firebase = () => import('./firebase.js');

// 測驗畫面的程式（單字、課文）要打開單元才用得到：首頁不載入，閒置時先在背景抓好
const modes = {
  vocab: () => import('./modes/vocab.js'),
  reading: () => import('./modes/reading.js'),
  pattern: () => import('./modes/pattern.js'),
  exam: () => import('./modes/exam.js'),
};
const idle = (fn) => (window.requestIdleCallback || ((f) => setTimeout(f, 800)))(fn, { timeout: 3000 });

// 重新整理或換頁後一律從最上面開始（不讓瀏覽器自己還原上次的捲動位置）
try { history.scrollRestoration = 'manual'; } catch { /* ignore */ }
const app = document.getElementById('app');
let index = null;
let config = null;
let cleanup = null;

/* ---------------- routing ---------------- */
const findUnit = (id) => index.units.find((u) => u.id === id || (u.aliases || []).includes(id));

// 換頁動畫：新頁面立刻畫出來，只做很短的淡入（只有網址真的換了才播，同一頁因資料更新重畫時不閃）
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
let lastRendered = null;
let lastDepth = 0;
let lastKind = '';
let prevUnitId = '';
function pageIn(changed, first) {
  // 第一次畫面不做進場動畫：從透明開始會讓「最大內容繪製」延後；也不用強制重排，改在下一格重新加上動畫
  if (!changed || first || reduceMotion.matches) return;
  app.classList.remove('page-in');
  requestAnimationFrame(() => app.classList.add('page-in'));
}
app.addEventListener('animationend', (e) => { if (e.target === app) app.classList.remove('page-in'); });

async function route() {
  const here = location.hash || '#/';
  const changed = here !== lastRendered;
  const first = lastRendered === null;
  lastRendered = here;
  // 回到上一層（單元 → 首頁）和進到下一層的進場方向相反，前進／後退有空間感（只做垂直位移，不左右移動）
  const depth = here === '#/' || here === '#' ? 0 : 1;
  if (changed) app.dataset.dir = depth < lastDepth ? 'back' : 'fwd';
  const prevKind = lastKind;
  lastDepth = depth;
  if (cleanup) { try { cleanup(); } catch { /* ignore */ } cleanup = null; }
  delete document.body.dataset.busy;
  closeChipPanel();
  document.getElementById('fx').replaceChildren();
  // 首頁不顯示「#/」，網址保持乾淨（replaceState 不會再觸發 hashchange）
  if (location.hash === '#/' || location.hash === '#') history.replaceState(null, '', location.pathname + location.search);
  const [, kind, id, sub] = location.hash.split('/').map(decodeURIComponent);
  lastKind = kind || '';
  window.scrollTo(0, 0);
  // 還沒確認身分：隱藏單元選單，單元網址一律導回首頁填資料
  const loggedIn = !!store.student();
  // 老師頁是獨立頁面：不顯示單元選單和學生名牌
  const teacher = kind === 'teacher';
  document.getElementById('nav-menu').hidden = teacher || !loggedIn || !visibleUnits().length;
  if (teacher) document.getElementById('student-chip').hidden = true;
  else renderStudentChip();
  if (kind === 'u' && !loggedIn) { location.replace('#/'); return; }
  updateNav(kind === 'u' && id ? (findUnit(id) || {}).id : null);
  const render = async () => {
    try {
      if (kind === 'u' && id) await renderUnit(id, sub);
      else if (kind === 'teacher') renderTeacher();
      else if (kind === 'me') await renderMe();
      else if (kind === 'privacy') renderPrivacy();
      else if (kind === 'diag') renderDiag();
      else renderHome();
    } catch (err) {
      showError(err);
    }
  };
  // 首頁 ↔ 單元頁：卡片放大成單元頁標題（返回時縮回卡片）。不支援 View Transitions 的瀏覽器直接用原本的淡入。
  const toUnit = kind === 'u' && id && prevKind !== 'u' && findUnit(id);
  const toHome = (!kind || kind === '') && prevKind === 'u';
  const useVT = changed && !first && !reduceMotion.matches && typeof document.startViewTransition === 'function' && (toUnit || toHome);
  if (useVT) {
    const out = toUnit ? app.querySelector(`.unit-tile[data-id="${CSS.escape(findUnit(id).id)}"]`) : app.querySelector('.unit-head');
    if (out) out.style.viewTransitionName = 'unit-card';
    const backId = prevUnitId;
    let vt;
    if (toUnit) {
      vt = document.startViewTransition(() => { app.innerHTML = unitShellHTML(findUnit(id)); });
      await vt.updateCallbackDone.catch(() => {});
      await render(); // 資料載入在轉場之外，不會凍住畫面
    } else {
      vt = document.startViewTransition(async () => {
        await render();
        const tile = backId && app.querySelector(`.unit-tile[data-id="${CSS.escape(backId)}"]`);
        if (tile) tile.style.viewTransitionName = 'unit-card';
      });
      await vt.updateCallbackDone.catch(() => {});
    }
    vt.finished.finally(() => { document.querySelectorAll('[style*="view-transition-name"]').forEach((e) => { e.style.viewTransitionName = ''; }); });
    prevUnitId = toUnit ? findUnit(id).id : '';
    return;
  }
  await render();
  prevUnitId = kind === 'u' && id && findUnit(id) ? findUnit(id).id : (kind === 'u' ? prevUnitId : '');
  pageIn(changed, first);
}

// 單元選單是否顯示：老師頁、還沒登入、沒有可用單元時隱藏。登入成功（不換頁）時也要更新，不然選單會一直藏著
function syncNav() {
  const kind = location.hash.split('/')[1] || '';
  document.getElementById('nav-menu').hidden = kind === 'teacher' || !store.student() || !visibleUnits().length;
}

const openLevels = (u) => LEVELS.filter((l) => modeOn(config, u.id, l.id));
// 還沒有題目的單元不給學生看（老師匯入內容後才出現）
const hasContent = (id) => !!(config && config.content && config.content[id]);
const visibleUnits = () => index.units.filter((u) => unitVisible(config, u.id) && hasContent(u.id)
  && (u.type === 'vocab' ? openLevels(u).length : modeOn(config, u.id, u.type)))
  .sort((a, b) => a.lesson - b.lesson);

/* ---------------- 錯誤頁 ---------------- */
// 依類型顯示學生看得懂的說明，不直接把程式的錯誤訊息丟給學生；完整訊息寫在 console，並給一個錯誤編號方便回報給老師
function errorKind(err) {
  const m = String((err && err.message) || err || '');
  if (!navigator.onLine || /Failed to fetch|NetworkError|Load failed|dynamically imported|network|timeout|逾時/i.test(m)) return 'network';
  if (/老師還沒有|找不到|沒有開放|題目/.test(m)) return 'content';
  return 'system';
}
function showError(err) {
  const kind = errorKind(err);
  const code = `B5-${Date.now().toString(36).slice(-4).toUpperCase()}`;
  console.error(`[${code}]`, err);
  const box = {
    network: ['網路好像不太穩', '無法取得最新資料，請確認網路後再試一次。', true],
    content: ['這個單元目前無法使用', '老師可能還在準備題目，稍後再試，或先做其他單元。', false],
    system: ['發生了一點問題', `請重新整理再試一次；如果一直這樣，把錯誤編號告訴老師：<b>${code}</b>`, true],
  }[kind];
  app.innerHTML = `<div class="empty"><div class="big bad">${icon.alertCircle}</div><h2>${box[0]}</h2><p>${box[1]}</p>
    <div class="btn-row center">${box[2] ? `<button class="btn primary" type="button" data-retry>${icon.redo} 重新載入</button>` : ''}<a class="btn" href="#/">回所有單元</a></div></div>`;
  const retry = app.querySelector('[data-retry]');
  if (retry) retry.onclick = () => location.reload();
}

/* ---------------- home ---------------- */
// 課本冊數對應年級：B1～B2 高一、B3～B4 高二、B5～B6 高三
function gradeOf(book) {
  const n = Number((/(\d+)/.exec(book) || [])[1]);
  return n >= 1 && n <= 2 ? '高一' : n >= 3 && n <= 4 ? '高二' : n >= 5 && n <= 6 ? '高三' : '';
}
function renderHome() {
  document.title = 'B5 Practice';
  const s = store.student();
  app.innerHTML = `
    <section class="hero">
      <div class="eyebrow">${esc(gradeOf(index.book || 'Book 5'))}英文 · ${esc(index.book || 'Book 5')}</div>
      <h1>B5 Practice</h1>
      <p>單字片語連續挑戰基礎、進階、精熟三段，讀完課文再做閱讀測驗。</p>
      ${s ? `<p class="hello">${esc(s.name)}，今天從哪一課開始？</p>` : ''}
    </section>
    <div id="welcome-slot"></div>
    <div id="progress-slot"></div>
    <div id="lessons"></div>`;

  // 還沒確認身分：只顯示基本資料表單，確認後才載入單元與這位學生的紀錄
  if (!s) {
    mountInlineForm(app.querySelector('#welcome-slot'), {
      title: '輸入你的基本資料',
      desc: '填寫班級、座號和姓名，要跟老師的名單一致。確認後會載入你之前的測驗紀錄。',
      button: '確認',
      onSave: () => { syncNav(); renderHome(); },
    });
    return;
  }

  const visible = visibleUnits();
  const lessons = [...new Set(visible.map((u) => u.lesson))].sort((a, b) => a - b);
  const host = app.querySelector('#lessons');
  if (!visible.length) {
    host.innerHTML = `<div class="empty"><div class="big">${icon.inbox}</div><p>老師目前沒有開放任何單元。</p></div>`;
    return;
  }
  // 進度摘要：一眼看到目前完成幾個單元、有沒有待檢討或缺交（點進去看詳細）
  const st = visible.map((u) => unitStatus(u).k);
  const nOk = st.filter((k) => k === 'ok').length;
  const nTodo = st.filter((k) => k === 'todo').length;
  const nMiss = st.filter((k) => k === 'miss').length;
  app.querySelector('#progress-slot').innerHTML = `<a class="home-prog" href="#/me">
      <span class="hp-top"><b>我的進度</b><span>已完成 ${nOk} / ${visible.length}</span></span>
      <span class="bar"><span style="width:${Math.round((nOk / visible.length) * 100)}%"></span></span>
      <span class="hp-sub">${nMiss ? `<em class="miss">缺交 ${nMiss}</em>` : ''}${nTodo ? `<em class="todo">待檢討 ${nTodo}</em>` : ''}${!nMiss && !nTodo ? '<em>目前沒有缺交或待檢討</em>' : ''}<span class="go">查看詳細 ${icon.arrowR}</span></span>
    </a>`;
  host.innerHTML = lessons.map((n) => {
    const units = visible.filter((u) => u.lesson === n);
    return `<section class="lesson">
      <h2 class="lesson-head"><span class="lnum">L${n}</span><span>Lesson ${n}</span></h2>
      <div class="unit-grid">${units.map(tileHTML).join('')}</div>
    </section>`;
  }).join('');
}

function pillHTML(label, b) {
  const cls = b == null ? '' : b >= PASS ? 'pass' : 'tried';
  return `<span class="lv-pill ${cls}">${b != null && b >= PASS ? icon.check : ''}${label}${b != null ? ` ${b}%` : ''}</span>`;
}

// 開放時段標籤：還沒開放、快截止、已截止
function windowBadge(id, done) {
  const w = unitWindow(config, id);
  if (w.state === 'before') return `<span class="badge time">${icon.lock} ${fmtWhen(w.openAt)} 開放</span>`;
  if (w.state === 'after') return done ? '' : `<span class="badge time off">已截止</span>`;
  return w.closeAt ? `<span class="badge time">${icon.clock} ${w.extended ? '補作到' : '截止'} ${fmtWhen(w.closeAt)}</span>` : '';
}

function tileMeta(u, stages) {
  if (u.type === 'vocab') return `${u.count} 個單字與片語 · ${stages}`;
  if (u.type === 'pattern') return `${u.count} 題 · 選擇、填空、應用`;
  if (u.type === 'exam') return `${u.count} 題 · 詞彙、拼寫、克漏字、文意選填、篇章結構、閱讀`;
  return `一篇文章 · ${u.count} 題閱讀測驗`;
}

function tileHTML(u) {
  const best = store.best(u.id);
  const vocab = u.type === 'vocab';
  let status;
  if (vocab) {
    const last = store.last(u.id);
    status = best.vocab == null ? '<span class="lv-pill">尚未測驗</span>'
      : `${pillHTML('最佳', best.vocab)}${last ? openLevels(u).filter((l) => last[l.id] != null).map((l) => `<span class="lv-pill mini">${l.name} ${last[l.id]}%</span>`).join('') : ''}`;
  } else {
    const b = best[bestKey(u.type)];
    status = b == null ? '<span class="lv-pill">尚未作答</span>' : pillHTML('最佳', b);
  }
  const stages = openLevels(u).map((l) => l.name).join(' → ');
  const done = store.done(u.id);
  return `<a data-id="${esc(u.id)}" class="unit-tile ${vocab ? 't-vocab' : 't-reading'} ty-${typeOf(u.type)}" href="#/u/${esc(u.id)}">
      <div class="tile-top">
        <span class="tile-icon">${typeIcon(u.type)}</span>
        <span class="tile-kind">${TYPES[typeOf(u.type)].tile}</span>
        ${done && !store.reviewed(u.id) ? `<span class="badge todo">${icon.bulb} 待檢討</span>` : ''}
        ${done && store.reviewed(u.id) ? `<span class="badge done">${icon.check} 已完成 · 可複習</span>` : ''}
        ${windowBadge(u.id, done)}
      </div>
      <h3 class="en">${esc(u.topic || u.title)}</h3>
      <div class="tile-meta">${tileMeta(u, stages)}</div>
      <div class="lv-row">${status}</div>
    </a>`;
}

/* ---------------- unit ---------------- */
// 轉場用的單元標題外框（資料載入前先顯示，版面和正式標題一致）
function unitShellHTML(meta) {
  return `<div class="unit-head shell" style="view-transition-name:unit-card">
      <a class="back" href="#/">${icon.back} 所有單元</a>
      <div class="eyebrow">Lesson ${meta.lesson} · ${TYPES[typeOf(meta.type)].tile}</div>
      <h1>${esc(meta.title)}</h1>
    </div><div class="loading"><span class="spinner"></span>載入中…</div>`;
}

function headHTML(meta, data) {
  const vocab = meta.type === 'vocab';
  const words = data.words || [];
  const phrases = words.filter((w) => w.type === 'phrase').length;
  const sub = vocab ? `單字 ${words.length - phrases} 個 · 片語 ${phrases} 個`
    : meta.type === 'pattern' ? `${(data.items || []).length} 題句型練習`
    : meta.type === 'exam' ? `${meta.count || ''} 題段考複習`.trim()
    : `${(data.questions || []).length} 題閱讀測驗`;
  return `<div class="unit-head">
      <a class="back" href="#/">${icon.back} 所有單元</a>
      <div class="eyebrow">Lesson ${meta.lesson} · ${TYPES[typeOf(meta.type)].tile}</div>
      <h1>${esc(meta.title)}</h1>
      <div class="sub"><span class="en">${esc(meta.topic || '')}</span><span>${sub}</span></div>
    </div>`;
}

function locked() {
  app.innerHTML = `<div class="empty"><div class="big">${icon.lock}</div><p>老師目前沒有開放這個單元。</p><a class="btn" href="#/">回首頁</a></div>`;
}

async function renderUnit(id, sub) {
  const meta = findUnit(id);
  if (!meta || !unitVisible(config, meta.id)) {
    app.innerHTML = `<div class="empty"><div class="big">${icon.lock}</div><p>找不到這個單元，或老師目前沒有開放。</p><a class="btn" href="#/">回首頁</a></div>`;
    return;
  }
  if (meta.id !== id) { location.replace(`#/u/${meta.id}${sub ? `/${sub}` : ''}`); return; }

  if (!app.querySelector('.unit-head.shell')) app.innerHTML = '<div class="loading"><span class="spinner"></span>載入中…</div>';
  // 剛登入時紀錄還在背景載入：等它載完（最多幾秒），才不會把做過的單元當成沒做過
  const [data, mod] = await Promise.all([loadUnit(meta.id, config), modes[typeOf(meta.type)](), historyReady()]);

  if (meta.type !== 'vocab') {
    if (!modeOn(config, meta.id, meta.type)) { locked(); return; }
    document.title = `${meta.title} — B5 Practice`;
    app.innerHTML = meta.type === 'pattern'
      ? `<div class="focus">${headHTML(meta, data)}<section id="stage"></section></div>`
      : `${headHTML(meta, data)}<section id="stage"></section>`;
    cleanup = mod.mount(app.querySelector('#stage'), { unit: meta, data, config, questionCount: questionCount(config, meta.id) }) || null;
    return;
  }

  const levels = openLevels(meta);
  if (!levels.length) { locked(); return; }
  // 舊網址（#/u/l1-voc/basic 等）一律導回單元頁
  if (sub) { location.replace(`#/u/${meta.id}`); return; }
  document.title = `${meta.title} — B5 Practice`;
  app.innerHTML = `<div class="focus">${headHTML(meta, data)}<section id="stage"></section></div>`;
  cleanup = mod.mount(app.querySelector('#stage'), {
    unit: meta, data, allWords: data.words || [], config, levels,
    questionCount: questionCount(config, meta.id),
  }) || null;
}

/* ---------------- 我的成績與缺交 ---------------- */
// 每個開放中的單元一列：已完成（最佳成績）、待檢討、缺交（已截止沒做）、進行中、尚未開放
function unitStatus(u) {
  const done = store.done(u.id);
  const best = store.best(u.id)[bestKey(u.type)];
  const w = unitWindow(config, u.id);
  if (done && store.reviewed(u.id)) return { k: 'ok', rank: 4, st: best != null ? `${best}%` : '已完成', note: best != null ? '已完成・可複習' : '已完成', ic: icon.check };
  if (done) return { k: 'todo', rank: 1, st: '待檢討', note: `${best != null ? `最佳 ${best}%・` : ''}做完檢討才能複習`, ic: icon.bulb };
  if (w.state === 'after') return { k: 'miss', rank: 0, st: '缺交', note: `已於 ${fmtWhen(w.closeAt)} 截止，還沒有正式測驗紀錄`, ic: icon.alert };
  if (w.state === 'before') return { k: 'wait', rank: 5, st: '未開放', note: `${fmtWhen(w.openAt)} 開放`, ic: icon.lock };
  return { k: 'open', rank: 2, st: '待完成', note: w.closeAt ? `${w.extended ? '補作到' : '截止'} ${fmtWhen(w.closeAt)}` : '尚未測驗', ic: icon.play };
}

async function renderMe() {
  const s = store.student();
  if (!s) { location.replace('#/'); return; }
  document.title = '我的成績 — B5 Practice';
  app.innerHTML = '<div class="loading"><span class="spinner"></span>載入你的紀錄…</div>';
  await historyReady();
  const rows = visibleUnits().map((u) => ({ u, ...unitStatus(u) })).sort((a, b) => a.rank - b.rank || a.u.lesson - b.u.lesson);
  const count = (k) => rows.filter((r) => r.k === k).length;
  const masked = s.name.length >= 2 ? `${s.name[0]}〇${s.name.slice(2)}` : s.name;
  app.innerHTML = `
    <a class="back" href="#/">${icon.back} 所有單元</a>
    <section class="me-head">
      <div class="eyebrow">My records</div>
      <h1>${esc(masked)} 的成績</h1>
      <p class="muted" style="margin:0">${esc(s.cls)} 班 ${esc(s.seat)} 號</p>
    </section>
    <div class="me-sum">
      <div class="sum"><b>${count('ok')} / ${rows.length}</b><span>已完成</span></div>
      <div class="sum todo"><b>${count('todo')}</b><span>待檢討</span></div>
      <div class="sum miss"><b>${count('miss')}</b><span>缺交</span></div>
    </div>
    ${rows.length ? `<div class="me-list">${rows.map((r) => `<a class="me-row ${r.k}" href="#/u/${esc(r.u.id)}">
        <span class="ic-box">${r.ic}</span>
        <span class="txt"><b>L${r.u.lesson} ${esc(r.u.topic || r.u.title)}</b><span>${typeLabel(r.u.type)}・${esc(r.note)}</span></span>
        <span class="st">${esc(r.st)}</span></a>`).join('')}</div>`
      : `<div class="empty"><div class="big">${icon.inbox}</div><p>老師目前沒有開放任何單元。</p></div>`}
    <p class="me-note">缺交是指：單元有截止時間、已經過了，而且沒有正式測驗紀錄。缺交的單元如果需要補作，請找老師。</p>`;
}

/* ---------------- footer ---------------- */
function renderFooter() {
  // 老師入口不放在學生畫面上，避免誤觸；老師直接開 #/teacher（存成書籤）
  document.getElementById('site-foot').innerHTML = '<span>B5 Practice · 內湖高中英文科</span><a href="#/privacy">隱私權說明</a>';
}

/* ---------------- 連線測試（#/diag） ---------------- */
// 手機看不到開發者工具：這頁實際測試送資料給 Apps Script 的每一步，結果直接顯示在畫面上
function renderDiag() {
  document.title = '連線測試 — B5 Practice';
  const row = (label) => `<li data-t="${label}"><b>${label}</b><span class="muted">等待中…</span></li>`;
  app.innerHTML = `<section class="card diag">
      <div class="eyebrow">Diagnostics</div><h2>連線測試</h2>
      <p class="muted">把這一頁截圖給老師，可以看出成績送不出去卡在哪裡。</p>
      <ul class="diag-list">${['讀取設定（GET）', '送出測試（POST）'].map(row).join('')}</ul>
      <h3>這台裝置排隊中的成績</h3><div data-box></div>
      <div class="btn-row"><button class="btn primary" type="button" data-flush>立即重送</button><button class="btn ghost" type="button" data-clear>清除排隊</button><button class="btn ghost" type="button" data-again>重新測試</button></div>
      <p class="muted diag-ua"></p>
    </section>`;
  const set = (label, ok, text) => {
    const li = app.querySelector(`[data-t="${label}"] span`);
    if (li) { li.textContent = text; li.className = ok ? 'ok' : 'bad'; }
  };
  const box = () => {
    const items = pendingItems();
    app.querySelector('[data-box]').innerHTML = items.length
      ? `<ul class="diag-list">${items.map((x) => `<li><b>${esc(x.unitTitle || x.unit || '?')}</b><span class="muted">${esc(x.clientTs || '')}${x.name ? '' : '（資料不完整）'}</span></li>`).join('')}</ul>`
      : '<p class="muted">沒有排隊中的成績</p>';
  };
  const timed = async (label, fn) => {
    const t0 = performance.now();
    try {
      const r = await fn();
      const text = await r.text();
      const ms = Math.round(performance.now() - t0);
      let ok = false; try { ok = !!JSON.parse(text).ok; } catch { ok = false; }
      set(label, ok, ok ? `✓ 正常（${ms} ms）` : `✗ HTTP ${r.status}，回應不是資料：${text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 80)}`);
    } catch (e) {
      set(label, false, `✗ 連線失敗：${e.name} ${e.message}`);
    }
  };
  const run = async () => {
    app.querySelectorAll('.diag-list li span').forEach((s) => { s.textContent = '測試中…'; s.className = 'muted'; });
    await timed('讀取設定（GET）', () => fetch(`${SCRIPT_URL}?action=ping&t=${Date.now()}`, { cache: 'no-store', credentials: 'omit' }));
    await timed('送出測試（POST）', () => fetch(SCRIPT_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ api: 'ping' }), credentials: 'omit', cache: 'no-store' }));
    box();
  };
  app.querySelector('.diag-ua').textContent = navigator.userAgent;
  app.querySelector('[data-again]').onclick = run;
  app.querySelector('[data-flush]').onclick = async () => { await flushOutbox(); box(); };
  app.querySelector('[data-clear]').onclick = () => { if (confirm('確定要清除這台裝置排隊中的成績嗎？清除後這些成績不會送到老師的試算表（學生網站上的紀錄不受影響）。')) { clearOutbox(); box(); } };
  run();
}

/* ---------------- privacy ---------------- */
function renderPrivacy() {
  document.title = '隱私權說明 — B5 Practice';
  app.innerHTML = `
    <section class="card">
      <div class="eyebrow">Privacy</div><h2>隱私權說明</h2>
      <div class="privacy-body">
        <h3>會收集哪些資料</h3>
        <p>登入時填寫的班級、座號、姓名，以及每次測驗的作答內容、分數與時間。不需要密碼，也不會收集電話、Email、地址等其他個人資料。</p>
        <h3>用來做什麼</h3>
        <p>確認身分、記錄學習進度（例如哪些單元已完成、需要複習），以及讓授課老師掌握全班學習狀況、進行成績登記。</p>
        <h3>誰看得到</h3>
        <p>只有授課老師（用學校核可的 Google 帳號登入後台）看得到全班資料；學生只看得到自己的紀錄。資料存放在 Google Firebase／Google 試算表，由授課老師管理，不會公開或提供給第三方作其他用途。</p>
        <h3>保存多久</h3>
        <p>學期間持續保存供教學使用；學期結束後由老師決定是否清除（可整學期清除，或針對個別學生清除）。</p>
        <h3>想刪除資料怎麼辦</h3>
        <p>請直接向授課老師提出，老師可以在後台刪除個別學生或整學期的資料。</p>
      </div>
      <div class="btn-row"><a class="btn" href="#/">${icon.back} 回首頁</a></div>
    </section>`;
}

/* ---------------- teacher ---------------- */
// 老師用 Google 帳號登入；Firestore 的 admins 名單內才顯示後台連結與名單匯入。
// 真正的權限由 Firestore 規則與 Apps Script 後台的帳號檢查把關，這裡只負責顯示。
function renderTeacher() {
  document.title = '老師登入 — B5 Practice';
  app.innerHTML = '<div class="loading"><span class="spinner"></span>確認登入狀態…</div>';
  let unsub = null;
  let left = false;
  cleanup = () => { left = true; if (unsub) unsub(); };
  firebase().then((fb) => {
    if (left) return;
    const { watchStaff, staffSignIn, staffSignOut } = fb;
    fb.authKit(); // 事先載入好登入元件，按下登入按鈕時瀏覽器才不會擋掉彈出視窗
    unsub = watchStaff((staff) => {
    if (!staff) {
      app.innerHTML = `<section class="card teacher">
          <div class="eyebrow">Teacher</div><h2>老師登入</h2>
          <p class="muted">請用老師名單內的 Google 帳號登入。</p>
          <div class="btn-row"><button class="btn primary" type="button" data-in>${icon.user} 用 Google 帳號登入</button></div>
          <p class="form-err" aria-live="polite"></p></section>`;
      app.querySelector('[data-in]').onclick = () => staffSignIn().catch((e) => { app.querySelector('.form-err').textContent = `登入失敗：${e.message}`; });
      return;
    }
    if (!staff.role) {
      app.innerHTML = `<section class="card teacher">
          <div class="eyebrow">Teacher</div><h2>沒有權限</h2>
          <p class="muted">${esc(staff.email)} 不在老師名單中，請聯絡管理員。</p>
          ${staff.reason ? `<p class="muted" style="font-size:.8rem">原因：${esc(staff.reason)}</p>` : ''}
          <div class="btn-row"><button class="btn ghost" type="button" data-out>登出</button></div></section>`;
      app.querySelector('[data-out]').onclick = () => staffSignOut();
      return;
    }
    app.innerHTML = `<section class="card teacher">
        <div class="eyebrow">${staff.role === 'admin' ? '管理員' : '老師'}</div>
        <h2>${esc(staff.email)}</h2>
        <p class="muted">單元設定、匯入內容與 AI 出題、學生名單、成績、學期結算都在老師後台。建議用電腦開啟，版面比較寬。</p>
        <div class="btn-row">
          <a class="btn primary" href="admin.html">進入老師後台 ${icon.arrowR}</a>
          <button class="btn ghost" type="button" data-out>登出</button>
        </div>
      </section>`;
    app.querySelector('[data-out]').onclick = () => staffSignOut();
    });
  }).catch((e) => {
    app.innerHTML = `<div class="empty"><div class="big bad">${icon.alertCircle}</div><p>無法載入登入元件（${esc(e.message)}），請確認網路後重新整理。</p></div>`;
  });
}

// 首頁即時更新：被隱藏的單元先淡出縮小，新開放的單元淡入
function animateHome() {
  const tiles = [...app.querySelectorAll('.unit-tile[data-id]')];
  const before = new Set(tiles.map((t) => t.dataset.id));
  const after = new Set(visibleUnits().map((u) => u.id));
  const leaving = tiles.filter((t) => !after.has(t.dataset.id));
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const redraw = () => {
    const y = window.scrollY;
    route();
    window.scrollTo(0, y); // 即時更新不要跳回頂端
    if (!before.size) return;
    app.querySelectorAll('.unit-tile[data-id]').forEach((t) => {
      if (!before.has(t.dataset.id)) t.classList.add('tile-in');
    });
  };
  if (!leaving.length || reduce) { redraw(); return; }
  leaving.forEach((t) => t.classList.add('tile-out'));
  setTimeout(redraw, 240);
}

/* ---------------- 右下角通知 ---------------- */
function notify(text, kind = 'ok') {
  let box = document.getElementById('notify');
  if (!box) {
    box = document.createElement('div');
    box.id = 'notify';
    box.setAttribute('role', 'status');
    box.setAttribute('aria-live', 'polite');
    document.body.append(box);
  }
  const n = document.createElement('div');
  n.className = `notify-item ${kind}`;
  n.innerHTML = `${kind === 'ok' ? icon.check : icon.clock}<span>${esc(text)}</span>`;
  box.append(n);
  setTimeout(() => { n.classList.add('out'); setTimeout(() => n.remove(), 400); }, kind === 'ok' ? 6000 : 5000);
}

/* ---------------- boot ---------------- */
async function boot() {
  // 舊版只存在裝置上、沒有跟老師名單確認過的學生資料：要求重新登入
  const saved = store.student();
  if (saved && !saved.key) { store.setStudent(null); store.resetProgress(); }
  renderStudentChip();
  renderFooter();
  let base;
  const build = () => {
    index = structuredClone(base);
    addCustomUnits(index, config);
    applyImported(index, config);
    initNav(visibleUnits());
    const kind = location.hash.split('/')[1] || '';
    document.getElementById('nav-menu').hidden = kind === 'teacher' || !store.student() || !visibleUnits().length;
    const since = {};
    Object.entries((config && config.units) || {}).forEach(([id, u]) => { const t = Date.parse(u.since); if (t) since[id] = t; });
    store.setSince(since);
  };
  try {
    // 還沒登入的人只看得到登入表單，不需要老師的設定：不等它（第一次來訪、沒有暫存時可能要等 1～2 秒），先把畫面畫出來，
    // 設定到了再用 config-updated 更新。登入過的人照舊先取得設定，才知道要顯示哪些單元。
    base = await loadIndex();
    const cfgP = getConfig();
    if (store.student()) {
      config = await cfgP;
    } else {
      config = await Promise.race([cfgP, Promise.resolve(null)]) || { units: {}, source: 'pending' };
      if (config.source === 'pending') cfgP.then((c) => window.dispatchEvent(new CustomEvent('config-updated', { detail: c }))).catch(() => {});
    }
    build();
  } catch (err) {
    showError(err);
    return;
  }
  // 先用上次存下的設定畫出畫面；背景抓到老師的新設定後再重畫（測驗進行中不打斷）
  window.addEventListener('config-updated', (e) => {
    const prevSince = JSON.stringify(Object.entries(config.units || {}).map(([k, u]) => [k, u.since]));
    config = e.detail;
    build();
    // 老師刪掉單元又用同代號重建：重新讀一次紀錄，舊的完成／檢討標記不再算數
    const s = store.student();
    if (s && s.key && prevSince !== JSON.stringify(Object.entries(config.units || {}).map(([k, u]) => [k, u.since]))) {
      firebase().then((fb) => fb.loadHistory(s.key)).then((h) => {
        store.applyHistory(h.attempts, h.reviews);
        if (!document.body.dataset.busy && (location.hash.split('/')[1] || '') !== 'teacher') route();
      }).catch(() => {});
    }
    // 作答中不打斷（交卷後換頁就會用新設定）；老師頁不需要重畫
    const kind = location.hash.split('/')[1] || '';
    if (kind === 'teacher' || document.body.dataset.busy) return;
    if (kind) { route(); return; }
    animateHome();
  });
  watchConfig(config);
  // 等頁面載完、畫面穩定之後才在背景預先下載測驗畫面的程式（不跟首頁搶頻寬）
  const afterLoad = (fn) => (document.readyState === 'complete' ? setTimeout(fn, 600) : window.addEventListener('load', () => setTimeout(fn, 600), { once: true }));
  afterLoad(() => idle(() => { modes.vocab().catch(() => {}); modes.reading().catch(() => {}); modes.pattern().catch(() => {}); modes.exam().catch(() => {}); }));
  // 之前沒送成功的成績：開站時與恢復連線時自動補送
  flushOutbox();
  window.addEventListener('online', () => flushOutbox());
  // 往下捲動時收起左上角 B5（選單按鈕平移補位）。導覽列高度不變，所以切換狀態不會改變頁面高度、不會互相觸發。
  // 用 requestAnimationFrame 節流、加上緩衝區（>64px 收起、<24px 展開）與最短間隔，iPhone 快速滑動時不會來回閃動。
  const brandEl = document.querySelector('.brand');
  const measureBrand = () => {
    const gap = parseFloat(getComputedStyle(brandEl.parentElement).columnGap) || 12;
    document.documentElement.style.setProperty('--brand-shift', `${Math.round(brandEl.offsetWidth - 8 + gap)}px`);
  };
  requestAnimationFrame(measureBrand); // 畫面畫完再量，避免載入時強制重排
  window.addEventListener('resize', measureBrand, { passive: true });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(measureBrand).catch(() => {});
  let scrolled = false;
  let ticking = false;
  let lastFlip = 0;
  let trailing = 0;
  const flip = (on) => { scrolled = on; lastFlip = performance.now(); document.body.classList.toggle('scrolled', on); };
  const evaluate = () => {
    ticking = false;
    const y = Math.max(0, window.scrollY);
    if (document.body.classList.contains('exam')) return; // 考試中導覽列固定不變
    const want = scrolled ? y >= 24 : y > 64;
    if (want === scrolled) return;
    const wait = 160 - (performance.now() - lastFlip);
    if (wait > 0) { clearTimeout(trailing); trailing = setTimeout(evaluate, wait + 10); return; } // 動畫還在進行：等一下再判斷，不要中途反覆切換
    flip(want);
  };
  const onScroll = () => { if (!ticking) { ticking = true; requestAnimationFrame(evaluate); } };
  window.addEventListener('scroll', onScroll, { passive: true });
  evaluate();

  // 考試中的導覽列：B5、已作答時間、目前單元（單元選單與名牌在考試中不能用，位置讓出來）
  const examTimer = document.getElementById('exam-timer');
  const examUnit = document.getElementById('exam-unit');
  let examT0 = 0;
  let examTick = 0;
  const paintTimer = () => {
    const sec = Math.max(0, Math.floor((Date.now() - examT0) / 1000));
    const h = Math.floor(sec / 3600);
    const m = String(Math.floor((sec % 3600) / 60)).padStart(h ? 2 : 1, '0');
    examTimer.textContent = `${h ? `${h}:` : ''}${m}:${String(sec % 60).padStart(2, '0')}`;
  };
  const setExam = (on) => {
    if (on === document.body.classList.contains('exam')) return;
    document.body.classList.toggle('exam', on);
    clearInterval(examTick);
    if (on) {
      flip(false); // 考試中導覽列維持完整狀態
      const u = findUnit(decodeURIComponent(location.hash.split('/')[2] || ''));
      examUnit.textContent = u ? `L${u.lesson} ${typeLabel(u.type)}` : '';
      examT0 = Date.now();
      paintTimer();
      examTick = setInterval(paintTimer, 1000);
    } else {
      evaluate();
    }
  };
  new MutationObserver(() => setExam(!!document.body.dataset.busy)).observe(document.body, { attributes: true, attributeFilter: ['data-busy'] });
  // 成績排隊／排到送出時，在畫面右下角通知
  window.addEventListener('score-queued', (e) => notify(`${e.detail.unitTitle || e.detail.unit} 成績已加入排隊，稍後自動送出`, 'wait'));
  window.addEventListener('score-sent', (e) => notify(`${e.detail.unitTitle || e.detail.unit} ${String(e.detail.clientTs || '').slice(11, 16)} 已送出成績`, 'ok'));
  // 考試鎖定：作答中點任何站內連結（左上 B5、所有單元…）或按上一頁，都先確認，避免不小心中斷
  let curHash = location.hash;
  let reverting = false;
  const leaveOk = () => confirmDialog({
    title: '要離開這次測驗嗎？',
    body: '測驗還沒完成，離開後這次的作答不會保存，也不會送出成績。',
    ok: '離開', cancel: '繼續作答',
  });
  document.addEventListener('click', async (e) => {
    const a = e.target.closest && e.target.closest('a[href^="#"]');
    if (!a || !document.body.dataset.busy || a.closest('#unit-menu')) return;
    if (a.getAttribute('href') === location.hash) return;
    e.preventDefault();
    if (await leaveOk()) { delete document.body.dataset.busy; location.hash = a.getAttribute('href'); }
  }, true);
  window.addEventListener('hashchange', async () => {
    if (reverting) { reverting = false; return; }
    if (document.body.dataset.busy) {
      // 上一頁／手勢返回：先退回原頁，確認後才真的離開
      const target = location.hash;
      reverting = true;
      history.replaceState(null, '', curHash || '#/');
      reverting = false;
      if (!(await leaveOk())) return;
      delete document.body.dataset.busy;
      location.hash = target;
      return;
    }
    curHash = location.hash;
    route();
  });
  window.addEventListener('student-changed', () => { if (!document.body.dataset.busy) route(); });
  // 登入後在背景載入的紀錄到了：首頁的完成狀態、最佳成績跟著更新（不打斷作答）
  window.addEventListener('history-applied', () => { if (!document.body.dataset.busy && ['', 'me'].includes(location.hash.split('/')[1] || '')) route(); });
  route();
  // 以 Firestore 為準：每次進站重新讀取紀錄（例如在別台裝置做過的測驗）
  const s = store.student();
  if (s && s.key) {
    firebase().then((fb) => fb.loadHistory(s.key)).then((h) => {
      store.applyHistory(h.attempts, h.reviews);
      // 作答中不打斷（交卷後換頁就會用新設定）；老師頁不需要重畫
    const kind = location.hash.split('/')[1] || '';
    if (kind !== 'teacher' && !document.body.dataset.busy) route();
    }).catch(() => { /* 離線時沿用裝置上的紀錄 */ });
  }
}

boot();
