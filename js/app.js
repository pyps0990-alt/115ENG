import { loadIndex, loadUnit, applyImported } from './data.js';
import { getConfig, unitVisible, modeOn, questionCount } from './remote-config.js';
import { store } from './storage.js';
import { esc } from './util.js';
import { icon } from './icons.js';
import { ttsSupported } from './tts.js';
import { renderStudentChip, mountInlineForm } from './student.js';
import { SCRIPT_URL, ADMIN_URL } from './config.js';
import { LEVELS, PASS } from './levels.js';
import * as vocab from './modes/vocab.js';
import * as reading from './modes/reading.js';
import { initNav, updateNav } from './nav.js';

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
  updateNav(kind === 'u' && id ? (findUnit(id) || {}).id : null);
  try {
    if (kind === 'u' && id) await renderUnit(id, sub);
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

  if (!s) {
    mountInlineForm(app.querySelector('#welcome-slot'), {
      title: '輸入你的基本資料',
      desc: '不用登入。資料只存在這台裝置，測驗完成後會和成績一起送給老師。',
      onSave: () => renderHome(),
    });
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
  return `<a class="unit-tile ${vocab ? 't-vocab' : 't-reading'}" href="#/u/${esc(u.id)}">
      <div class="tile-top">
        <span class="tile-icon">${vocab ? icon.cards : icon.book}</span>
        <span class="tile-kind">${vocab ? '單字片語測驗' : '課文理解'}</span>
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
  const admin = ADMIN_URL || SCRIPT_URL;
  document.getElementById('site-foot').innerHTML = `<span>B5 Practice · 內湖高中英文科</span>${admin ? `<a href="${esc(admin)}" target="_blank" rel="noopener">老師後台</a>` : ''}`;
}

/* ---------------- boot ---------------- */
async function boot() {
  if (!ttsSupported) document.body.classList.add('no-tts');
  renderStudentChip();
  renderFooter();
  try {
    [index, config] = await Promise.all([loadIndex(), getConfig()]);
    applyImported(index, config);
  } catch (err) {
    app.innerHTML = `<div class="empty"><div class="big bad">${icon.alertCircle}</div><p>無法載入課程資料（${esc(err.message)}）。<br>請用網頁伺服器開啟，不能直接雙擊 index.html。</p></div>`;
    return;
  }
  initNav(visibleUnits());
  window.addEventListener('hashchange', route);
  window.addEventListener('student-changed', () => { if (!document.body.dataset.busy) route(); });
  route();
}

boot();
