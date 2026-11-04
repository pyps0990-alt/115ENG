import { loadIndex, loadUnit, applyImported, addCustomUnits, loadAnalysis, analysisSig } from './data.js';
import { getConfig, watchConfig, unitVisible, modeOn, questionCount, unitWindow, fmtWhen, unitCfg, assignmentsFor, dueLabel } from './remote-config.js';
import { store } from './storage.js';
import { esc, confirmDialog } from './util.js';
import { icon } from './icons.js';
import { mountInlineForm, historyReady, maskName, accountHTML, bindAccount } from './student.js';
import { LEVELS, PASS, levelsFor, quizCount } from './levels.js';
import { flushOutbox, pendingItems, clearOutbox, outboxStatus, rejectedItems } from './submit.js';
import { submitStateHTML } from './components/gate.js';
import { leaveBody } from './resume.js';
import * as integrity from './integrity.js';
import { learnPrefs } from './learn-prefs.js';
import { SCRIPT_URL, CJK_WEBFONT } from './config.js';
import { TYPES, typeOf, typeLabel, typeIcon, bestKey, lessonLabel, lessonHeading, lessonCmp, unitName } from './types.js';
// Firebase 程式庫很大，只在需要時才載入（登入、讀紀錄、老師頁面），不拖慢首頁
const firebase = () => import('./firebase.js');

// 測驗畫面的程式（單字、課文）要打開單元才用得到：首頁不載入，閒置時先在背景抓好
const modes = {
  vocab: () => import('./modes/vocab.js'),
  reading: () => import('./modes/reading.js'),
  pattern: () => import('./modes/pattern.js'),
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
function pageIn(changed, first) {
  // 第一次畫面不做進場動畫：從透明開始會讓「最大內容繪製」延後；也不用強制重排，改在下一格重新加上動畫
  if (!changed || first || reduceMotion.matches) return;
  app.classList.remove('page-in');
  requestAnimationFrame(() => app.classList.add('page-in'));
}
app.addEventListener('animationend', (e) => { if (e.target === app) app.classList.remove('page-in'); });

// 等這一頁用到的字型載入完才顯示畫面，不會先出現系統字型、再跳成網站字型。
// 剛開啟網站時不等（開啟速度優先，Nunito 已預載）；之後每次換頁最多等 1.2 秒（字型多半已在快取）
async function settleFonts(maxMs = 1200) {
  void app.offsetHeight; // 先排版一次，瀏覽器才知道這頁要用哪些字型
  if (document.fonts && document.fonts.status === 'loading') {
    app.style.visibility = 'hidden';
    await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, maxMs))]);
    app.style.visibility = '';
  }
}

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
  document.getElementById('fx').replaceChildren();
  // 首頁不顯示「#/」，網址保持乾淨（replaceState 不會再觸發 hashchange）
  if (location.hash === '#/' || location.hash === '#') history.replaceState(null, '', location.pathname + location.search);
  const [, kind, id, sub] = location.hash.split('/').map(decodeURIComponent);
  lastKind = kind || '';
  // 還沒確認身分：單元網址一律導回首頁填資料（上方只有 B5，沒有選單與名牌；切換學生、登出在「我的成績」頁）
  const loggedIn = !!store.student();
  if (kind === 'u' && !loggedIn) { location.replace('#/'); return; }
  syncDock(loggedIn && (!kind || kind === 'me' || kind === 'account') ? (kind || 'home') : null);
  paintTopLeft(kind, loggedIn);
  if (kind === 'u' && id && changed && !(await assignGuard(id))) return;
  const render = async () => {
    try {
      if (kind === 'u' && id) await renderUnit(id, sub);
      else if (kind === 'teacher') renderTeacher();
      else if (kind === 'me') await renderMe();
      else if (kind === 'account') renderAccount();
      else if (kind === 'privacy') renderPrivacy();
      else if (kind === 'diag') renderDiag();
      else renderHome();
    } catch (err) {
      showError(err);
    }
  };
  // 換頁更連續：支援的瀏覽器用 View Transition（截下畫面上看到的舊畫面，和新畫面交叉淡化；導覽列與分頁列不參與、照常即時動畫）。
  // 新畫面最多等 0.15 秒（單元要下載題目時先換到載入中的畫面），不會讓畫面停住太久；不支援的瀏覽器照舊淡入
  const run = async () => { window.scrollTo(0, 0); await render(); };
  const useVT = changed && !first && !!document.startViewTransition && !reduceMotion.matches && document.visibilityState === 'visible';
  if (useVT) {
    let job = null;
    document.documentElement.dataset.nav = app.dataset.dir || 'fwd';
    const t = document.startViewTransition(() => { job = run(); return Promise.race([job, new Promise((r) => setTimeout(r, 150))]); });
    t.finished.catch(() => {}); t.ready.catch(() => {});
    await t.updateCallbackDone.catch(() => {});
    await (job || run());
  } else await run();
  reportView();
  if (!first) await settleFonts(); // 剛開啟網站不等字型、也不強制排版：開啟速度優先
  if (!useVT) pageIn(changed, first);
}

// 上方導覽列左邊：單元等內頁放「回首頁」；首頁、我的成績（最上層）放「搜尋單元」；還沒登入什麼都不放。B5 在右邊
function paintTopLeft(kind, loggedIn) {
  const box = document.getElementById('top-left');
  if (!box) return;
  const top = !kind || kind === 'me' || kind === 'account';
  if (top && !loggedIn) { box.innerHTML = ''; return; }
  if (top) {
    box.innerHTML = `<button class="top-btn" type="button" data-search aria-label="搜尋單元" title="搜尋單元">${icon.search}</button>`;
    box.querySelector('[data-search]').onclick = openSearch;
  } else {
    box.innerHTML = `<a class="top-btn top-back" href="#/" aria-label="回首頁">${icon.back}<span>首頁</span></a>`;
  }
}

