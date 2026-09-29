import { loadIndex, loadUnit, applyImported, addCustomUnits } from './data.js';
import { getConfig, watchConfig, unitVisible, modeOn, questionCount, unitWindow, fmtWhen } from './remote-config.js';
import { store } from './storage.js';
import { esc, confirmDialog } from './util.js';
import { icon } from './icons.js';
import { renderStudentChip, mountInlineForm } from './student.js';
import { LEVELS, PASS } from './levels.js';
import * as vocab from './modes/vocab.js';
import * as reading from './modes/reading.js';
import { initNav, updateNav } from './nav.js';
import { flushOutbox } from './submit.js';
// Firebase 程式庫很大，只在需要時才載入（登入、讀紀錄、老師頁面），不拖慢首頁
const firebase = () => import('./firebase.js');

const app = document.getElementById('app');
let index = null;
let config = null;
let cleanup = null;

/* ---------------- routing ---------------- */
const findUnit = (id) => index.units.find((u) => u.id === id || (u.aliases || []).includes(id));

async function route() {
  if (cleanup) { try { cleanup(); } catch { /* ignore */ } cleanup = null; }
  delete document.body.dataset.busy;
  document.getElementById('fx').replaceChildren();
  // 首頁不顯示「#/」，網址保持乾淨（replaceState 不會再觸發 hashchange）
  if (location.hash === '#/' || location.hash === '#') history.replaceState(null, '', location.pathname + location.search);
  const [, kind, id, sub] = location.hash.split('/').map(decodeURIComponent);
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
  try {
    if (kind === 'u' && id) await renderUnit(id, sub);
    else if (kind === 'teacher') renderTeacher();
    else if (kind === 'privacy') renderPrivacy();
    else renderHome();
  } catch (err) {
    console.error(err);
    app.innerHTML = `<div class="empty"><div class="big bad">${icon.alertCircle}</div><p>載入失敗：${esc(err.message)}</p><a class="btn" href="#/">回首頁</a></div>`;
  }
}

const openLevels = (u) => LEVELS.filter((l) => modeOn(config, u.id, l.id));
const visibleUnits = () => index.units.filter((u) => unitVisible(config, u.id)
  && (u.type === 'reading' ? modeOn(config, u.id, 'reading') : openLevels(u).length))
  .sort((a, b) => a.lesson - b.lesson);

/* ---------------- home ---------------- */
function renderHome() {
  document.title = 'B5 Practice';
  const s = store.student();
  app.innerHTML = `
    <section class="hero">
      <div class="eyebrow">高二英文 · ${esc(index.book || 'Book 5')}</div>
      <h1>B5 Practice</h1>
      <p>單字片語連續挑戰基礎、進階、精熟三段，讀完課文再做閱讀測驗。</p>
      ${s ? `<p class="hello">${esc(s.name)}，今天從哪一課開始？</p>` : ''}
    </section>
    <div id="welcome-slot"></div>
    <div id="lessons"></div>`;

  // 還沒確認身分：只顯示基本資料表單，確認後才載入單元與這位學生的紀錄
  if (!s) {
    mountInlineForm(app.querySelector('#welcome-slot'), {
      title: '輸入你的基本資料',
      desc: '填寫班級、座號和姓名，要跟老師的名單一致。確認後會載入你之前的測驗紀錄。',
      button: '確認',
      onSave: () => renderHome(),
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
  return w.closeAt ? `<span class="badge time">${icon.clock} 截止 ${fmtWhen(w.closeAt)}</span>` : '';
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
    status = best.reading == null ? '<span class="lv-pill">尚未作答</span>' : pillHTML('最佳', best.reading);
  }
  const stages = openLevels(u).map((l) => l.name).join(' → ');
  const done = store.done(u.id);
  return `<a data-id="${esc(u.id)}" class="unit-tile ${vocab ? 't-vocab' : 't-reading'}" href="#/u/${esc(u.id)}">
      <div class="tile-top">
        <span class="tile-icon">${vocab ? icon.cards : icon.book}</span>
        <span class="tile-kind">${vocab ? '單字片語測驗' : '課文理解'}</span>
        ${done && !store.reviewed(u.id) ? `<span class="badge todo">${icon.bulb} 待檢討</span>` : ''}
        ${done && store.reviewed(u.id) ? `<span class="badge done">${icon.check} 已完成 · 可複習</span>` : ''}
        ${u.sample ? '<span class="badge">範例</span>' : ''}
        ${windowBadge(u.id, done)}
      </div>
      <h3 class="en">${esc(u.topic || u.title)}</h3>
      <div class="tile-meta">${vocab ? `${u.count} 個單字與片語 · ${stages}` : `一篇文章 · ${u.count} 題閱讀測驗`}</div>
      <div class="lv-row">${status}</div>
    </a>`;
}

/* ---------------- unit ---------------- */
function headHTML(meta, data) {
  const vocab = meta.type === 'vocab';
  const words = data.words || [];
  const phrases = words.filter((w) => w.type === 'phrase').length;
  const sub = vocab ? `單字 ${words.length - phrases} 個 · 片語 ${phrases} 個` : `${(data.questions || []).length} 題閱讀測驗`;
  return `<div class="unit-head">
      <a class="back" href="#/">${icon.back} 所有單元</a>
      <div class="eyebrow">Lesson ${meta.lesson} · ${vocab ? '單字片語測驗' : '課文理解'}</div>
      <h1>${esc(meta.title)}</h1>
      <div class="sub"><span class="en">${esc(meta.topic || '')}</span><span>${sub}</span>${data.sample ? '<span class="badge">範例資料</span>' : ''}</div>
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

  app.innerHTML = '<div class="loading"><span class="spinner"></span>載入中…</div>';
  const data = await loadUnit(meta.id, config);

  if (meta.type === 'reading') {
    if (!modeOn(config, meta.id, 'reading')) { locked(); return; }
    document.title = `${meta.title} — B5 Practice`;
    app.innerHTML = `${headHTML(meta, data)}<section id="stage"></section>`;
    cleanup = reading.mount(app.querySelector('#stage'), { unit: meta, data, config }) || null;
    return;
  }

  const levels = openLevels(meta);
  if (!levels.length) { locked(); return; }
  // 舊網址（#/u/l1-voc/basic 等）一律導回單元頁
  if (sub) { location.replace(`#/u/${meta.id}`); return; }
  document.title = `${meta.title} — B5 Practice`;
  app.innerHTML = `<div class="focus">${headHTML(meta, data)}<section id="stage"></section></div>`;
  cleanup = vocab.mount(app.querySelector('#stage'), {
    unit: meta, data, allWords: data.words || [], config, levels,
    questionCount: questionCount(config, meta.id),
  }) || null;
}

/* ---------------- footer ---------------- */
function renderFooter() {
  // 老師入口不放在學生畫面上，避免誤觸；老師直接開 #/teacher（存成書籤）
  document.getElementById('site-foot').innerHTML = '<span>B5 Practice · 內湖高中英文科</span><a href="#/privacy">隱私權說明</a>';
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
  setTimeout(redraw, 380);
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
    [base, config] = await Promise.all([loadIndex(), getConfig()]);
    build();
  } catch (err) {
    app.innerHTML = `<div class="empty"><div class="big bad">${icon.alertCircle}</div><p>無法載入課程資料（${esc(err.message)}）。<br>請用網頁伺服器開啟，不能直接雙擊 index.html。</p></div>`;
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
  // 之前沒送成功的成績：開站時與恢復連線時自動補送
  flushOutbox();
  window.addEventListener('online', () => flushOutbox());
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
