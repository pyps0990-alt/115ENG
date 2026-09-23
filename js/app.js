import { loadIndex, loadUnit, KIND_LABEL } from './data.js';
import { getConfig, unitVisible, modeOn, examState } from './remote-config.js';
import { store, weakWords } from './storage.js';
import { esc } from './util.js';
import { icon } from './icons.js';
import { ttsSupported } from './tts.js';
import { renderStudentChip, mountInlineForm } from './student.js';
import { SCRIPT_URL, ADMIN_URL } from './config.js';

import * as list from './modes/list.js';
import * as flashcards from './modes/flashcards.js';
import * as mc from './modes/mc.js';
import * as spell from './modes/spell.js';
import * as match from './modes/match.js';
import * as vocabExam from './modes/exam.js';
import * as passage from './modes/passage.js';

const VOCAB_TABS = [
  { id: 'list', label: '單字表', icon: icon.list, mod: list },
  { id: 'flashcards', label: '單字卡', icon: icon.cards, mod: flashcards },
  { id: 'mc', label: '選擇題', icon: icon.target, mod: mc },
  { id: 'spell', label: '拼字・克漏字', icon: icon.pencil, mod: spell },
  { id: 'match', label: '配對遊戲', icon: icon.puzzle, mod: match },
  { id: 'exam', label: '正式測驗', icon: icon.trophy, mod: vocabExam },
];
const PASSAGE_TABS = [
  { id: 'practice', label: '練習', icon: icon.book, mod: passage },
  { id: 'exam', label: '正式測驗', icon: icon.trophy, mod: passage },
];
const KIND_ICON = { vocab: icon.cards, reading: icon.book, grammar: icon.grammar, cloze: icon.blank };

const app = document.getElementById('app');
let index = null;
let config = null;
let cleanup = null;
const scopes = new Map();

