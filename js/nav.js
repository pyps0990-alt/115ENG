// 導覽列的「選擇單元」下拉選單：任何頁面都能直接跳到各課的單字片語或課文理解
import { esc, confirmDialog } from './util.js';
import { icon } from './icons.js';

const root = document.getElementById('nav-menu');
const btn = document.getElementById('unit-menu-btn');
const panel = document.getElementById('unit-menu');
let units = [];

const kindLabel = (u) => (u.type === 'vocab' ? '單字片語' : '課文理解');
const items = () => [...panel.querySelectorAll('[role="menuitem"]')];

function open() {
  panel.hidden = false;
  btn.setAttribute('aria-expanded', 'true');
  (panel.querySelector('.current') || items()[0])?.focus({ preventScroll: true });
}

function close(focusBtn = false) {
  if (panel.hidden) return;
  panel.hidden = true;
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
        <span class="menu-ic">${u.type === 'vocab' ? icon.cards : icon.book}</span>
        <span class="menu-txt"><b>${kindLabel(u)}</b><span class="en">${esc(u.topic || '')}</span></span></a>`).join('')}
    </div>`).join('')}`;
  root.hidden = !units.length;
}

// 每次換頁時更新按鈕文字與目前所在單元
export function updateNav(currentId) {
  const u = units.find((x) => x.id === currentId);
  btn.innerHTML = `${icon.list}<span class="menu-label">${u ? `L${u.lesson} ${kindLabel(u)}` : '選擇單元'}</span>${icon.chevDown}`;
  items().forEach((a) => {
    const on = a.dataset.id ? a.dataset.id === currentId : !currentId;
    a.classList.toggle('current', on);
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  close();
}

btn.addEventListener('click', () => (panel.hidden ? open() : close()));

document.addEventListener('click', (e) => {
  if (!panel.hidden && !root.contains(e.target)) close();
});

root.addEventListener('keydown', (e) => {
  const list = items();
  const i = list.indexOf(document.activeElement);
  if (e.key === 'Escape') { e.preventDefault(); close(true); }
  else if (e.key === 'ArrowDown') { e.preventDefault(); if (panel.hidden) open(); else list[(i + 1) % list.length].focus(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); if (!panel.hidden) list[(i - 1 + list.length) % list.length].focus(); }
  else if (e.key === 'Tab' && !panel.hidden) close();
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
  if (ok) location.hash = a.getAttribute('href');
});
