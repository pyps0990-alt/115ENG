import { loadIndex, loadUnit, applyImported, addCustomUnits } from './data.js';
import { getConfig, unitVisible, modeOn, questionCount } from './remote-config.js';
import { store } from './storage.js';
import { esc } from './util.js';
import { icon } from './icons.js';
import { renderStudentChip, mountInlineForm } from './student.js';
import { SCRIPT_URL, ADMIN_URL } from './config.js';
import { LEVELS, PASS } from './levels.js';
import * as vocab from './modes/vocab.js';
import * as reading from './modes/reading.js';
import { initNav, updateNav } from './nav.js';
import { flushOutbox } from './submit.js';
import { loadHistory, watchStaff, staffSignIn, staffSignOut, importRoster } from './firebase.js';

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
  const [, kind, id, sub] = location.hash.split('/').map(decodeURIComponent);
  window.scrollTo(0, 0);
  // 還沒確認身分：隱藏單元選單，單元網址一律導回首頁填資料
  const loggedIn = !!store.student();
  document.getElementById('nav-menu').hidden = !loggedIn || !visibleUnits().length;
  if (kind === 'u' && !loggedIn) { location.replace('#/'); return; }
  updateNav(kind === 'u' && id ? (findUnit(id) || {}).id : null);
  try {
    if (kind === 'u' && id) await renderUnit(id, sub);
    else if (kind === 'teacher') renderTeacher();
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
  return `<a class="unit-tile ${vocab ? 't-vocab' : 't-reading'}" href="#/u/${esc(u.id)}">
      <div class="tile-top">
        <span class="tile-icon">${vocab ? icon.cards : icon.book}</span>
        <span class="tile-kind">${vocab ? '單字片語測驗' : '課文理解'}</span>
        ${done ? `<span class="badge done">${icon.check} 已完成 · 可複習</span>` : ''}
        ${u.sample ? '<span class="badge">範例</span>' : ''}
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
  document.getElementById('site-foot').innerHTML = '<span>B5 Practice · 內湖高中英文科</span><a href="#/teacher">老師登入</a>';
}

/* ---------------- teacher ---------------- */
// 老師用 Google 帳號登入；Firestore 的 admins 名單內才顯示後台連結與名單匯入。
// 真正的權限由 Firestore 規則與 Apps Script 後台的帳號檢查把關，這裡只負責顯示。
function parseRoster(text) {
  return text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((line, i) => {
    const [seatRaw = '', ...rest] = line.split(/[\t,，\s]+/);
    const seat = seatRaw.replace(/^0+(?=\d)/, '');
    const name = rest.join('');
    const ok = /^\d{1,2}$/.test(seat) && !!name;
    return { line: i + 1, seat, name, ok };
  });
}

function renderTeacher() {
  document.title = '老師登入 — B5 Practice';
  app.innerHTML = '<div class="loading"><span class="spinner"></span>確認登入狀態…</div>';
  const admin = ADMIN_URL || SCRIPT_URL;
  cleanup = watchStaff((staff) => {
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
        <div class="btn-row">
          ${admin ? `<a class="btn primary" href="${esc(admin)}" target="_blank" rel="noopener">開啟老師後台 ${icon.arrowR}</a>` : ''}
          <button class="btn ghost" type="button" data-out>登出</button>
        </div>
      </section>
      <section class="card teacher">
        <div class="eyebrow">Roster</div><h2>匯入學生名單</h2>
        <p class="muted">每行一位學生：<b>座號　姓名</b>（用 Tab、空白或逗號隔開，可從試算表直接複製兩欄貼上）。學生要輸入跟名單完全一樣的班級、座號、姓名才能登入。重複匯入同一位學生不會產生重複資料；改名字要重新匯入，舊名字仍可登入，需要停用請到 Firebase 主控台刪除。</p>
        <div class="form-grid">
          <div class="field"><label for="ro-cls">班級</label><input id="ro-cls" inputmode="numeric" maxlength="4" placeholder="例：306"></div>
        </div>
        <textarea id="ro-text" class="roster-text" spellcheck="false" placeholder="1	王偉同&#10;3	吳雨哲"></textarea>
        <div class="btn-row"><button class="btn primary" type="button" data-import>匯入</button><span class="form-err" data-msg aria-live="polite"></span></div>
        <div data-report></div>
      </section>`;
    app.querySelector('[data-out]').onclick = () => staffSignOut();
    app.querySelector('[data-import]').onclick = async (e) => {
      const btn = e.currentTarget;
      const msg = app.querySelector('[data-msg]');
      const cls = app.querySelector('#ro-cls').value.trim();
      if (!/^\d{3,4}$/.test(cls)) { msg.textContent = '班級請填 3～4 位數字'; return; }
      const rows = parseRoster(app.querySelector('#ro-text').value);
      const good = rows.filter((r) => r.ok);
      app.querySelector('[data-report]').innerHTML = `<table class="roster-report"><thead><tr><th>行</th><th>座號</th><th>姓名</th><th>狀態</th></tr></thead><tbody>${
        rows.map((r) => `<tr><td>${r.line}</td><td>${esc(r.seat)}</td><td>${esc(r.name)}</td><td>${r.ok ? '✓' : '✗ 座號或姓名格式錯誤'}</td></tr>`).join('')}</tbody></table>`;
      if (!good.length) { msg.textContent = '沒有可匯入的資料'; return; }
      btn.disabled = true;
      msg.textContent = `匯入中…（${good.length} 位）`;
      try {
        await importRoster(cls, good);
        msg.textContent = `✓ 已匯入 ${good.length} 位${rows.length > good.length ? `，${rows.length - good.length} 行格式錯誤未匯入` : ''}`;
      } catch (err) {
        msg.textContent = `匯入失敗：${err.message}`;
      } finally {
        btn.disabled = false;
      }
    };
  });
}

/* ---------------- boot ---------------- */
async function boot() {
  // 舊版只存在裝置上、沒有跟老師名單確認過的學生資料：要求重新登入
  const saved = store.student();
  if (saved && !saved.key) { store.setStudent(null); store.resetProgress(); }
  renderStudentChip();
  renderFooter();
  try {
    [index, config] = await Promise.all([loadIndex(), getConfig()]);
    addCustomUnits(index, config);
    applyImported(index, config);
  } catch (err) {
    app.innerHTML = `<div class="empty"><div class="big bad">${icon.alertCircle}</div><p>無法載入課程資料（${esc(err.message)}）。<br>請用網頁伺服器開啟，不能直接雙擊 index.html。</p></div>`;
    return;
  }
  initNav(visibleUnits());
  // 之前沒送成功的成績：開站時與恢復連線時自動補送
  flushOutbox();
  window.addEventListener('online', () => flushOutbox());
  window.addEventListener('hashchange', route);
  window.addEventListener('student-changed', () => { if (!document.body.dataset.busy) route(); });
  route();
  // 以 Firestore 為準：每次進站重新讀取紀錄（例如在別台裝置做過的測驗）
  const s = store.student();
  if (s && s.key) {
    loadHistory(s.key).then((h) => {
      store.applyHistory(h);
      if (!document.body.dataset.busy) route();
    }).catch(() => { /* 離線時沿用裝置上的紀錄 */ });
  }
}

boot();
