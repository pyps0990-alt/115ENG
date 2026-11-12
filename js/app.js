import { loadIndex, loadUnit, loadUnitNow, unitCached, applyImported, addCustomUnits, loadAnalysis, analysisSig } from './data.js';
import { getConfig, watchConfig, unitVisible, modeOn, questionCount, unitWindow, fmtWhen, unitCfg, assignmentsFor, dueLabel } from './remote-config.js';
import { store } from './storage.js';
import { esc, confirmDialog, scene } from './util.js';
import { icon } from './icons.js';
import { mountInlineForm, historyReady, maskName, bindAccount, openStudentDialog } from './student.js';
import { LEVELS, PASS, levelsFor, quizCount } from './levels.js';
import { flushOutbox, pendingItems, clearOutbox, outboxStatus, rejectedItems } from './submit.js';
import { submitStateHTML, markWhoOk, clearWhoOk } from './components/gate.js';
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


// 「平的捲動」：轉場期間頁面停在頂端，用內容往上位移代替捲動（relative 位移：不影響裡面 fixed 的元素）
let flat = false, flatY = 0;
function setScroll(y) {
  if (!flat) { window.scrollTo(0, y); return; }
  flatY = y;
  app.style.top = y ? `${-y}px` : '';
}
function flatStart() {
  flat = true;
  document.documentElement.classList.add('far-run'); // 頂端回彈用的深藍不要露出來
  app.style.position = 'relative';
  setScroll(window.scrollY);
  window.scrollTo(0, 0);
}
function flatEnd() {
  if (!flat) return;
  flat = false;
  const y = flatY;
  app.style.top = ''; app.style.position = '';
  window.scrollTo(0, y);
  document.documentElement.classList.remove('far-run');
}
const scrollMem = {};
// 瀏覽器自己做了換頁動畫（iPhone 滑動返回）：這次換頁不再做轉場
let uaSwiped = false;
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
  hush(1000);
  // 從首頁、我的成績點進單元前，記下捲到哪裡；返回時回到原位（不再一律跳回最上面，越下面的單元越明顯）
  const nextKind = (location.hash.split('/')[1] || '');
  if (changed && !first && nextKind === 'u' && ['', 'me'].includes(prevKind)) scrollMem[prevKind] = window.scrollY;
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
  // 分頁列、左上角按鈕的變化放進換頁轉場裡一起做（舊畫面截圖時還是原本的樣子，不會先「啪」一下變掉）
  const chrome = () => { syncDock(loggedIn && (!kind || kind === 'me' || kind === 'account') ? (kind || 'home') : null); paintTopLeft(kind, loggedIn); };
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
  const backTo = changed && prevKind === 'u' && ['', 'me'].includes(lastKind) ? scrollMem[lastKind] : null;
  const fromSearch = !!document.querySelector('dialog.search-sheet[open]');
  const run = async () => {
    pinY = null; // 點了搜尋結果換頁：不再固定位置
    closeSearchNow();
    setScroll(0); chrome(); await render();
    if (backTo) setScroll(backTo);
    if (lastKind !== 'u') for (const k in scrollMem) delete scrollMem[k]; // 回到上層（或換到別的分頁）後就不再記
  };
  // 首頁、我的成績、帳號之間用分頁列切換：也用同一套過場（統一），分頁列單獨拿出來保持即時、膠囊用彈簧滑過去；
  // 不支援轉場的瀏覽器才用文字與卡片淡入
  const tabKinds = ['', 'me', 'account'];
  const tabSwitch = changed && !first && tabKinds.includes(prevKind) && tabKinds.includes(kind || '');
  // 舊畫面或新畫面捲在下面：不用截圖式轉場（iPhone Safari 在「已經捲動、轉場中又要捲回頂端或捲到原位」時截圖位置會算錯，
  // 會閃出首頁頂端、導覽列被擠到下面）。改成直接在畫面上：內容 0.1 秒淡出 → 換頁 → 淡入；導覽列不參與，一直在原位
  // iPhone 從左邊緣滑回上一頁：Safari 已經做了自己的滑動動畫，B5 不再做第二次（不然會閃一下、像重複換頁）
  const swiped = uaSwiped; uaSwiped = false;
  const useVT = changed && !first && !swiped && !!document.startViewTransition && !reduceMotion.matches && document.visibilityState === 'visible';
  // 捲在下面也用同一套截圖式轉場，但轉場期間「頁面不捲動」：iPhone Safari 只在轉場中頁面捲動（點進單元捲回頂端、返回捲回原位）時
  // 截圖位置會算錯。所以轉場開始前先把捲動換成內容往上位移（看起來一模一樣、頁面停在頂端），轉場中要捲到哪裡也都用位移代替，
  // 轉場結束的同一格再換回真正的捲動位置
  const far = changed && !first && !reduceMotion.matches && (window.scrollY > 0 || (backTo || 0) > 0);
  if (useVT && far) flatStart();
  if (useVT) {
    let job = null;
    // 分頁列不單獨截圖（iPhone Safari 截毛玻璃會出現灰白色空框），跟整個畫面一起淡化
    document.documentElement.dataset.nav = fromSearch ? 'search' : tabSwitch ? 'tab' : (app.dataset.dir || 'fwd');
    const t = document.startViewTransition(() => { job = run(); return Promise.race([job, new Promise((r) => setTimeout(r, 100))]); });
    t.finished.catch(() => {}).finally(() => { if (document.documentElement.dataset.nav === 'tab') delete document.documentElement.dataset.nav; flatEnd(); });
    t.ready.catch(() => {});
    await t.updateCallbackDone.catch(() => {});
    await (job || run());
  } else await run();
  reportView();
  // 不再為了等中文網頁字型把整頁藏起來（以前最多藏 1.2 秒：換到用到新字的頁面時會整片白、動畫卡住）。
  // 中文字寬都是 1em，字型到了直接換上，版面不會位移
  if (tabSwitch && !useVT && !reduceMotion.matches) { app.classList.remove('page-in', 'tab-in'); void app.offsetWidth; app.classList.add('tab-in'); clearTimeout(route.tabT); route.tabT = setTimeout(() => app.classList.remove('tab-in'), 500); }
  else if (!useVT && !swiped) pageIn(changed, first);
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

