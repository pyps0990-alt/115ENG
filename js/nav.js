// 導覽列的「選擇單元」下拉選單：任何頁面都能直接跳到各課的單字片語或課文理解
import { esc, confirmDialog } from './util.js';
import { icon } from './icons.js';
import { typeLabel, typeIcon } from './types.js';

const root = document.getElementById('nav-menu');
const btn = document.getElementById('unit-menu-btn');
const panel = document.getElementById('unit-menu');
let units = [];

const kindLabel = (u) => typeLabel(u.type);
const isOpen = () => panel.classList.contains('open');
const items = () => [...panel.querySelectorAll('[role="menuitem"]')];

// 單元的完成狀態、最佳成績、缺交統一放在「我的成績與缺交」頁，這個選單只負責跳到各單元
export function refreshNavStatus() {}

function open() {
  refreshNavStatus();
  panel.classList.add('open'); // 展開／收合都由 CSS 的 transform 與 opacity 動畫處理（見 style.css「導覽列動畫」）
  btn.setAttribute('aria-expanded', 'true');
  (panel.querySelector('.current') || items()[0])?.focus({ preventScroll: true });
}

function close(focusBtn = false) {
  if (!isOpen()) return;
  panel.classList.remove('open');
  btn.setAttribute('aria-expanded', 'false');
  if (focusBtn) btn.focus({ preventScroll: true });
}

// visibleUnits：老師設定後仍開放的單元（依課次排序）
export function initNav(visibleUnits) {
  units = visibleUnits;
  const lessons = [...new Set(units.map((u) => u.lesson))].sort((a, b) => a - b);
  panel.innerHTML = `
    <a class="menu-item home" role="menuitem" href="#/">${icon.home}<span>所有單元</span></a>
    ${lessons.map((n) => `<div class="menu-group" role="group" aria-label="Lesson ${n}">
      <div class="menu-head"><span class="menu-lnum">L${n}</span>Lesson ${n}</div>
      ${units.filter((u) => u.lesson === n).map((u) => `<a class="menu-item" role="menuitem" href="#/u/${esc(u.id)}" data-id="${esc(u.id)}">
        <span class="menu-ic">${typeIcon(u.type)}</span>
        <span class="menu-txt"><b>${kindLabel(u)}</b><span class="en">${esc(u.topic || '')}</span></span></a>`).join('')}
    </div>`).join('')}`;
  root.hidden = !units.length;
}

// 每次換頁時更新按鈕文字與目前所在單元
export function updateNav(currentId) {
  const u = units.find((x) => x.id === currentId);
  const label = u ? `L${u.lesson} ${kindLabel(u)}` : '選擇單元';
  btn.innerHTML = `${icon.list}<span class="menu-label">${label}</span>${icon.chevDown}`;
  btn.setAttribute('aria-label', `單元選單：${label}`); // 手機收合時只顯示圖示，給螢幕報讀器用
  items().forEach((a) => {
    const on = a.dataset.id ? a.dataset.id === currentId : !currentId;
    a.classList.toggle('current', on);
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  refreshNavStatus();
  close();
}

btn.addEventListener('click', () => (isOpen() ? close() : open()));

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
    body: '測驗還沒完成，離開後這次的作答不會保存，也不會送出成績。',
    ok: '離開', cancel: '繼續作答',
  });
  if (ok) { delete document.body.dataset.busy; location.hash = a.getAttribute('href'); }
});