// 搜尋單元：輸入課次、單元名稱、主題或題型（例如「L3」「單字」「閱讀」），點結果直接進入
function openSearch() {
  const d = document.createElement('dialog');
  d.className = 'search-sheet';
  d.setAttribute('aria-label', '搜尋單元');
  d.innerHTML = `<div class="ss-bar">${icon.search}<input type="search" placeholder="搜尋單元：課次、名稱、主題" aria-label="搜尋單元" enterkeyhint="search" autocomplete="off"><button class="ss-x" type="button" data-close>取消</button></div><div class="ss-list" role="list"></div>`;
  document.body.appendChild(d);
  const input = d.querySelector('input'), list = d.querySelector('.ss-list');
  const all = visibleUnits().map((u) => ({ u, s: unitStatus(u), key: [unitName(u), u.title, u.topic, lessonLabel(u.lesson), `L${u.lesson}`, typeLabel(u.type), TYPES[typeOf(u.type)].tile].join(' ').toLowerCase() }))
    .sort((a, b) => lessonCmp(a.u.lesson, b.u.lesson));
  const draw = () => {
    const q = input.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const hits = all.filter((x) => q.every((w) => x.key.includes(w)));
    list.innerHTML = hits.length ? hits.map((x) => `<a class="ss-row ${x.s.k}" role="listitem" href="#/u/${esc(x.u.id)}"><span class="ic-box">${typeIcon(x.u.type)}</span><span class="txt"><b>${esc(unitName(x.u))}</b><span>${esc([typeLabel(x.u.type), x.u.topic].filter(Boolean).join(' · '))}</span></span><span class="st">${esc(x.s.st)}</span></a>`).join('')
      : `<p class="ss-empty">找不到「${esc(input.value.trim())}」的單元</p>`;
  };
  const close = () => { d.close(); d.remove(); };
  input.addEventListener('input', draw);
  d.addEventListener('click', (e) => { if (e.target === d || e.target.closest('[data-close]')) close(); else if (e.target.closest('.ss-row')) close(); });
  d.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
  draw();
  d.showModal();
  input.focus();
}

