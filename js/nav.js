// 導覽列的「選擇單元」下拉選單：任何頁面都能直接跳到各課的單字片語或課文理解
import { esc, confirmDialog } from './util.js';
import { icon } from './icons.js';
import { typeLabel, typeIcon, lessonLabel, lessonCmp } from './types.js';
import { leaveBody } from './resume.js';

const root = document.getElementById('nav-menu');
const btn = document.getElementById('unit-menu-btn');
const panel = document.getElementById('unit-menu');
let units = [];
// 選單打開時蓋在頁面上的暗幕（見 style.css 的 .menu-scrim）；點它會由下面的 document click 關閉選單
const scrim = document.createElement('div');
scrim.className = 'menu-scrim';
scrim.setAttribute('aria-hidden', 'true');
document.body.append(scrim);
const hl = () => panel.querySelector('.menu-hl');
// 滑過項目時，淡色底滑到那個項目；第一次出現時直接定位（不從頂端滑下來）
function moveHl(el) {
  const h = hl();
  if (!h) return;
  const first = !h.classList.contains('on');
  if (first) h.classList.add('snap');
  h.style.setProperty('--hl-y', `${el.offsetTop}px`);
  h.style.setProperty('--hl-h', `${el.offsetHeight}px`);
  h.classList.add('on');
  if (first) { h.getBoundingClientRect(); h.classList.remove('snap'); }
}

const kindLabel = (u) => typeLabel(u.type);
const isOpen = () => panel.classList.contains('open');
const items = () => [...panel.querySelectorAll('[role="menuitem"]')];

// 單元的完成狀態、最佳成績、缺交統一放在「我的成績與缺交」頁，這個選單只負責跳到各單元
export function refreshNavStatus() {}

function open() {
  refreshNavStatus();
  panel.classList.add('open'); // 展開／收合都由 CSS 的 transform 與 opacity 動畫處理（見 style.css「導覽列動畫」）
  scrim.classList.add('on');
  btn.setAttribute('aria-expanded', 'true');
  (panel.querySelector('.current') || items()[0])?.focus({ preventScroll: true });
}

function close(focusBtn = false) {
  if (!isOpen()) return;
  panel.classList.remove('open');
  scrim.classList.remove('on');
  hl()?.classList.remove('on');
  btn.setAttribute('aria-expanded', 'false');
  if (focusBtn) btn.focus({ preventScroll: true });
}

// visibleUnits：老師設定後仍開放的單元（依課次排序）
export function initNav(visibleUnits) {
  units = visibleUnits;
  const lessons = [...new Set(units.map((u) => u.lesson))].sort(lessonCmp);
  panel.innerHTML = `
    <a class="menu-item home" role="menuitem" href="#/">${icon.home}<span>所有單元</span></a>
    ${lessons.map((n) => `<div class="menu-group" role="group" aria-label="${lessonLabel(n)}">
      <div class="menu-head">${icon.chapter}<span>${lessonLabel(n)}</span></div>
      ${units.filter((u) => u.lesson === n).map((u) => `<a class="menu-item" role="menuitem" href="#/u/${esc(u.id)}" data-id="${esc(u.id)}">
        <span class="menu-ic">${typeIcon(u.type)}</span>
        <span class="menu-txt"><b>${kindLabel(u)}</b><span class="en">${esc(u.title || '')}</span></span></a>`).join('')}
    </div>`).join('')}`;
  // 項目依序淡入的順序（style.css 的 menu-in 動畫用 --i 當延遲）
  panel.querySelectorAll('.menu-item, .menu-head').forEach((el, i) => el.style.setProperty('--i', Math.min(i, 10)));
  panel.insertAdjacentHTML('afterbegin', '<span class="menu-hl" aria-hidden="true"></span>');
  root.hidden = !units.length;
}

// 每次換頁時更新按鈕文字與目前所在單元
export function updateNav(currentId) {
  const u = units.find((x) => x.id === currentId);
  // 一個按鈕三種樣子（見 style.css 的 .menu-btn）：平常是「B5 ☰」；往下捲動只留「B5 ⌄」；點開時 B5 淡出，變成「選擇單元 ⌃」並展開選單
  const slot = (cls, inner) => `<span class="mb-slot ${cls}" aria-hidden="true"><span class="mb-in">${inner}</span></span>`;
  btn.innerHTML = slot('mb-b5', '<span class="brand-mark">B5</span>') + slot('mb-burger', icon.menu) + slot('mb-label', '<span class="menu-label">選擇單元</span>') + slot('mb-chev', icon.chevDown);
  btn.setAttribute('aria-label', u ? `B5 選單，目前在 ${lessonLabel(u.lesson)} ${kindLabel(u)}` : 'B5 選單');
  items().forEach((a) => {
    const on = a.dataset.id ? a.dataset.id === currentId : !currentId;
    a.classList.toggle('current', on);
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  refreshNavStatus();
  close();
}

btn.addEventListener('click', () => (isOpen() ? close() : open()));

panel.addEventListener('pointerover', (e) => {
  if (e.pointerType !== 'mouse') return;
  const a = e.target.closest('.menu-item');
  if (a) moveHl(a);
});
panel.addEventListener('pointerleave', () => hl()?.classList.remove('on'));
panel.addEventListener('focusin', (e) => {
  const a = e.target.closest('.menu-item');
  if (a && a.matches(':focus-visible')) moveHl(a);
});

document.addEventListener('click', (e) => {
  if (isOpen() && !root.contains(e.target)) close();
});

root.addEventListener('keydown', (e) => {
  const list = items();
  const i = list.indexOf(document.activeElement);
  if (e.key === 'Escape') { e.preventDefault(); close(true); }
  else if (e.key === 'ArrowDown') { e.preventDefault(); if (!isOpen()) open(); else list[(i + 1) % list.length].focus(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); if (isOpen()) list[(i - 1 + list.length) % list.length].focus(); }
  else if (e.key === 'Tab' && isOpen()) close();
});

// 測驗進行中切換單元：先確認，避免不小心中斷
panel.addEventListener('click', async (e) => {
  const a = e.target.closest('a[role="menuitem"]');
  if (!a) return;
  if (a.getAttribute('href') === location.hash) { close(); return; }
  if (!document.body.dataset.busy) { close(); return; }
  e.preventDefault();
  close();
  const ok = await confirmDialog({
    title: '要離開這次測驗嗎？',
    body: leaveBody((/^#\/u\/([^/]+)/.exec(location.hash) || [])[1] || ''),
    ok: '離開', cancel: '繼續作答', danger: true,
  });
  if (ok) { delete document.body.dataset.busy; location.hash = a.getAttribute('href'); }
});