/* ---------------- theme ---------------- */
function effectiveTheme() {
  const t = document.documentElement.dataset.theme;
  if (t) return t;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
function paintThemeBtn() {
  document.getElementById('theme-btn').innerHTML = effectiveTheme() === 'dark' ? icon.sun : icon.moon;
}
document.getElementById('theme-btn').addEventListener('click', () => {
  const next = effectiveTheme() === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  store.setTheme(next);
  paintThemeBtn();
});

/* ---------------- routing ---------------- */
function findUnit(id) {
  return index.units.find((u) => u.id === id || (u.aliases || []).includes(id));
}

async function route() {
  if (cleanup) { try { cleanup(); } catch { /* ignore */ } cleanup = null; }
  delete document.body.dataset.busy;
  const [, kind, id, mode] = location.hash.split('/').map(decodeURIComponent);
  window.scrollTo(0, 0);
  try {
    if (kind === 'u' && id) await renderUnit(id, mode);
    else renderHome();
  } catch (err) {
    console.error(err);
    app.innerHTML = `<div class="empty"><div class="big">😵</div><p>載入失敗：${esc(err.message)}</p><a class="btn" href="#/">回首頁</a></div>`;
  }
}

/* ---------------- home ---------------- */
function renderHome() {
  document.title = 'B5 Practice';
  const s = store.student();
  app.innerHTML = `
    <section class="hero stage-enter">
      <div class="eyebrow">高二英文 · ${esc(index.book || 'Book 5')}</div>
      <h1>B5 <span class="grad">Practice</span></h1>
      <p>單字、閱讀、文法、克漏字，一站練習。${s ? '' : '先填基本資料就可以開始。'}</p>
      ${s ? `<div class="hello">👋 嗨，${esc(s.name)}！今天練哪一課？</div>` : ''}
    </section>
    <div id="welcome-slot"></div>
    <div id="lessons"></div>`;

  if (!s) {
    mountInlineForm(app.querySelector('#welcome-slot'), {
      title: '輸入你的基本資料',
      desc: '不用登入。資料只存在這台裝置，正式測驗交卷時會一起送給老師。',
      onSave: () => renderHome(),
    });
  }

  const visible = index.units.filter((u) => unitVisible(config, u.id));
  const lessons = [...new Set(visible.map((u) => u.lesson))].sort((a, b) => a - b);
  const host = app.querySelector('#lessons');
  if (!visible.length) {
    host.innerHTML = '<div class="empty"><div class="big">📭</div><p>老師目前沒有開放任何單元。</p></div>';
    return;
  }
  host.innerHTML = lessons.map((n) => {
    const units = visible.filter((u) => u.lesson === n);
    return `<section class="lesson stage-enter">
      <div class="lesson-head"><span class="lnum">L${n}</span><div><h2>Lesson ${n}</h2><div class="muted">${units.length} 個單元</div></div></div>
      <div class="unit-grid">${units.map(tileHTML).join('')}</div>
    </section>`;
  }).join('');
}

function tileHTML(u) {
  const best = store.best(u.id);
  const bestPct = Object.values(best).length ? Math.max(...Object.values(best)) : null;
  let progress = bestPct ?? 0;
  const meta = [];
  if (u.type === 'vocab') {
    const k = store.known(u.id);
    const knownN = Object.values(k).filter((v) => v === 1).length;
    progress = u.count ? Math.round((knownN / u.count) * 100) : 0;
    meta.push(`熟悉 ${knownN}/${u.count}`);
  } else {
    meta.push(`${u.count} 題`);
  }
  if (bestPct != null) meta.push(`最佳 ${bestPct}%`);
  return `<a class="unit-tile k-${esc(u.kind)}" href="#/u/${esc(u.id)}">
      <div class="tile-icon">${KIND_ICON[u.kind] || icon.book}</div>
      <div class="tile-body">
        <div class="tile-kind">${KIND_LABEL[u.kind] || ''}</div>
        <h3>${esc(u.title)}</h3>
        ${u.subtitle ? `<div class="tile-sub">${esc(u.subtitle)}</div>` : ''}
        <div class="bar"><span style="width:${progress}%"></span></div>
        <div class="tile-meta">${meta.map((m) => `<span>${esc(m)}</span>`).join('')}</div>
      </div>
      ${u.sample ? '<span class="badge">範例</span>' : ''}
    </a>`;
}

/* ---------------- unit ---------------- */
async function renderUnit(id, modeId) {
  const meta = findUnit(id);
  if (!meta || !unitVisible(config, meta.id)) {
    app.innerHTML = '<div class="empty"><div class="big">🔒</div><p>找不到這個單元，或老師目前沒有開放。</p><a class="btn" href="#/">回首頁</a></div>';
    return;
  }
  if (meta.id !== id) { location.replace(`#/u/${meta.id}${modeId ? `/${modeId}` : ''}`); return; }

  app.innerHTML = '<div class="loading"><span class="spinner"></span>載入中…</div>';
  const data = await loadUnit(meta.id);
  const tabs = (meta.type === 'vocab' ? VOCAB_TABS : PASSAGE_TABS).filter((t) => modeOn(config, meta.id, t.id));
  if (!tabs.length) {
    app.innerHTML = '<div class="empty"><div class="big">🔒</div><p>老師目前沒有開放這個單元的練習。</p><a class="btn" href="#/">回首頁</a></div>';
    return;
  }
  const tab = tabs.find((t) => t.id === modeId) || tabs[0];
  document.title = `${meta.title} · ${tab.label} — B5 Practice`;
  const exam = examState(config, meta.id);

  const allWords = data.words || [];
  const countText = meta.type === 'vocab' ? `${allWords.length} 個單字` : `${(data.questions || []).length} 題`;
  app.innerHTML = `
    <div class="unit-head">
      <a class="back" href="#/">${icon.back} 所有單元</a>
      <div class="eyebrow">Lesson ${meta.lesson} · ${KIND_LABEL[meta.kind] || ''}</div>
      <h1>${esc(meta.title)}</h1>
      <div class="sub"><span>${esc(countText)}</span>${data.sample ? '<span class="badge">範例資料</span>' : ''}</div>
    </div>
    <nav class="tabs" aria-label="練習模式">
      ${tabs.map((t) => `<a class="tab ${t.id === tab.id ? 'active' : ''}" href="#/u/${meta.id}/${t.id}" ${t.id === tab.id ? 'aria-current="page"' : ''}>
        ${t.icon}<span>${t.label}</span>${t.id === 'exam' && !exam.open ? '<span class="lock">🔒</span>' : ''}</a>`).join('')}
    </nav>
    <div id="scope-slot"></div>
    <section id="stage"></section>`;
  app.querySelector('.tab.active')?.scrollIntoView({ block: 'nearest', inline: 'center' });

  const stage = app.querySelector('#stage');
  const scopeSlot = app.querySelector('#scope-slot');
  const useScope = meta.type === 'vocab' && tab.id !== 'exam';

  const mount = () => {
    if (cleanup) { try { cleanup(); } catch { /* ignore */ } cleanup = null; }
    let words = allWords;
    if (useScope) {
      const scope = scopes.get(meta.id) || 'all';
      renderScope(scopeSlot, meta, data, scope, (next) => { scopes.set(meta.id, next); mount(); });
      if (scope === 'weak') words = weakWords(meta.id, allWords);
      else if (scope.startsWith('p')) words = allWords.filter((w) => String(w.part) === scope.slice(1));
    }
    stage.innerHTML = '';
    stage.className = 'stage-enter';
    const ctx = {
      unit: meta, data, allWords, words, config, mode: tab.id, exam,
      remount: mount,
      setScope: (s) => { scopes.set(meta.id, s); },
      go: (m) => { location.hash = `#/u/${meta.id}/${m}`; },
    };
    cleanup = tab.mod.mount(stage, ctx) || null;
  };
  mount();
}

function renderScope(slot, meta, data, scope, onChange) {
  const all = data.words || [];
  const weak = weakWords(meta.id, all).length;
  const parts = data.parts ? Object.entries(data.parts) : [];
  const items = [
    ['all', '全部', all.length],
    ...parts.map(([k, label]) => [`p${k}`, label, all.filter((w) => String(w.part) === k).length]),
    ['weak', '待加強', weak],
  ];
  slot.innerHTML = `<div class="scope" role="group" aria-label="練習範圍">${items.map(([k, label, n]) =>
    `<button type="button" data-k="${k}" class="${k === scope ? 'on' : ''}" aria-pressed="${k === scope}">${esc(label)} <span class="n">${n}</span></button>`).join('')}</div>`;
  slot.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => onChange(b.dataset.k)));
}

/* ---------------- footer ---------------- */
function renderFooter() {
  const admin = ADMIN_URL || SCRIPT_URL;
  const foot = document.getElementById('site-foot');
  foot.innerHTML = `<span>B5 Practice · 內湖高中英文科</span>${admin ? `<a href="${esc(admin)}" target="_blank" rel="noopener">老師後台</a>` : ''}`;
}

/* ---------------- boot ---------------- */
async function boot() {
  paintThemeBtn();
  if (!ttsSupported) document.body.classList.add('no-tts');
  renderStudentChip();
  renderFooter();
  try {
    [index, config] = await Promise.all([loadIndex(), getConfig()]);
  } catch (err) {
    app.innerHTML = `<div class="empty"><div class="big">😵</div><p>無法載入課程資料（${esc(err.message)}）。<br>請用網頁伺服器開啟，不能直接雙擊 index.html。</p></div>`;
    return;
  }
  window.addEventListener('hashchange', route);
  window.addEventListener('student-changed', () => {
    if (!document.body.dataset.busy) route();
  });
  route();
}

boot();