// 底部浮動分頁列（單元、我的成績）：登入後的首頁與我的成績才出現，作答時不會擋到畫面
function syncDock(on) {
  const dock = document.getElementById('dock');
  if (!dock) return;
  const wasHidden = dock.hidden;
  dock.hidden = !on;
  document.body.classList.toggle('has-dock', !!on);
  dock.querySelectorAll('a').forEach((a) => {
    const cur = a.dataset.dock === on;
    if (cur) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  // 帳號分頁：學生的頭像（名字第一個字）
  const s = store.student(), acc = dock.querySelector('a[data-dock="account"]');
  if (s && acc) {
    acc.querySelector('.dock-av').textContent = (s.name || '?').trim().charAt(0);
    acc.setAttribute('aria-label', `帳號：${maskName(s.name)}`); acc.title = `帳號・${maskName(s.name)}`;
  }
  if (on) requestAnimationFrame(() => placeDockInk(wasHidden));
  initDockDrag(dock);
}
// 選取膠囊：滑到目前的分頁（標籤展開後寬度會變，所以等下一格再量）
// 位置交給 CSS（data-cur：第幾格），分頁列縮小／放大時膠囊會自己跟著，不用每一格重新量
function placeDockInk(instant) {
  const dock = document.getElementById('dock');
  const ink = dock && dock.querySelector('.dock-ink');
  const links = dock ? [...dock.querySelectorAll('a')] : [];
  const i = links.findIndex((a) => a.hasAttribute('aria-current'));
  if (!ink || i < 0) return;
  if (instant) ink.style.transition = 'none';
  dock.dataset.cur = String(i);
  ink.style.transform = '';
  if (instant) { void ink.offsetWidth; ink.style.transition = ''; }
}
// 拖動選取膠囊：左右拖到另一個分頁放開就切換；往上下拉或拖出兩端有橡皮筋（越拉越緊、有極限），放開彈回
let dockReady = false;
function initDockDrag(dock) {
  if (dockReady) return;
  dockReady = true;
  const ink = dock.querySelector('.dock-ink');
  const rubber = (d, lim) => { const a = Math.abs(d); return (d < 0 ? -1 : 1) * lim * (1 - 1 / (a * 0.55 / lim + 1)); };
  let pid = null; let sx = 0; let sy = 0; let x0 = 0; let w = 0; let k = 1; let dragging = false; let moved = false; // k：縮小時的比例（手指移動換算成分頁列裡的距離）
  const links = () => [...dock.querySelectorAll('a')];
  const finish = (e, cancel) => {
    if (pid === null) return;
    pid = null;
    dock.classList.remove('dragging');
    links().forEach((a) => a.classList.remove('over'));
    if (!dragging) return;
    dragging = false;
    const dx = Math.abs(e.clientX - sx); const dy = Math.abs(e.clientY - sy);
    const cx = x0 + (e.clientX - sx) / k + w / 2;
    let target = dock.querySelector('a[aria-current]');
    if (!cancel && !(dx < 24 && dy > dx)) {
      let best = Infinity;
      links().forEach((a) => { const d = Math.abs(a.offsetLeft + a.offsetWidth / 2 - cx); if (d < best) { best = d; target = a; } });
    }
    ink.style.transition = '';
    placeDockInk(false);
    if (target && !target.hasAttribute('aria-current')) location.hash = target.getAttribute('href');
    setTimeout(() => { moved = false; }, 350);
  };
  dock.addEventListener('pointerdown', (e) => {
    if (e.button > 0) return;
    const cur = dock.querySelector('a[aria-current]'); if (!cur) return;
    pid = e.pointerId; sx = e.clientX; sy = e.clientY; x0 = cur.offsetLeft; w = cur.offsetWidth; k = dock.getBoundingClientRect().width / dock.offsetWidth || 1; dragging = false; moved = false;
  });
  dock.addEventListener('pointermove', (e) => {
    if (pid !== e.pointerId) return;
    if (!dragging) {
      if (Math.hypot(e.clientX - sx, e.clientY - sy) < 6) return;
      dragging = true; moved = true;
      try { dock.setPointerCapture(pid); } catch { /* ignore */ }
      dock.classList.add('dragging');
      ink.style.transition = 'none';
    }
    e.preventDefault();
    const lo = 6; const hi = dock.clientWidth - w - 6; const fx = x0 + (e.clientX - sx) / k;
    const x = fx < lo ? lo + rubber(fx - lo, 18) : fx > hi ? hi + rubber(fx - hi, 18) : fx;
    const y = reduceMotion.matches ? 0 : rubber(e.clientY - sy, 10);
    ink.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) scale(1.06)`;
    const cx = x + w / 2;
    links().forEach((a) => a.classList.toggle('over', Math.abs(a.offsetLeft + a.offsetWidth / 2 - cx) < a.offsetWidth / 2));
  }, { passive: false });
  dock.addEventListener('pointerup', (e) => finish(e, false));
  dock.addEventListener('pointercancel', (e) => finish(e, true));
  // 只在膠囊列自己失去捕捉時才算中斷（手指按在連結上時，瀏覽器先把捕捉給連結，轉給膠囊列時連結也會發出這個事件）
  dock.addEventListener('lostpointercapture', (e) => { if (e.target === dock && pid === e.pointerId) finish({ clientX: sx, clientY: sy }, true); });
  dock.addEventListener('dragstart', (e) => e.preventDefault());
  dock.addEventListener('click', (e) => { if (moved) { moved = false; e.preventDefault(); e.stopPropagation(); } }, true);
  // 往下滑：分頁列縮小成只有圖示；往上滑或回到頂端：恢復
  let lastY = window.scrollY; let tick = false;
  window.addEventListener('scroll', () => {
    if (tick) return;
    tick = true;
    requestAnimationFrame(() => {
      tick = false;
      const y = window.scrollY; const dy = y - lastY;
      if (Math.abs(dy) < 6 && y > 60) return;
      lastY = y;
      dock.classList.toggle('mini', dy > 0 && y > 120);
    });
  }, { passive: true });
}

// 這個單元要考的段落：老師有設定出題方式就照設定，否則是預設三段（關掉的段落不考）
const openLevels = (u) => levelsFor(unitCfg(config, u.id));
// 還沒有題目的單元不給學生看（老師匯入內容後才出現）
const hasContent = (id) => !!(config && config.content && config.content[id]);
const visibleUnits = () => index.units.filter((u) => unitVisible(config, u.id) && hasContent(u.id)
  && (u.type === 'vocab' ? openLevels(u).length : modeOn(config, u.id, u.type)))
  .sort((a, b) => lessonCmp(a.lesson, b.lesson));

/* ---------------- 老師指派的作業 ---------------- */
// 這位學生（班級）還沒截止的指派作業；完成＝正式測驗已通過（待檢討、已完成）
const myAssign = () => {
  const s = store.student();
  if (!s || !index) return [];
  const vis = visibleUnits();
  return assignmentsFor(config, s.cls).map((a) => ({ ...a, u: vis.find((u) => u.id === a.unit) })).filter((a) => a.u);
};
const asgDone = (a) => ['ok', 'todo'].includes(unitStatus(a.u).k);
// 還有指派作業沒做完，卻點進別的單元：先問一次要做哪一個（只提醒、不擋；同一個單元這次開網頁只問一次）
async function assignGuard(id) {
  const target = findUnit(id);
  if (!target || !store.student()) return true;
  const pending = myAssign().filter((a) => !asgDone(a));
  if (!pending.length || pending.some((a) => a.unit === target.id) || !pending.some((a) => a.warn)) return true;
  const key = `b5p:asg-ok:${target.id}`;
  try { if (sessionStorage.getItem(key)) return true; } catch { /* ignore */ }
  const a = pending.find((x) => x.warn);
  const go = await confirmDialog({
    title: '要做的是這個嗎？',
    body: `老師指派的是 <b>${esc(unitName(a.u))}</b>（${esc(dueLabel(a.due))}），你點的是 <b>${esc(unitName(target))}</b>。`,
    ok: '去做指派的作業',
    cancel: `還是做 ${unitName(target)}`,
  });
  if (go) { location.hash = `#/u/${encodeURIComponent(a.unit)}`; return false; }
  try { sessionStorage.setItem(key, '1'); } catch { /* ignore */ }
  return true;
}

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
// 首頁畫好後，趁空檔把接下來要做的單元題目先下載存在裝置上（依老師更新時間存，沒改過就不再下載）：點進單元時不用等網路。
// 一次載入只做一次；省流量模式不做。
let prefetched = false;
function prefetchUnits(list) {
  if (prefetched || !list.length || (navigator.connection && navigator.connection.saveData)) return;
  prefetched = true;
  const run = () => list.reduce((p, u) => p.then(() => loadUnit(u.id, config).catch(() => {})), Promise.resolve());
  (window.requestIdleCallback || ((f) => setTimeout(f, 1500)))(run, { timeout: 4000 });
}

function renderHome() {
  document.title = 'B5 Practice';
  const s = store.student();
  // 在首頁登入成功時不會換頁：這裡也更新分頁列與左上角（搜尋），不用等下一次換頁才出現
  if (!(location.hash.split('/')[1] || '')) { syncDock(s ? 'home' : null); paintTopLeft('', !!s); }
  app.innerHTML = s
    ? `<section class="hero compact cover">
        <div class="cover-eyebrow">${esc(index.book || 'Book 5')} · ${esc(s.cls)} 班</div>
        <h1>${esc(maskName(s.name))}，今天從哪一課開始？</h1>
        <p id="progress-slot"></p>
      </section>
      <div id="next-slot"></div>
      <div id="lessons"></div>`
    : `<section class="hero cover">
        <div class="cover-eyebrow">${esc(gradeOf(index.book || 'Book 5'))} · ${esc(index.book || 'Book 5')}</div>
        <h1>B5 Practice</h1>
        <p>單字片語、課文理解、句型練習。總分達 ${PASS}% 就通過，沒通過可以一直補考。</p>
      </section>
      <div id="welcome-slot"></div>
      <div id="lessons"></div>`;

  // 還沒確認身分：只顯示基本資料表單，確認後才載入單元與這位學生的紀錄
  if (!s) {
    mountInlineForm(app.querySelector('#welcome-slot'), {
      title: '輸入你的基本資料',
      desc: '填寫班級、座號和姓名，要跟老師的名單一致。確認後會載入你之前的測驗紀錄。',
      button: '開始練習',
      onSave: () => renderHome(),
    });
    return;
  }

  const visible = visibleUnits();
  const lessons = [...new Set(visible.map((u) => u.lesson))].sort(lessonCmp);
  const host = app.querySelector('#lessons');
  if (!visible.length) {
    host.innerHTML = `<div class="empty"><div class="big">${icon.inbox}</div><h2>還沒有開放的單元</h2><p>老師開放後會出現在這裡，不用做任何設定。</p><button class="btn" type="button" data-refresh>${icon.redo} 重新整理</button></div>`;
    host.querySelector('[data-refresh]').onclick = () => location.reload();
    return;
  }
  // 進度摘要：一眼看到目前完成幾個單元、有沒有待檢討或缺交（點進去看詳細）
  const st = visible.map((u) => unitStatus(u).k);
  const nOk = st.filter((k) => k === 'ok').length;
  const nTodo = st.filter((k) => k === 'todo').length;
  const nMiss = st.filter((k) => k === 'miss').length;
  const order = { retake: 0, todo: 1, open: 2 };
  const upcoming = visible.map((u) => ({ u, ...unitStatus(u) })).filter((r) => r.k in order)
    .sort((a, b) => order[a.k] - order[b.k] || lessonCmp(a.u.lesson, b.u.lesson));
  const nextRow = upcoming[0];
  const asg = myAssign();
  const asgPending = asg.filter((a) => !asgDone(a));
  prefetchUnits([...asgPending.map((a) => a.u), ...upcoming.slice(0, 6).map((r) => r.u)]);
  if (asgPending.length) {
    // 老師指派的作業優先：主卡放還沒做完的指派作業（好幾份就左右滑）
    app.querySelector('#next-slot').innerHTML = `<div class="asg-rail${asgPending.length > 1 ? ' many' : ''}">${asgPending.map((a) => {
      const st = unitStatus(a.u);
      return `<a class="next-card asg ${st.k}" href="#/u/${esc(a.u.id)}">
        <span class="nc-ic">${icon.pin}</span>
        <span class="nc-txt"><span class="nc-lead">老師指派 · ${esc(dueLabel(a.due))}</span><b class="en">${esc(a.u.title)}</b><span class="nc-note">${lessonLabel(a.u.lesson)} · ${esc(st.note)}</span></span>
        <span class="nc-go">${icon.arrowR}</span>
      </a>`;
    }).join('')}</div>${asgPending.length > 1 ? `<p class="asg-hint">${asgPending.length} 份指派作業，左右滑動看下一份</p>` : ''}`;
  } else if (nextRow) {
    const lead = { retake: '需要補考', todo: '待檢討', open: '下一個單元' }[nextRow.k];
    app.querySelector('#next-slot').innerHTML = `<a class="next-card ${nextRow.k}" href="#/u/${esc(nextRow.u.id)}">
        <span class="nc-ic">${nextRow.ic}</span>
        <span class="nc-txt"><span class="nc-lead">${lead}</span><b class="en">${esc(nextRow.u.title)}</b><span class="nc-note">${lessonLabel(nextRow.u.lesson)} · ${esc(nextRow.note)}</span></span>
        <span class="nc-go">${icon.arrowR}</span>
      </a>`;
  }
  // 還沒有任何進度時不顯示「已完成 0 / N」，第一屏只留下一步要做什麼
  app.querySelector('#progress-slot').innerHTML = nOk || nTodo || nMiss
    ? `<a class="hp-link" href="#/me">已完成 ${nOk} / ${visible.length}${nTodo ? ` · 待檢討 ${nTodo}` : ''}${nMiss ? ` · 缺交 ${nMiss}` : ''} · 詳細 ${icon.arrowR}</a>` : '';
  // 指派作業只在最上面的主卡出現一次；下面的單元列表照課次排，指派的單元卡片上加一個小標籤（不再另外分一段，避免同一個單元出現兩次）
  const asgOf = new Map(asg.map((a) => [a.u.id, a]));
  const legendHTML = `<details class="legend"><summary>${icon.info}狀態說明</summary>
        <dl>
          <dt>需補考</dt><dd>總分還沒到 ${PASS}%。可以隨時重做，沒有次數限制。</dd>
          <dt>待檢討</dt><dd>已經通過，先逐題檢討，才能開始複習。</dd>
          <dt>缺交</dt><dd>單元已截止，還沒有正式測驗紀錄，請找老師。</dd>
        </dl>
      </details>`;
  host.innerHTML = `<div class="list-head">${legendHTML}</div>` + lessons.map((n) => {
    const units = visible.filter((u) => u.lesson === n);
    if (!units.length) return '';
    return `<section class="lesson">
      <h2 class="lesson-head">${icon.book}<span>${lessonHeading(n)}</span></h2>
      <div class="unit-grid">${units.map((u) => tileHTML(u, asgOf.get(u.id))).join('')}</div>
    </section>`;
  }).join('');
  try { localStorage.removeItem('b5p:filter'); } catch { /* ignore */ } // 「全部／現在要做的」篩選已拿掉（主卡與老師指派已經告訴學生先做什麼）
  // 狀態說明：浮在按鈕下方，點其他地方就收起
  const legend = host.querySelector('.legend');
  const closeLegend = (e) => { if (!legend.isConnected) { document.removeEventListener('click', closeLegend, true); return; } if (legend.open && !legend.contains(e.target)) legend.open = false; };
  document.addEventListener('click', closeLegend, true);
}

// 開放時段：放在卡片說明列的純文字（還沒開放、快截止、已截止）
function windowText(id, done) {
  const w = unitWindow(config, id);
  if (w.state === 'before') return `${fmtWhen(w.openAt)} 開放`;
  if (w.state === 'after') return done ? '' : '已截止';
  return w.closeAt ? `${w.extended ? '補作到' : '截止'} ${fmtWhen(w.closeAt)}` : '';
}

// 單字卡片的說明：類型一行、字數一行。基礎 → 進階 → 精熟每張都一樣，不寫（單元頁有）；老師關掉某些階段時才寫出有哪幾段
function vocabMetaHTML(u, levels) {
  const n = Number(u.count) || 0;
  const ph = typeof u.phrases === 'number' ? Math.min(u.phrases, n) : null;
  const counts = ph == null ? `${n} 個單字與片語` : ph ? `${n - ph} 個單字 · ${ph} 個片語` : `${n} 個單字`;
  const partial = levels.join('、') !== LEVELS.map((l) => l.name).join('、') ? ` · ${levels.join('、')}` : '';
  return `<div class="tile-meta stack"><span><span class="tile-cat">${typeIcon(u.type)}</span>${TYPES.vocab.tile}</span><span>${counts}${partial}</span></div>`;
}

function tileMeta(u) {
  if (u.type === 'pattern') return `${u.count} 題 · 選擇、填空、應用`;
  return `一篇文章 · ${u.count} 題閱讀測驗`;
}

// 卡片狀態：狀態標籤放最前面（文字＋圖示，用標籤的顏色區分），標題與主題第二；類型與字數、最佳成績與時段收在下面。
// 「下一步」只由首頁上方的大卡片表達，格子裡不再重複標記。
const TILE_STATE = { ok: '已完成', retake: '需補考', todo: '待檢討', miss: '缺交', wait: '未開放', open: '尚未開始' };
function tileHTML(u, asg = null) {
  const vocab = u.type === 'vocab';
  const b = store.best(u.id)[bestKey(u.type)];
  const st = unitStatus(u);
  // 大標題是後台設定的標題；小標是後台設定的類型。標題剛好跟類型名稱一樣時，不重複寫類型
  const heading = String(u.title || '').trim();
  const kind = TYPES[typeOf(u.type)].tile;
  // 主題（後台匯入內容時填的，課文理解沒填就是文章標題）：小字放在標題下面；空白或跟標題一樣就不顯示
  const topic = String(u.topic || '').trim();
  // 主題跟類型名稱一樣（例如句型單元主題寫「句型練習」）也不重複顯示
  const topicShown = topic && ![heading, kind, typeLabel(u.type)].some((x) => String(x || '').toLowerCase() === topic.toLowerCase()) ? topic : '';
  const chip = st.k === 'retake' && b != null && b < PASS ? `需補考 · 還差 ${PASS - b}%` : TILE_STATE[st.k];
  const sub = [b != null ? `最佳 ${b}%` : '', st.k === 'miss' ? '' : windowText(u.id, store.done(u.id))].filter(Boolean).join(' · ');
  // 最佳成績旁的小量尺：刻度就是及格線，每張卡片都看得到離通過還有多遠
  const meter = b != null ? `<span class="meter${b >= PASS ? ' ok' : ''}" role="img" aria-label="最佳 ${b}%，及格線 ${PASS}%"><i style="width:${Math.min(100, b)}%"></i><b style="left:${PASS}%"></b></span>` : '';
  // 左邊的成績環：做過就是最佳成績（環的長度＝分數），還沒做過放類型圖示
  const ring = b != null
    ? `<span class="tile-ring has" style="--p:${Math.max(0, Math.min(100, b))}" aria-hidden="true"><b>${b}</b></span>`
    : `<span class="tile-ring" aria-hidden="true">${typeIcon(u.type)}</span>`;
  return `<a data-id="${esc(u.id)}" class="unit-tile ${vocab ? 't-vocab' : 't-reading'} ty-${typeOf(u.type)} st-${st.k}" href="#/u/${esc(u.id)}">
      ${ring}<span class="tile-body">
      <div class="tile-top"><span class="tile-state">${st.ic}${chip}</span>${asg ? `<span class="tile-asg${asgDone(asg) ? ' done' : ''}">${icon.pin}${asgDone(asg) ? '指派・已完成' : `指派・${esc(fmtWhen(asg.due).split(' ')[0])} 截止`}</span>` : ''}</div>
      <h3 class="en">${esc(u.title)}</h3>
      ${topicShown ? `<p class="tile-topic en">${esc(topicShown)}</p>` : ''}
      ${vocab ? vocabMetaHTML(u, openLevels(u).map((l) => l.name)) : `<div class="tile-meta stack"><span><span class="tile-cat">${typeIcon(u.type)}</span>${kind}</span><span>${tileMeta(u)}</span></div>`}
      ${sub ? `<div class="tile-sub">${meter}<span>${esc(sub)}</span></div>` : ''}
      </span>
    </a>`;
}

/* ---------------- unit ---------------- */
// 轉場用的單元標題外框（資料載入前先顯示，版面和正式標題一致）
function unitShellHTML(meta) {
  return `<div class="unit-head shell"${markAttr(meta)}>
      <div class="eyebrow">${typeIcon(meta.type)}${lessonLabel(meta.lesson)} · ${TYPES[typeOf(meta.type)].tile}</div>
      <h1>${esc(meta.title)}</h1>
    </div><div class="loading"><span class="spinner"></span>載入中…</div>`;
}

// 封面右邊的大字課次（L3）：課次是數字才放
const markAttr = (meta) => (typeof meta.lesson === 'number' || /^\d+$/.test(String(meta.lesson || '')) ? ` data-mark="L${esc(String(meta.lesson))}"` : '');
function headHTML(meta, data) {
  const vocab = meta.type === 'vocab';
  const words = data.words || [];
  const phrases = words.filter((w) => w.type === 'phrase').length;
  const sub = vocab ? `單字 ${words.length - phrases} 個 · 片語 ${phrases} 個`
    : meta.type === 'pattern' ? `${(data.items || []).length} 題`
    : `${(data.questions || []).length} 題`;
  return `<div class="unit-head"${markAttr(meta)}>
      <div class="eyebrow">${typeIcon(meta.type)}${lessonLabel(meta.lesson)} · ${TYPES[typeOf(meta.type)].tile}</div>
      <h1>${esc(meta.title)}</h1>
      <div class="sub"><span>${sub}</span></div>
    </div>`;
}

function locked(meta) {
  const w = meta ? unitWindow(config, meta.id) : { state: 'open' };
  const when = w.state === 'before' ? `預計 ${fmtWhen(w.openAt)} 開放，到時候重新整理這一頁就能開始。` : '老師開放後會出現在首頁，不用做任何設定。';
  app.innerHTML = `<div class="empty"><div class="big">${icon.lock}</div><h2>這個單元還沒開放</h2><p>${when}</p><div class="btn-row center"><a class="btn primary" href="#/">回首頁</a></div></div>`;
}

async function renderUnit(id, sub) {
  const meta = findUnit(id);
  if (!meta) {
    app.innerHTML = `<div class="empty"><div class="big bad">${icon.alertCircle}</div><h2>找不到這個單元</h2><p>網址可能不完整，或這個單元已經被移除。</p><div class="btn-row center"><a class="btn primary" href="#/">回首頁</a></div></div>`;
    return;
  }
  if (!unitVisible(config, meta.id)) { locked(meta); return; }
  if (meta.id !== id) { location.replace(`#/u/${meta.id}${sub ? `/${sub}` : ''}`); return; }

  app.innerHTML = unitShellHTML(meta); // 先顯示標題外框（版面和正式標題一致），資料到了再換成完整頁面
  // 剛登入時紀錄還在背景載入：等它載完（最多幾秒），才不會把做過的單元當成沒做過
  const [data, mod, rawAnalysis] = await Promise.all([loadUnit(meta.id, config), modes[typeOf(meta.type)](), meta.type === 'vocab' ? loadAnalysis(meta.id) : null, historyReady()]);
  // 分析結果要和目前的題目對得上（簽章相同）才用
  const analysis = rawAnalysis && rawAnalysis.sig === analysisSig(data.words) ? rawAnalysis : null;

  if (meta.type !== 'vocab') {
    if (!modeOn(config, meta.id, meta.type)) { locked(meta); return; }
    document.title = `${meta.title} — B5 Practice`;
    app.innerHTML = `<div class="focus">${headHTML(meta, data)}<section id="stage"></section></div>`;
    cleanup = mod.mount(app.querySelector('#stage'), { unit: meta, data, config, questionCount: questionCount(config, meta.id) }) || null;
    return;
  }

  const levels = openLevels(meta);
  if (!levels.length) { locked(meta); return; }
  // 舊網址（#/u/l1-voc/basic 等）一律導回單元頁
  if (sub) { location.replace(`#/u/${meta.id}`); return; }
  document.title = `${meta.title} — B5 Practice`;
  app.innerHTML = `<div class="focus">${headHTML(meta, data)}<section id="stage"></section></div>`;
  cleanup = mod.mount(app.querySelector('#stage'), {
    unit: meta, data, allWords: data.words || [], config, levels, analysis, perTest: quizCount(unitCfg(config, meta.id)),
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
  // 做過正式測驗但沒通過：需要補考（缺交的判斷之前先處理）
  if (!done && store.tried(u.id)) return { k: 'retake', rank: 0, st: '需補考', note: `${best != null ? `最佳 ${best}%，` : ''}未達 ${PASS}%，要重新做一次正式測驗${w.state === 'after' ? '。已截止：下課跟老師說「班級、座號、這個單元要補作」，老師開放後這裡會變回可以作答' : ''}`, ic: icon.alert };
  if (done) return { k: 'todo', rank: 1, st: '待檢討', note: `${best != null ? `最佳 ${best}%・` : ''}做完檢討才能複習`, ic: icon.bulb };
  if (w.state === 'after') return { k: 'miss', rank: 0, st: '缺交', note: `已於 ${fmtWhen(w.closeAt)} 截止。跟老師說「班級、座號、這個單元要補作」，老師開放後就能作答`, ic: icon.alert };
  if (w.state === 'before') return { k: 'wait', rank: 5, st: '未開放', note: `${fmtWhen(w.openAt)} 開放`, ic: icon.lock };
  return { k: 'open', rank: 2, st: '尚未開始', note: w.closeAt ? `${w.extended ? '補作到' : '截止'} ${fmtWhen(w.closeAt)}` : '尚未測驗', ic: icon.play };
}

// 被伺服器拒收、沒有進到老師試算表的成績：列出來請學生截圖給老師（只列這位學生的）
function rejectedHTML(s) {
  const list = rejectedItems().filter((x) => String(x.cls) === String(s.cls) && String(x.seat) === String(s.seat));
  if (!list.length) return '';
  return `<section class="me-alert" role="alert">
      <h2>${icon.alert} 有 ${list.length} 筆成績沒有送到老師那裡</h2>
      <p>伺服器拒收了下面這幾次作答，重送也不會成功。請截圖這個畫面給老師，老師可以手動登記。</p>
      <ul>${list.map((x) => `<li><b>${esc(x.unitTitle || x.unit || '')}</b>
        <span>${esc(String(x.clientTs || x.rejectedAt || '').replace('T', ' ').slice(0, 16))}・${esc(String(x.score ?? ''))} / ${esc(String(x.total ?? ''))}（${esc(String(x.pct ?? ''))}%）${x.review ? '・複習' : ''}</span>
        <span class="muted">原因：${esc(x.reason || '伺服器拒收')}・編號 ${esc(String(x.attemptId || '').slice(0, 8))}</span></li>`).join('')}</ul>
    </section>`;
}

async function renderMe() {
  const s = store.student();
  if (!s) { location.replace('#/'); return; }
  document.title = '我的成績 — B5 Practice';
  app.innerHTML = '<div class="loading"><span class="spinner"></span>載入你的紀錄…</div>';
  await historyReady();
  const rows = visibleUnits().map((u) => ({ u, ...unitStatus(u) })).sort((a, b) => a.rank - b.rank || lessonCmp(a.u.lesson, b.u.lesson));
  const count = (k) => rows.filter((r) => r.k === k).length;
  const masked = maskName(s.name);
  app.innerHTML = `
    <section class="me-head">
      <div class="eyebrow">My records</div>
      <h1>${esc(masked)} 的成績</h1>
      <p class="muted" style="margin:0">${esc(s.cls)} 班 ${esc(s.seat)} 號</p>
    </section>
    ${rejectedHTML(s)}
    <div class="me-sum">
      <div class="sum"><b>${count('ok')} / ${rows.length}</b><span>已完成</span></div>
      <div class="sum todo"><b>${count('todo')}</b><span>待檢討</span></div>
      <div class="sum retake"><b>${count('retake')}</b><span>需補考</span></div>
      <div class="sum miss"><b>${count('miss')}</b><span>缺交</span></div>
    </div>
    ${rows.length ? `<div class="me-list">${rows.map((r) => `<a class="me-row ${r.k}" href="#/u/${esc(r.u.id)}">
        <span class="ic-box">${r.ic}</span>
        <span class="txt"><b>${esc(unitName(r.u))}</b><span>${typeLabel(r.u.type)}・${esc(r.note)}</span></span>
        <span class="st">${esc(r.st)}</span></a>`).join('')}</div>`
      : `<div class="empty"><div class="big">${icon.inbox}</div><p>老師目前沒有開放任何單元。</p></div>`}
    <p class="me-note">缺交是指：單元有截止時間、已經過了，而且沒有正式測驗紀錄。缺交的單元如果需要補作，請找老師。總分未達 ${PASS}% 的單元顯示「需補考」，重新做一次正式測驗，達標就通過。</p>`;
}

/* ---------------- 帳號（底部分頁列的頭像） ---------------- */
function renderAccount() {
  const s = store.student();
  if (!s) { location.replace('#/'); return; }
  document.title = '帳號 — B5 Practice';
  app.innerHTML = `
    <section class="me-head acct-head">
      <span class="acct-av" aria-hidden="true">${esc((s.name || '?').trim().charAt(0))}</span>
      <div><div class="eyebrow">Account</div>
      <h1>${esc(maskName(s.name))}</h1>
      <p class="muted" style="margin:0">${esc(s.cls)} 班 ${esc(s.seat)} 號</p></div>
    </section>
    <section class="me-set" aria-label="學習設定">
      <h2>學習設定</h2>
      <div class="set-row">
        <div class="set-txt"><b>句型說明的看法</b><span>句型練習的說明卡（之後也可以在說明卡右上角切換）</span></div>
        <div class="set-seg" role="radiogroup" aria-label="句型說明的看法">
          <button type="button" role="radio" data-learn="find">${icon.target}<span>邊看邊找</span><small>用手指把公式的每一塊劃起來</small></button>
          <button type="button" role="radio" data-learn="read">${icon.book}<span>直接看說明</span><small>例句直接標好顏色</small></button>
        </div>
      </div>
      <div class="set-row inline">
        <div class="set-txt"><b>自動下一題</b><span>單字選擇題答對後自動跳下一題</span></div>
        <button class="switch" type="button" role="switch" data-auto aria-label="自動下一題"><span class="sw" aria-hidden="true"></span></button>
      </div>
      <p class="set-saved" aria-live="polite"></p>
    </section>
    ${accountHTML(s)}`;
  bindAccount(app);
  // 學習設定：句型說明的看法存在學生帳本（換裝置也記得），自動下一題存在這台裝置
  const lp = learnPrefs();
  const saved = app.querySelector('.set-saved');
  const say = (t) => { saved.textContent = t; clearTimeout(say.t); say.t = setTimeout(() => { saved.textContent = ''; }, 2000); };
  const paintLearn = () => app.querySelectorAll('[data-learn]').forEach((b) => b.setAttribute('aria-checked', String(lp.get('learnMode') === b.dataset.learn)));
  app.querySelectorAll('[data-learn]').forEach((b) => b.addEventListener('click', () => { lp.set('learnMode', b.dataset.learn); paintLearn(); say('✓ 已儲存'); }));
  paintLearn();
  const autoOn = () => { try { return localStorage.getItem('b5p:auto') !== '0'; } catch { return true; } };
  const auto = app.querySelector('[data-auto]');
  const paintAuto = () => auto.setAttribute('aria-checked', String(autoOn()));
  auto.addEventListener('click', () => { try { localStorage.setItem('b5p:auto', autoOn() ? '0' : '1'); } catch { /* ignore */ } paintAuto(); say('✓ 已儲存'); });
  paintAuto();
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
  app.querySelector('[data-clear]').onclick = async () => { if (await confirmDialog({ title: '清除排隊中的成績？', body: '清除後這些成績不會送到老師的試算表（學生網站上的紀錄不受影響）。', ok: '清除', danger: true })) { clearOutbox(); box(); } };
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
        <p>另外，為了讓老師知道網站同時有多少人在使用，網站會記錄匿名的連線狀態：目前在哪個畫面、哪個單元、用手機還是電腦，以及成績送出是否成功的次數。這部分只用一組隨機編號，不含姓名、班級、座號；關掉網頁就會刪除在線紀錄。</p>
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

/* ---------------- 即時在線（老師後台的「即時」頁看得到人數與所在畫面，匿名） ---------------- */
const presence = () => import('./presence.js');
function reportView() {
  const [, kind, id] = location.hash.split('/').map(decodeURIComponent);
  const u = kind === 'u' && id ? findUnit(id) : null;
  const v = !store.student() ? 'login'
    : kind === 'u' ? (document.body.dataset.busy ? `quiz-${typeOf(u && u.type)}` : 'unit')
      : kind === 'me' ? 'me' : !kind ? 'home' : 'other';
  presence().then((p) => p.setPresence(v, u ? u.id : '')).catch(() => {});
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
          <a class="btn" href="admin.html#live">即時監控</a>
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
  renderFooter();
  let base;
  const build = () => {
    index = structuredClone(base);
    addCustomUnits(index, config);
    applyImported(index, config);
    const since = {};
    Object.entries((config && config.units) || {}).forEach(([id, u]) => { const t = Date.parse(u.since); if (t) since[id] = t; });
    store.setSince(since);
    // 老師重製過的單元（題目更新時勾選「重製學生的進度」，或刪掉單元重建）：這台裝置上那個單元的本機紀錄一併清掉。
    // 每台裝置記住各單元上次看到的重製時間，不一樣就是重製過；第一次看到的不清（沒有東西可比）。
    const reset = [];
    Object.entries(since).forEach(([id, t]) => {
      const prev = store.unitStamp(id);
      if (prev != null && prev !== t) { store.resetUnit(id); reset.push(id); }
      if (prev !== t) store.setUnitStamp(id, t);
    });
    return reset;
  };
  // 重製後重新讀一次伺服器上的紀錄（舊的在 storage.applyHistory 裡會被忽略），再重畫畫面
  const reloadHistory = () => {
    const s = store.student();
    if (!(s && s.key)) return;
    firebase().then((fb) => fb.loadHistory(s.key)).then((h) => {
      store.applyHistory(h.attempts, h.reviews);
      if (!document.body.dataset.busy && (location.hash.split('/')[1] || '') !== 'teacher') route();
    }).catch(() => {});
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
    if (build().length) reloadHistory();
  } catch (err) {
    showError(err);
    return;
  }
  // 先用上次存下的設定畫出畫面；背景抓到老師的新設定後再重畫（測驗進行中不打斷）
  window.addEventListener('config-updated', (e) => {
    config = e.detail;
    // 老師重製了單元（題目更新或刪掉重建）：清掉本機紀錄，重新讀一次伺服器上的紀錄，舊的完成／檢討標記不再算數
    if (build().length) reloadHistory();
    // 作答中不打斷（交卷後換頁就會用新設定）；老師頁不需要重畫
    const kind = location.hash.split('/')[1] || '';
    if (kind === 'teacher' || document.body.dataset.busy) return;
    if (kind) { route(); return; }
    animateHome();
  });
  watchConfig(config);
  // 等頁面載完、畫面穩定之後才在背景預先下載測驗畫面的程式（不跟首頁搶頻寬）
  const afterLoad = (fn) => (document.readyState === 'complete' ? setTimeout(fn, 600) : window.addEventListener('load', () => setTimeout(fn, 600), { once: true }));
  // 中文網頁字型（Noto Sans TC，約 100KB 的字型設定檔，只下載畫面用到的字）：等使用者第一次點擊、輸入或滑動才開始載入，
  // 不跟開啟網站的畫面搶頻寬（真人幾秒內一定會操作；檢測工具不操作，所以不會拖慢它量到的開啟速度）。中文字寬一律是 1em，換字型不會讓版面位移。
  if (CJK_WEBFONT) {
    let cjkLoaded = false;
    const loadCjk = () => {
      if (cjkLoaded) return;
      cjkLoaded = true;
      const l = document.createElement('link');
      l.rel = 'stylesheet';
      l.href = 'https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@400;500;700&display=swap';
      document.head.append(l);
    };
    ['pointerdown', 'keydown', 'touchstart', 'scroll'].forEach((t) => window.addEventListener(t, loadCjk, { once: true, passive: true }));
  }
  // 偵測網站有沒有部署新版：沒在考試時，換頁的瞬間自動更新成新版
  afterLoad(() => idle(() => import('./update.js').then((m) => m.watchForUpdate({ auto: true, isBusy: () => !!document.body.dataset.busy })).catch(() => {})));
  // 老師頁不算在線人數；學生端閒置時才載入在線統計，不拖慢開啟
  afterLoad(() => idle(() => { if (location.hash.split('/')[1] !== 'teacher') presence().then((p) => { p.startPresence(); reportView(); }).catch(() => {}); }));
  afterLoad(() => idle(() => { modes.vocab().catch(() => {}); modes.reading().catch(() => {}); modes.pattern().catch(() => {}); }));
  // 之前沒送成功的成績：開站時與恢復連線時自動補送
  flushOutbox();
  window.addEventListener('online', () => flushOutbox());
  // 交卷畫面「立即重送」：手動觸發一次補送，結果直接更新同一個狀態框
  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-resend]');
    if (!btn) return;
    const box = btn.closest('.submit-state');
    btn.disabled = true;
    btn.textContent = '重送中…';
    await flushOutbox().catch(() => {});
    if (box && box.isConnected) box.outerHTML = submitStateHTML(outboxStatus());
  });
  // 離線提示：學生不用猜成績有沒有送出
  const offBar = document.createElement('div');
  offBar.className = 'offline-bar';
  offBar.setAttribute('role', 'status');
  offBar.hidden = navigator.onLine;
  offBar.innerHTML = `${icon.alert}<span>目前沒有網路。成績會先存在這台裝置，連上網路後自動送出給老師。</span>`;
  document.querySelector('.topbar').after(offBar);
  window.addEventListener('offline', () => { offBar.hidden = false; });
  window.addEventListener('online', () => { offBar.hidden = true; });
  // 往下捲動時導覽列下方加一道陰影（高度不變，切換狀態不會改變頁面高度、不會互相觸發）。
  // 用 requestAnimationFrame 節流、加上緩衝區（>64px 出現、<24px 消失）與最短間隔，iPhone 快速滑動時不會來回閃動。
  let scrolled = false;
  let ticking = false;
  let lastFlip = 0;
  let trailing = 0;
  const flip = (on) => { scrolled = on; lastFlip = performance.now(); document.body.classList.toggle('scrolled', on); };
  const evaluate = () => {
    ticking = false;
    const y = Math.max(0, window.scrollY);
    document.documentElement.classList.toggle('at-top', window.scrollY < 160);
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

  // 考試中：body.exam（導覽列維持完整狀態）。練習沒有時限，不顯示倒數或計時，避免製造壓力；作答時間仍由各測驗記錄、隨成績送出。
  const setExam = (on) => {
    if (on === document.body.classList.contains('exam')) return;
    document.body.classList.toggle('exam', on);
    if (on) {
      flip(false); // 考試中導覽列維持完整狀態
    } else {
      evaluate();
    }
  };
  // 作答誠信：作答中阻擋翻譯與複製貼上、記錄離開畫面（js/integrity.js）；交卷時附在成績裡
  let watching = false;
  const watchIntegrity = (on) => {
    if (on === watching) return;
    watching = on;
    if (on) integrity.start(decodeURIComponent(location.hash.split('/')[2] || ''), { onNotice: (t) => notify(t, 'wait') });
    else integrity.stop();
  };
  new MutationObserver(() => { setExam(!!document.body.dataset.busy); watchIntegrity(!!document.body.dataset.busy); reportView(); }).observe(document.body, { attributes: true, attributeFilter: ['data-busy'] });
  // 成績排隊／排到送出時，在畫面右下角通知
  window.addEventListener('score-queued', (e) => notify(`${e.detail.unitTitle || e.detail.unit} 成績已加入排隊，稍後自動送出`, 'wait'));
  window.addEventListener('score-rejected', (e) => notify(`${e.detail.unitTitle || e.detail.unit} 成績被伺服器拒收，請到「我的成績」截圖給老師`, 'wait'));
  window.addEventListener('score-sent', (e) => notify(`${e.detail.unitTitle || e.detail.unit} ${String(e.detail.clientTs || '').slice(11, 16)} 已送出成績`, 'ok'));
  // 考試鎖定：作答中點任何站內連結（左上 B5、所有單元…）或按上一頁，都先確認，避免不小心中斷
  let curHash = location.hash;
  let reverting = false;
  const leaveOk = () => confirmDialog({
    title: '要離開這次測驗嗎？',
    body: leaveBody((/^#\/u\/([^/]+)/.exec(location.hash) || [])[1] || ''),
    ok: '離開', cancel: '繼續作答', danger: true,
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
  // 以 Firestore 為準：進站時重新讀取紀錄（例如在別台裝置做過的測驗）；5 分鐘內讀過就沿用（重新整理、自動更新不重複下載）
  const s = store.student();
  if (s && s.key && !store.historyFresh(s.key, 5 * 60 * 1000)) {
    firebase().then((fb) => fb.loadHistory(s.key)).then((h) => {
      store.applyHistory(h.attempts, h.reviews);
      // 作答中不打斷（交卷後換頁就會用新設定）；老師頁不需要重畫
    const kind = location.hash.split('/')[1] || '';
    if (kind !== 'teacher' && !document.body.dataset.busy) route();
    }).catch(() => { /* 離線時沿用裝置上的紀錄 */ });
  }
}

boot();