// 搜尋單元：輸入課次、單元名稱、主題或題型（例如「L3」「單字」「閱讀」），點結果直接進入。
// 動畫：左上角的搜尋按鈕原地「長」成搜尋框（上方導覽列不動，B5 淡出、取消淡入），下面的結果淡入蓋住頁面；
// 取消時倒著收回按鈕；點結果時整個搜尋畫面跟換頁一樣淡入單元頁（不會先閃回首頁）
// 搜尋期間與剛關掉的一小段時間：底下的頁面固定在打開搜尋時的位置。
// iPhone 叫出、收起鍵盤時會自己捲動頁面（關掉搜尋後首頁被捲到最下面、或跳一下），這裡把它拉回原位
let pinY = null, pinUntil = 0;
const pinScroll = () => { if (pinY != null && (Date.now() < pinUntil || document.querySelector('dialog.search-sheet')) && Math.abs(window.scrollY - pinY) > 1) window.scrollTo(0, pinY); };
window.addEventListener('scroll', pinScroll, { passive: true });
window.visualViewport?.addEventListener('resize', pinScroll);
// 搜尋關掉後，使用者自己一碰畫面（滑動、滾輪）就不再固定，照常捲動
['touchstart', 'wheel', 'keydown'].forEach((t) => window.addEventListener(t, () => { if (!document.querySelector('dialog.search-sheet')) pinY = null; }, { passive: true, capture: true }));
function unpinSoon(ms = 900) {
  pinUntil = Date.now() + ms;
  pinScroll();
  [60, 200, 400, 700, ms].forEach((t) => setTimeout(pinScroll, t));
  setTimeout(() => { if (Date.now() >= pinUntil && !document.querySelector('dialog.search-sheet')) pinY = null; }, ms + 50);
}
function openSearch() {
  if (document.querySelector('dialog.search-sheet')) return;
  pinY = window.scrollY; pinUntil = 0;
  const d = document.createElement('dialog');
  d.className = 'search-sheet';
  d.setAttribute('aria-label', '搜尋單元');
  d.innerHTML = `<div class="ss-bar"><label class="ss-field">${icon.search}<input type="search" placeholder="搜尋單元：課次、名稱、主題" aria-label="搜尋單元" enterkeyhint="search" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"></label><button class="ss-x" type="button" data-close>取消</button></div><div class="ss-body"><div class="ss-list" role="list"></div></div>`;
  document.body.appendChild(d);
  const input = d.querySelector('input'), list = d.querySelector('.ss-list');
  const all = visibleUnits().map((u) => ({ u, s: unitStatus(u), key: [unitName(u), u.title, u.topic, lessonLabel(u.lesson), `L${u.lesson}`, typeLabel(u.type), TYPES[typeOf(u.type)].tile].join(' ').toLowerCase() }))
    .sort((a, b) => lessonCmp(a.u.lesson, b.u.lesson));
  const draw = () => {
    const q = input.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const hits = all.filter((x) => q.every((w) => x.key.includes(w)));
    list.innerHTML = hits.length ? hits.map((x) => `<a class="ss-row ${x.s.k}" role="listitem" href="#/u/${esc(x.u.id)}">${ringHTML(x.u, 'sm')}<span class="txt"><b>${esc(unitName(x.u))}</b><span>${esc([typeLabel(x.u.type), topicOf(x.u)].filter(Boolean).join(' · '))}</span></span>${chipHTML(x.u, x.s)}</a>`).join('')
      : `<p class="ss-empty">找不到「${esc(input.value.trim())}」的單元</p>`;
  };
  const close = () => {
    if (!d.isConnected || d.classList.contains('closing')) return;
    input.blur();
    unpinSoon(); // 收鍵盤時頁面不要被捲走
    if (reduceMotion.matches) { closeSearchNow(); unpinSoon(); return; }
    d.classList.add('closing');
    document.body.classList.add('search-closing'); // B5 先淡回來；左上角按鈕等搜尋框收回原位才換回（同一個位置、同一個樣子，看不出切換）
    const done = () => { closeSearchNow(); unpinSoon(); };
    const t = setTimeout(done, 600); // 保險：動畫事件沒來也會收掉
    d.querySelector('.ss-body').addEventListener('animationend', () => { clearTimeout(t); done(); }, { once: true });
  };
  input.addEventListener('input', draw);
  // 點結果：不先關掉（換頁時由 route 收掉），換頁轉場直接從搜尋畫面淡到單元頁
  d.addEventListener('click', (e) => { if (e.target === d || e.target.closest('[data-close]')) close(); });
  d.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
  draw();
  // iPhone 開鍵盤時可見範圍會變小：搜尋畫面的高度與位置跟著「鍵盤上方看得到的範圍」走，
  // 搜尋框永遠在最上面、只有結果列表在捲（不然整個搜尋畫面連同底下的首頁會一起被捲走）
  const vv = window.visualViewport;
  const fit = () => { if (!vv || !d.isConnected) return; d.style.top = `${Math.max(0, vv.offsetTop)}px`; d.style.height = `${vv.height}px`; };
  if (vv) { vv.addEventListener('resize', fit); vv.addEventListener('scroll', fit); d._unfit = () => { vv.removeEventListener('resize', fit); vv.removeEventListener('scroll', fit); }; }
  fit();
  document.documentElement.classList.add('search-lock'); // 底下的頁面不能被捲動
  document.body.classList.add('searching');
  d.showModal();
  input.focus({ preventScroll: true });
}
// 立刻收掉搜尋畫面（換頁時、關閉動畫結束時）
function closeSearchNow() {
  document.querySelectorAll('dialog.search-sheet').forEach((d) => { d._unfit?.(); try { d.close(); } catch { /* ignore */ } d.remove(); });
  document.body.classList.remove('searching', 'search-closing');
  document.documentElement.classList.remove('search-lock');
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
// 選取膠囊用彈簧物理移動（跟老師後台的分頁列一樣）：每一格算位置、速度，跟手、放開都平順，不會亂彈。
// 拖動時用很硬、阻尼足的彈簧緊跟手指；放開或點分頁時用柔和、幾乎不過衝的彈簧滑到目標分頁（阻尼比約 0.93）
const DS = { ink: null, x: null, v: 0, tx: 0, y: 0, vy: 0, ty: 0, s: 1, vs: 0, ts: 1, k: 420, c: 38, raf: 0, last: 0 };
function dockPaint() { DS.ink.style.transform = `translate3d(${DS.x.toFixed(2)}px, ${DS.y.toFixed(2)}px, 0) scale(${DS.s.toFixed(4)})`; }
function dockRun() {
  if (DS.raf || !DS.ink) return;
  DS.last = performance.now();
  const step = (now) => {
    const dt = Math.min(0.034, Math.max(0, (now - DS.last) / 1000)); DS.last = now;
    const h = dt / 3; // 分三小步算，低幀率時也穩定
    for (let i = 0; i < 3; i++) {
      DS.v += (DS.k * (DS.tx - DS.x) - DS.c * DS.v) * h; DS.x += DS.v * h;
      DS.vy += (700 * (DS.ty - DS.y) - 52 * DS.vy) * h; DS.y += DS.vy * h;
      DS.vs += (520 * (DS.ts - DS.s) - 44 * DS.vs) * h; DS.s += DS.vs * h;
    }
    const still = Math.abs(DS.tx - DS.x) < 0.25 && Math.abs(DS.v) < 4 && Math.abs(DS.ty - DS.y) < 0.25 && Math.abs(DS.vy) < 4 && Math.abs(DS.ts - DS.s) < 0.002 && Math.abs(DS.vs) < 0.05;
    if (still) { DS.x = DS.tx; DS.y = DS.ty; DS.s = DS.ts; DS.v = DS.vy = DS.vs = 0; dockPaint(); DS.raf = 0; return; }
    dockPaint();
    DS.raf = requestAnimationFrame(step);
  };
  DS.raf = requestAnimationFrame(step);
}
// 膠囊滑到目前的分頁（instant：直接放好，例如分頁列剛出現時）
function placeDockInk(instant) {
  const dock = document.getElementById('dock');
  const ink = dock && dock.querySelector('.dock-ink');
  const links = dock ? [...dock.querySelectorAll('a')] : [];
  const cur = links.find((a) => a.hasAttribute('aria-current'));
  if (!ink || !cur) return;
  DS.ink = ink;
  DS.tx = cur.offsetLeft; DS.ty = 0; DS.ts = 1; DS.k = 420; DS.c = 38;
  if (instant || DS.x === null || reduceMotion.matches) { DS.x = DS.tx; DS.y = 0; DS.s = 1; DS.v = DS.vy = DS.vs = 0; dockPaint(); return; }
  dockRun();
}
// 拖動選取膠囊：左右拖到另一個分頁放開就切換；往上下拉或拖出兩端有橡皮筋（越拉越緊、有極限），放開彈回
let dockReady = false;
function initDockDrag(dock) {
  if (dockReady) return;
  dockReady = true;
  const rubber = (d, lim) => { const a = Math.abs(d); return (d < 0 ? -1 : 1) * lim * (1 - 1 / (a * 0.55 / lim + 1)); };
  let pid = null; let sx = 0; let sy = 0; let x0 = 0; let w = 0; let k = 1; let dragging = false; let moved = false; // k：縮小時的比例（手指移動換算成分頁列裡的距離）
  const links = () => [...dock.querySelectorAll('a')];
  const nearest = (cx) => { let best = Infinity; let t = null; links().forEach((a) => { const d = Math.abs(a.offsetLeft + a.offsetWidth / 2 - cx); if (d < best) { best = d; t = a; } }); return t; };
  const finish = (e, cancel) => {
    if (pid === null) return;
    pid = null;
    dock.classList.remove('dragging');
    links().forEach((a) => a.classList.remove('over'));
    if (!dragging) return;
    dragging = false;
    const dx = Math.abs(e.clientX - sx); const dy = Math.abs(e.clientY - sy);
    let target = dock.querySelector('a[aria-current]');
    if (!cancel && !(dx < 24 && dy > dx)) target = nearest(DS.tx + w / 2) || target;
    // 放開：用柔和的彈簧滑到要去的分頁（保留手指放開時的速度，不會突然停住或彈很多下）
    DS.k = 420; DS.c = 38; DS.tx = target.offsetLeft; DS.ty = 0; DS.ts = 1; dockRun();
    if (target && !target.hasAttribute('aria-current')) dockGo(target);
    setTimeout(() => { moved = false; }, 350);
  };
  dock.addEventListener('pointerdown', (e) => {
    if (e.button > 0) return;
    const cur = dock.querySelector('a[aria-current]'); if (!cur) return;
    pid = e.pointerId; sx = e.clientX; sy = e.clientY; x0 = cur.offsetLeft; w = cur.offsetWidth; k = dock.getBoundingClientRect().width / dock.offsetWidth || 1; dragging = false; moved = false;
    if (DS.x === null) placeDockInk(true);
  });
  dock.addEventListener('pointermove', (e) => {
    if (pid !== e.pointerId) return;
    if (!dragging) {
      if (Math.hypot(e.clientX - sx, e.clientY - sy) < 6) return;
      dragging = true; moved = true;
      try { dock.setPointerCapture(pid); } catch { /* ignore */ }
      dock.classList.add('dragging');
    }
    e.preventDefault();
    const lo = 6; const hi = dock.clientWidth - w - 6; const fx = x0 + (e.clientX - sx) / k;
    const x = fx < lo ? lo + rubber(fx - lo, 18) : fx > hi ? hi + rubber(fx - hi, 18) : fx;
    // 拖動：很硬的彈簧緊跟手指（不是直接設位置，所以觸控事件不規則時也不會一頓一頓）
    DS.k = 1500; DS.c = 78; DS.tx = x; DS.ty = reduceMotion.matches ? 0 : rubber(e.clientY - sy, 10); DS.ts = reduceMotion.matches ? 1 : 1.06;
    if (reduceMotion.matches) { DS.x = DS.tx; DS.y = DS.ty; dockPaint(); } else dockRun();
    const cx = x + w / 2;
    links().forEach((a) => a.classList.toggle('over', Math.abs(a.offsetLeft + a.offsetWidth / 2 - cx) < a.offsetWidth / 2));
  }, { passive: false });
  dock.addEventListener('pointerup', (e) => finish(e, false));
  dock.addEventListener('pointercancel', (e) => finish(e, true));
  // 只在膠囊列自己失去捕捉時才算中斷（手指按在連結上時，瀏覽器先把捕捉給連結，轉給膠囊列時連結也會發出這個事件）
  dock.addEventListener('lostpointercapture', (e) => { if (e.target === dock && pid === e.pointerId) finish({ clientX: sx, clientY: sy }, true); });
  dock.addEventListener('dragstart', (e) => e.preventDefault());
  dock.addEventListener('click', (e) => {
    if (moved) { moved = false; e.preventDefault(); e.stopPropagation(); return; }
    // 點分頁：膠囊先開始滑，0.12 秒後才換頁（換頁要畫新畫面，會佔掉一兩格；膠囊已經滑了一大半，看起來不會頓一下）
    const a = e.target.closest('a[data-dock]');
    if (!a || a.hasAttribute('aria-current') || e.metaKey || e.ctrlKey || reduceMotion.matches) return;
    e.preventDefault();
    DS.k = 420; DS.c = 38; DS.tx = a.offsetLeft; DS.ty = 0; DS.ts = 1; dockRun();
    dockGo(a);
  }, true);
  const dockGo = (a) => {
    links().forEach((x) => { if (x === a) x.setAttribute('aria-current', 'page'); else x.removeAttribute('aria-current'); }); // 顏色先換過去
    clearTimeout(dockGo.t);
    dockGo.t = setTimeout(() => { location.hash = a.getAttribute('href'); }, reduceMotion.matches ? 0 : 60);
  };
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
// 首頁畫好後，趁空檔把接下來要做的單元題目先下載存在裝置上（依老師更新時間存，沒改過就不再下載）：點進單元時不用等網路。
// 一次載入只做一次；省流量模式不做。
let prefetched = false;
// 一個一個在瀏覽器空閒時下載；換頁、點擊、捲動的前後一小段時間先停（下載完解析題目要一點時間，不能剛好撞在動畫上）
let quietUntil = 0;
const hush = (ms) => { quietUntil = Math.max(quietUntil, performance.now() + ms); };
['pointerdown', 'keydown', 'wheel', 'touchmove'].forEach((t) => window.addEventListener(t, () => hush(700), { passive: true, capture: true }));
// 手指按下單元（卡片、指派、成績列、搜尋結果）的那一刻就先讀題目：放開、換頁時題目已經在記憶體裡
document.addEventListener('pointerdown', (e) => {
  const a = e.target.closest && e.target.closest('a[href^="#/u/"]');
  const meta = a && config && index && findUnit(decodeURIComponent(a.getAttribute('href').split('/')[2] || ''));
  if (meta) loadUnit(meta.id, config).catch(() => {});
}, { passive: true, capture: true });
const idleTurn = () => new Promise((r) => (window.requestIdleCallback ? requestIdleCallback(r, { timeout: 6000 }) : setTimeout(r, 400)));
function prefetchUnits(list) {
  if (prefetched || !list.length || (navigator.connection && navigator.connection.saveData)) return;
  prefetched = true;
  (async () => {
    for (const u of list) {
      if (unitCached(u.id, config)) continue;
      do { await idleTurn(); } while (performance.now() < quietUntil || document.body.dataset.busy);
      await loadUnitNow(u.id, config, { low: true }).catch(() => {}); // 只存到裝置上，不放進按下卡片用的暫存
    }
  })();
}

function renderHome() {
  document.title = 'B5 Practice';
  const s = store.student();
  // 在首頁登入成功時不會換頁：這裡也更新分頁列與左上角（搜尋），不用等下一次換頁才出現
  if (!(location.hash.split('/')[1] || '')) { syncDock(s ? 'home' : null); paintTopLeft('', !!s); }
  app.innerHTML = s
    ? `<section class="hero compact cover">
        <div class="cover-eyebrow">${esc(index.book || 'Book 5')} · ${esc(s.cls)} 班 ${esc(s.seat)} 號</div>
        <h1>${esc(maskName(s.name))}，今天從哪一課開始？</h1>
        <p id="progress-slot"></p>
      </section>
      <div id="next-slot"></div>
      <div id="lessons"></div>`
    : `<section class="hero cover">
        <h1>B5 Practice</h1>
      </section>
      <div id="welcome-slot"></div>
      <div id="lessons"></div>`;

  // 還沒確認身分：只顯示基本資料表單，確認後才載入單元與這位學生的紀錄
  if (!s) {
    mountInlineForm(app.querySelector('#welcome-slot'), {
      title: '輸入你的基本資料',
      desc: '',
      button: '開始練習',
      onSave: () => scene(() => renderHome()),
    });
    return;
  }

  const visible = visibleUnits();
  const lessons = [...new Set(visible.map((u) => u.lesson))].sort(lessonCmp);
  const host = app.querySelector('#lessons');
  if (!visible.length) {
    host.innerHTML = `<div class="empty"><div class="big">${icon.inbox}</div><h2>還沒有開放的單元</h2><button class="btn" type="button" data-refresh>${icon.redo} 重新整理</button></div>`;
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
  prefetchUnits([...new Set([...asgPending.map((a) => a.u), ...upcoming.map((r) => r.u), ...visible])]); // 全部開放的單元都先下載（要做的排前面）：點下面的單元也不用等網路
  if (asgPending.length) {
    // 老師指派的作業：一張用圖釘釘在封面上的便條紙，條列還沒做完的作業（截止早的在上面）。
    // 每一行：單元名稱、目前狀態、截止時間、還剩幾天（今天截止紅色、兩天內琥珀色）
    const rows = asgPending.map((a) => {
      const [when, left] = dueLabel(a.due).split(' · ');
      const days = (a.due - Date.now()) / 86400000;
      const urg = days < 1 ? 'today' : days <= 2 ? 'soon' : '';
      return `<li><a class="asg-row ${urg}" href="#/u/${esc(a.u.id)}">
          ${ringHTML(a.u, 'sm')}
          <span class="asg-main"><b class="en" lang="en">${esc(a.u.title)}</b><span class="asg-meta">${chipHTML(a.u)}<span class="asg-sub">${esc([typeLabel(a.u.type), topicOf(a.u)].filter(Boolean).join(' · '))}</span></span></span>
          <span class="asg-due"><span class="asg-left">${esc(left === '今天' ? '今天截止' : left)}</span><span class="asg-when">${esc(when.replace(/ 截止$/, ''))}</span></span>
          <span class="asg-go" aria-hidden="true">${icon.arrowR}</span>
        </a></li>`;
    }).join('');
    app.querySelector('#next-slot').innerHTML = `<section class="asg-note" aria-label="老師指派的作業">
        <svg class="asg-pin" viewBox="0 0 64 72" aria-hidden="true">
          <defs>
            <linearGradient id="pinNeck" x1="0" x2="1"><stop offset="0" stop-color="#8E1B1F"/><stop offset=".38" stop-color="#E5484D"/><stop offset=".55" stop-color="#F7A3A5"/><stop offset=".72" stop-color="#D93A3F"/><stop offset="1" stop-color="#7A1418"/></linearGradient>
            <linearGradient id="pinSide" x1="0" x2="1"><stop offset="0" stop-color="#9B1C21"/><stop offset=".45" stop-color="#E5484D"/><stop offset=".6" stop-color="#F48A8D"/><stop offset="1" stop-color="#861519"/></linearGradient>
            <radialGradient id="pinTop" cx=".38" cy=".35" r=".75"><stop offset="0" stop-color="#FF8A8E"/><stop offset=".55" stop-color="#E5484D"/><stop offset="1" stop-color="#B42328"/></radialGradient>
            <linearGradient id="pinSteel" x1="0" x2="1"><stop offset="0" stop-color="#6B7280"/><stop offset=".5" stop-color="#E5E7EB"/><stop offset="1" stop-color="#6B7280"/></linearGradient>
            <filter id="pinBlur" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="2.2"/></filter>
          </defs>
          <ellipse cx="44" cy="55" rx="14" ry="4.5" transform="rotate(-12 44 55)" fill="rgba(15,23,42,.14)" filter="url(#pinBlur)"/><ellipse cx="36" cy="59.5" rx="7" ry="1.8" fill="rgba(15,23,42,.3)" filter="url(#pinBlur)"/>
          <g transform="rotate(-22 30 58)">
            <rect x="28.9" y="42" width="2.4" height="17" rx="1.2" fill="url(#pinSteel)"/>
            <ellipse cx="30" cy="59" rx="2" ry=".9" fill="rgba(15,23,42,.45)"/>
            <ellipse cx="30" cy="42" rx="11" ry="3.8" fill="#8E1B1F"/>
            <path d="M19 40.5a11 3.8 0 0 0 22 0v1.6a11 3.8 0 0 1-22 0z" fill="url(#pinSide)"/>
            <ellipse cx="30" cy="40.5" rx="11" ry="3.8" fill="#D93A3F"/>
            <rect x="25" y="22" width="10" height="18.5" fill="url(#pinNeck)"/>
            <path d="M15 17v5.5a15 5.5 0 0 0 30 0V17z" fill="url(#pinSide)"/>
            <ellipse cx="30" cy="17" rx="15" ry="5.5" fill="url(#pinTop)"/>
            <ellipse cx="25" cy="15.3" rx="5.5" ry="1.6" fill="#fff" opacity=".55"/>
          </g>
        </svg>
        <header class="asg-note-h"><b>老師指派</b><span class="asg-count">${asgPending.length}</span></header>
        <ol class="asg-list">${rows}</ol>
      </section>`;
  } else if (nextRow) {
    const lead = { retake: '需要補考', todo: '待檢討', open: '下一個單元' }[nextRow.k];
    app.querySelector('#next-slot').innerHTML = `<a class="next-card ${nextRow.k}" href="#/u/${esc(nextRow.u.id)}">
        <span class="nc-ic">${nextRow.ic}</span>
        <span class="nc-txt"><span class="nc-lead">${lead}</span><b class="en" lang="en">${esc(nextRow.u.title)}</b></span>
        <span class="nc-go">${icon.arrowR}</span>
      </a>`;
  }
  app.querySelector('.hero.cover')?.classList.toggle('no-next', !app.querySelector('#next-slot').innerHTML.trim());
  // 還沒有任何進度時不顯示「已完成 0 / N」，第一屏只留下一步要做什麼
  app.querySelector('#progress-slot').innerHTML = nOk || nTodo || nMiss
    ? `<a class="hp-link" href="#/me">已完成 ${nOk} / ${visible.length}${nTodo ? ` · 待檢討 ${nTodo}` : ''}${nMiss ? ` · 缺交 ${nMiss}` : ''} ${icon.arrowR}</a>` : '';
  // 指派作業只在最上面的主卡出現一次；下面的單元列表照課次排，指派的單元卡片上加一個小標籤（不再另外分一段，避免同一個單元出現兩次）
  const asgOf = new Map(asg.map((a) => [a.u.id, a]));
  // 課次多時：最上面一排課次快速跳轉（全部完成的課打勾）；全部完成的課收合起來（點標題展開），還要做的課比較好找
  const doneLesson = (n) => visible.filter((u) => u.lesson === n).every((u) => unitStatus(u).k === 'ok');
  const jump = lessons.length >= 4
    ? `<nav class="lesson-jump" aria-label="跳到課次">${lessons.map((n) => `<button type="button" data-jump="${esc(String(n))}" class="${doneLesson(n) ? 'done' : ''}">${doneLesson(n) ? icon.check : ''}${esc(lessonLabel(n))}</button>`).join('')}</nav>`
    : '';
  host.innerHTML = jump + lessons.map((n) => {
    const units = visible.filter((u) => u.lesson === n);
    if (!units.length) return '';
    const grid = `<div class="unit-grid">${units.map((u) => tileHTML(u, asgOf.get(u.id))).join('')}</div>`;
    if (doneLesson(n) && !asg.some((a) => a.u.lesson === n)) {
      return `<details class="lesson lesson-done" data-lesson="${esc(String(n))}">
      <summary class="lesson-head">${icon.book}<span>${lessonHeading(n)}</span><span class="lesson-ok">${icon.check}${units.length}</span></summary>
      ${grid}
    </details>`;
    }
    return `<section class="lesson" data-lesson="${esc(String(n))}">
      <h2 class="lesson-head">${icon.book}<span>${lessonHeading(n)}</span></h2>
      ${grid}
    </section>`;
  }).join('');
  host.querySelector('.lesson-jump')?.addEventListener('click', (e) => {
    const b = e.target.closest('[data-jump]'); if (!b) return;
    const sec = [...host.querySelectorAll('[data-lesson]')].find((x) => x.dataset.lesson === b.dataset.jump); if (!sec) return;
    if (sec.tagName === 'DETAILS') sec.open = true;
    sec.scrollIntoView({ behavior: reduceMotion.matches ? 'auto' : 'smooth', block: 'start' });
  });
  try { localStorage.removeItem('b5p:filter'); } catch { /* ignore */ } // 「全部／現在要做的」篩選已拿掉（主卡與老師指派已經告訴學生先做什麼）
}

// 開放時段：放在卡片說明列的純文字（還沒開放、快截止、已截止）
function windowText(id, done) {
  const w = unitWindow(config, id);
  if (w.state === 'before') return `${fmtWhen(w.openAt)} 開放`;
  if (w.state === 'after') return done ? '' : '已截止';
  return w.closeAt ? `${w.extended ? '補作到' : '截止'} ${fmtWhen(w.closeAt)}` : '';
}

// 單字卡片的說明：類型一行、字數一行。基礎 → 進階 → 精熟每張都一樣，不寫（單元頁有）；老師關掉某些階段時才寫出有哪幾段
function vocabCount(u, levels) {
  const n = Number(u.count) || 0;
  const ph = typeof u.phrases === 'number' ? Math.min(u.phrases, n) : null;
  const counts = ph == null ? `${n} 個單字與片語` : ph ? `${n - ph} 個單字 · ${ph} 個片語` : `${n} 個單字`;
  const partial = levels.join('、') !== LEVELS.map((l) => l.name).join('、') ? ` · ${levels.join('、')}` : '';
  return `${counts}${partial}`;
}

function tileMeta(u) {
  return `${u.count} 題`;
}

// 卡片狀態：狀態標籤放最前面（文字＋圖示，用標籤的顏色區分），標題與主題第二；類型與字數、最佳成績與時段收在下面。
// 「下一步」只由首頁上方的大卡片表達，格子裡不再重複標記。
const TILE_STATE = { ok: '已完成', retake: '需補考', todo: '待檢討', miss: '缺交', wait: '未開放', open: '尚未開始' };
// 卡片、指派、我的成績、搜尋共用的三個零件：成績環（分數只寫在這裡）、狀態標籤、時段文字
// 主題（後台匯入內容時填的，課文理解沒填就是文章標題）：空白、跟標題或類型名稱一樣就不顯示
function topicOf(u) {
  const topic = String(u.topic || '').trim();
  return topic && ![String(u.title || '').trim(), TYPES[typeOf(u.type)].tile, typeLabel(u.type)].some((x) => String(x || '').toLowerCase() === topic.toLowerCase()) ? topic : '';
}
function bestOf(u) { return store.best(u.id)[bestKey(u.type)]; }
function ringHTML(u, cls = '') {
  const b = bestOf(u);
  cls = `${cls} k-${unitStatus(u).k}`;
  return b != null
    ? `<span class="tile-ring has ${cls}" style="--p:${Math.max(0, Math.min(100, b))}" role="img" aria-label="最佳 ${b}%"><b>${b}</b></span>`
    : `<span class="tile-ring ${cls}" aria-hidden="true">${typeIcon(u.type)}</span>`;
}
function chipHTML(u, st = unitStatus(u)) {
  if (st.k === 'open') return '';
  const b = bestOf(u);
  const text = st.k === 'retake' && b != null && b < PASS ? `需補考 · 差 ${PASS - b}%` : TILE_STATE[st.k];
  return `<span class="u-chip k-${st.k}">${st.ic}${esc(text)}</span>`;
}
function whenText(u, st = unitStatus(u)) { return st.k === 'miss' ? '已截止 · 找老師補作' : windowText(u.id, store.done(u.id)); }

function tileHTML(u, asg = null) {
  const vocab = u.type === 'vocab';
  const st = unitStatus(u);
  const topicShown = topicOf(u);
  const when = st.k === 'miss' ? '' : whenText(u, st);
  const count = vocab ? vocabCount(u, openLevels(u).map((l) => l.name)) : tileMeta(u);
  // 卡片：成績環｜標題、主題、下方一列標籤（狀態、指派、時段、題數）｜箭頭。標題放最上面，狀態放下面，高度不因狀態改變
  const foot = [
    chipHTML(u, st),
    asg ? `<span class="tile-asg${asgDone(asg) ? ' done' : ''}">${icon.pin}指派</span>` : '',
    when ? `<span class="tile-when">${esc(when)}</span>` : '',
    `<span class="tile-count">${esc(count)}</span>`,
  ].join('');
  return `<a data-id="${esc(u.id)}" class="unit-tile ${vocab ? 't-vocab' : 't-reading'} ty-${typeOf(u.type)} st-${st.k}" href="#/u/${esc(u.id)}">
      ${ringHTML(u)}<span class="tile-body">
      <h3 class="en" lang="en">${esc(u.title)}</h3>
      ${topicShown ? `<p class="tile-topic en" lang="en">${esc(topicShown)}</p>` : ''}
      <span class="tile-foot">${foot}</span>
      </span>
      <span class="tile-go" aria-hidden="true">${icon.arrowR}</span>
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
  const sub = vocab ? [words.length - phrases ? `單字 ${words.length - phrases} 個` : '', phrases ? `片語 ${phrases} 個` : ''].filter(Boolean).join(' · ')
    : ''; // 課文、句型的題數與篇幅放在下面的數字卡，標題下不重複
  return `<div class="unit-head"${markAttr(meta)}>
      <div class="eyebrow">${typeIcon(meta.type)}${lessonLabel(meta.lesson)} · ${TYPES[typeOf(meta.type)].tile}</div>
      <h1>${esc(meta.title)}</h1>
      ${sub ? `<div class="sub"><span>${sub}</span></div>` : ''}
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

  const t0 = performance.now();
  app.innerHTML = unitShellHTML(meta); // 先顯示標題外框（版面和正式標題一致），資料到了再換成完整頁面
  // 剛登入時紀錄還在背景載入：等它載完（最多幾秒），才不會把做過的單元當成沒做過
  const [data, mod, rawAnalysis] = await Promise.all([loadUnit(meta.id, config), modes[typeOf(meta.type)](), meta.type === 'vocab' ? loadAnalysis(meta.id) : null, historyReady()]);
  // 分析結果要和目前的題目對得上（簽章相同）才用
  const analysis = rawAnalysis && rawAnalysis.sig === analysisSig(data.words) ? rawAnalysis : null;
  // 題目要等網路（換頁轉場已經先換到「載入中」）：內容到了用跟換頁一樣的淡入接上，不會突然跳出來
  const late = performance.now() - t0 > 140 && !reduceMotion.matches;
  queueMicrotask(() => { if (late) app.querySelector('.focus')?.classList.add('late-in'); });

  if (meta.type !== 'vocab') {
    if (!modeOn(config, meta.id, meta.type)) { locked(meta); return; }
    document.title = `${meta.title} — B5 Practice`;
    app.innerHTML = `<div class="focus${meta.type === 'reading' ? ' wide' : ''}">${headHTML(meta, data)}<section id="stage"></section></div>`;
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
  if (done && store.reviewed(u.id)) return { k: 'ok', rank: 4, st: best != null ? `${best}%` : '已完成', note: '', ic: icon.check };
  // 做過正式測驗但沒通過：需要補考（缺交的判斷之前先處理）
  if (!done && store.tried(u.id)) return { k: 'retake', rank: 0, st: '需補考', note: `${best != null ? `${best}% · 差 ${PASS - best}%` : ''}${w.state === 'after' ? `${best != null ? ' · ' : ''}已截止，找老師補作` : ''}`, ic: icon.alert };
  if (done) return { k: 'todo', rank: 1, st: '待檢討', note: best != null ? `${best}%` : '', ic: icon.bulb };
  if (w.state === 'after') return { k: 'miss', rank: 0, st: '缺交', note: '找老師補作', ic: icon.alert };
  if (w.state === 'before') return { k: 'wait', rank: 5, st: '未開放', note: `${fmtWhen(w.openAt)} 開放`, ic: icon.lock };
  return { k: 'open', rank: 2, st: '尚未開始', note: w.closeAt ? `${w.extended ? '補作到' : '截止'} ${fmtWhen(w.closeAt)}` : '', ic: icon.play };
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
  // 不先放一整頁「載入中」（換頁時會變成一片白）：最新紀錄 0.12 秒內到就直接畫；還沒到就先用這台裝置上的紀錄畫出來，到了再自動更新
  let fresh = false;
  await Promise.race([historyReady().then(() => { fresh = true; }), new Promise((r) => setTimeout(r, 120))]);
  if (!fresh) historyReady().then(() => { if ((location.hash.split('/')[1] || '') === 'me' && document.body.contains(app.querySelector('.me-updating'))) renderMe(); });
  const rows = visibleUnits().map((u) => ({ u, ...unitStatus(u) })).sort((a, b) => a.rank - b.rank || lessonCmp(a.u.lesson, b.u.lesson));
  const count = (k) => rows.filter((r) => r.k === k).length;
  app.innerHTML = `
    <section class="me-head">
      <div class="eyebrow">${esc(s.cls)} 班 ${esc(s.seat)} 號 · ${esc(maskName(s.name))}</div>
      <h1>我的成績${fresh ? '' : ' <span class="me-updating"><span class="spinner"></span>更新中…</span>'}</h1>
    </section>
    ${rejectedHTML(s)}
    <div class="me-sum">
      <div class="sum"><b>${count('ok')} / ${rows.length}</b><span>已完成</span></div>
      <div class="sum todo"><b>${count('todo')}</b><span>待檢討</span></div>
      <div class="sum retake"><b>${count('retake')}</b><span>需補考</span></div>
      <div class="sum miss"><b>${count('miss')}</b><span>缺交</span></div>
    </div>
    ${rows.length ? `<div class="me-list">${rows.map((r) => `<a class="me-row ${r.k}" href="#/u/${esc(r.u.id)}">
        ${ringHTML(r.u, 'sm')}
        <span class="txt"><b>${esc(unitName(r.u))}</b><span>${[typeLabel(r.u.type), whenText(r.u, r)].filter(Boolean).map(esc).join(' · ')}</span></span>
        ${chipHTML(r.u, r) || '<span class="u-chip k-open">尚未開始</span>'}</a>`).join('')}</div>`
      : `<div class="empty"><div class="big">${icon.inbox}</div><h2>還沒有開放的單元</h2></div>`}`;
}

/* ---------------- 帳號（底部分頁列的頭像） ---------------- */
// 帳號頁最下面：這個畫面的版本號與部署時間；伺服器上有更新的版本時，提示點一下更新
async function paintVersion(el) {
  if (!el) return;
  try {
    const { loaded, latest } = await import('./update.js').then((m) => m.versionInfo());
    if (!el.isConnected || !loaded) return;
    const d = new Date(loaded.t);
    const p = (n) => String(n).padStart(2, '0');
    const when = isNaN(d) ? '' : ` · ${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
    el.textContent = `${loaded.n ? `v${loaded.n}` : `版本 ${loaded.v.slice(0, 7)}`}${when}`;
    if (latest && latest.v !== loaded.v) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'acct-ver-up'; b.textContent = '有新版本，點這裡更新';
      b.addEventListener('click', () => location.reload());
      el.append(' ', b);
    }
  } catch { /* 讀不到就不顯示 */ }
}

function renderAccount() {
  const s = store.student();
  if (!s) { location.replace('#/'); return; }
  document.title = '帳號 — B5 Practice';
  app.innerHTML = `
    <section class="me-head acct-head">
      <span class="acct-av" aria-hidden="true">${esc((s.name || '?').trim().charAt(0))}</span>
      <div class="acct-id">
      <h1>${esc(maskName(s.name))}</h1>
      <p class="muted" style="margin:0">${esc(s.cls)} 班 ${esc(s.seat)} 號</p></div>
      <div class="acct-acts">
        <button class="acct-btn" type="button" data-switch>${icon.user}<span>切換學生</span></button>
      </div>
    </section>
    <section class="me-set" aria-label="學習設定">
      <h2>學習設定</h2>
      <div class="set-row">
        <div class="set-txt"><b>句型說明</b></div>
        <div class="set-seg" role="radiogroup" aria-label="句型說明的看法">
          <button type="button" role="radio" data-learn="find">${icon.target}<span>邊看邊找</span><small>自己劃出句型的每一塊</small></button>
          <button type="button" role="radio" data-learn="read">${icon.book}<span>直接看說明</span><small>例句直接標好顏色</small></button>
        </div>
      </div>
      <div class="set-row inline">
        <div class="set-txt"><b>自動下一題</b></div>
        <button class="switch" type="button" role="switch" data-auto aria-label="自動下一題"><span class="sw" aria-hidden="true"></span></button>
      </div>
      <p class="set-saved" aria-live="polite"></p>
    </section>
    <button class="acct-out" type="button" data-logout title="登出並清除這台裝置的資料">${icon.exit}<span>登出</span></button>
    <p class="acct-ver" aria-live="polite"></p>`;
  bindAccount(app);
  paintVersion(app.querySelector('.acct-ver'));
  // 學習設定：句型說明的看法存在學生帳本（換裝置也記得），自動下一題存在這台裝置
  const lp = learnPrefs();
  const saved = app.querySelector('.set-saved');
  const say = (t) => { saved.textContent = t; clearTimeout(say.t); say.t = setTimeout(() => { saved.textContent = ''; }, 2000); };
  const paintLearn = () => app.querySelectorAll('[data-learn]').forEach((b) => b.setAttribute('aria-checked', String(lp.get('learnMode') === b.dataset.learn)));
  app.querySelectorAll('[data-learn]').forEach((b) => b.addEventListener('click', () => { lp.set('learnMode', b.dataset.learn); paintLearn(); say('✓ 已儲存'); }));
  paintLearn();
  // 自動下一題也存在學生帳本：所有裝置都套用
  const auto = app.querySelector('[data-auto]');
  const paintAuto = () => auto.setAttribute('aria-checked', String(lp.get('auto')));
  auto.addEventListener('click', () => { lp.set('auto', !lp.get('auto')); paintAuto(); say('✓ 已儲存'); });
  setTimeout(paintAuto, 1500); // 剛從雲端讀到別的裝置改過的設定時更新
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
  // 學習設定（自動下一題、句型說明看法）跟雲端同步：別的裝置改過的，這台也套用
  afterLoad(() => idle(() => { if (store.student()) learnPrefs(); }));
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
  window.addEventListener('popstate', (e) => { uaSwiped = !!e.hasUAVisualTransition; });
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
  // 切換學生：同一頁換成另一位學生的資料，用交叉淡化接上（登出時沒有學生了，直接回登入畫面）
  window.addEventListener('student-changed', () => { if (document.body.dataset.busy) return; if (store.student()) scene(() => route()); else route(); });
  // 登入後在背景載入的紀錄到了：首頁的完成狀態、最佳成績跟著更新（不打斷作答）
  window.addEventListener('history-applied', () => { if (!document.body.dataset.busy && ['', 'me'].includes(location.hash.split('/')[1] || '')) route(); });
  route();
  // 隔了很久再打開（學校共用平板、借同學的手機）：先確認是不是同一個人，避免用別人的帳號作答
  const SEEN = 'b5p:seen', AWAY = 5 * 3600 * 1000;
  const touch = () => { try { localStorage.setItem(SEEN, String(Date.now())); } catch { /* ignore */ } };
  const checkWho = async () => {
    const s = store.student();
    let last = 0; try { last = Number(localStorage.getItem(SEEN)) || 0; } catch { /* ignore */ }
    touch();
    if (!s || !last || Date.now() - last < AWAY || document.body.dataset.busy || document.querySelector('dialog[open]')) return;
    clearWhoOk(); // 隔很久了：之前的確認不算數
    const me = await confirmDialog({ title: `你是 ${maskName(s.name)} 嗎？`, body: `${esc(s.cls)} 班 ${esc(s.seat)} 號`, ok: '是我', cancel: '換人' });
    if (me) markWhoOk(); else openStudentDialog(() => window.dispatchEvent(new Event('student-changed')));
  };
  checkWho();
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkWho(); else touch(); });
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
