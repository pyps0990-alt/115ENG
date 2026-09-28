import { store } from './storage.js';
import { esc, el } from './util.js';
import { icon } from './icons.js';
import { verifyStudent, loadHistory } from './firebase.js';

export const studentLabel = (s) => (s ? `${s.cls} 班 ${s.seat} 號 ${s.name}` : '');

export function formHTML(s = {}) {
  return `
    <div class="form-grid">
      <div class="field"><label for="f-cls">班級</label>
        <input id="f-cls" name="cls" inputmode="numeric" autocomplete="off" placeholder="例：201" maxlength="6" value="${esc(s.cls || '')}" required></div>
      <div class="field"><label for="f-seat">座號</label>
        <input id="f-seat" name="seat" inputmode="numeric" autocomplete="off" placeholder="例：7" maxlength="3" value="${esc(s.seat || '')}" required></div>
      <div class="field span2"><label for="f-name">姓名</label>
        <input id="f-name" name="name" autocomplete="off" placeholder="你的名字" maxlength="20" value="${esc(s.name || '')}" required></div>
    </div>
    <div class="form-err" aria-live="polite"></div>`;
}

export function readForm(form) {
  const f = new FormData(form);
  const s = {
    cls: String(f.get('cls') || '').trim(),
    seat: String(f.get('seat') || '').trim().replace(/^0+(?=\d)/, ''),
    name: String(f.get('name') || '').trim(),
  };
  const err = form.querySelector('.form-err');
  if (!/^\d{3,4}$/.test(s.cls)) { err.textContent = '班級請輸入 3～4 位數字，例如 201。'; return null; }
  if (!/^\d{1,2}$/.test(s.seat)) { err.textContent = '座號請輸入 1～2 位數字。'; return null; }
  if (!s.name) { err.textContent = '請輸入姓名。'; return null; }
  err.textContent = '';
  return s;
}

// 驗證身分 → 讀回這位學生在 Firestore 的紀錄 → 存成目前登入的學生
async function login(form) {
  const s = readForm(form);
  if (!s) return null;
  const err = form.querySelector('.form-err');
  const btn = form.querySelector('[type="submit"]');
  btn.disabled = true;
  err.textContent = '確認身分中…';
  try {
    const res = await verifyStudent(s);
    if (!res.ok) {
      err.textContent = '老師的名單裡找不到這組班級、座號和姓名，請確認有沒有打錯字，或詢問老師。';
      return null;
    }
    const student = { cls: s.cls, seat: s.seat, name: res.name, key: res.key };
    if ((store.student() || {}).key !== res.key) store.resetProgress();
    store.applyHistory(await loadHistory(res.key));
    store.setStudent(student);
    err.textContent = '';
    renderStudentChip();
    return student;
  } catch (e) {
    console.error(e);
    err.textContent = '連線失敗，請確認網路後再試一次。';
    return null;
  } finally {
    btn.disabled = false;
  }
}

// 內嵌表單（首頁歡迎卡、測驗前）
export function mountInlineForm(host, { title, desc, button = '開始練習', onSave }) {
  const card = el(`<form class="card welcome" novalidate>
      <div><div class="eyebrow">Step 1</div><h2>${esc(title)}</h2>${desc ? `<p class="muted" style="margin:4px 0 0">${esc(desc)}</p>` : ''}</div>
      ${formHTML(store.student() || {})}
      <div class="btn-row"><button class="btn primary" type="submit">${esc(button)} ${icon.arrowR}</button></div>
    </form>`);
  card.addEventListener('submit', async (e) => {
    e.preventDefault();
    const s = await login(card);
    if (s) onSave?.(s);
  });
  host.append(card);
  return card;
}

export function openStudentDialog(onSave) {
  const d = el(`<dialog class="modal"><form class="modal-body" novalidate>
      <h2>切換學生</h2>
      <p class="muted" style="margin:0">輸入班級、座號和姓名，會載入這位學生的紀錄。</p>
      ${formHTML(store.student() || {})}
      <div class="btn-row" style="justify-content:flex-end">
        <button class="btn ghost" type="button" data-close>取消</button>
        <button class="btn primary" type="submit">登入</button>
      </div></form></dialog>`);
  document.body.append(d);
  const form = d.querySelector('form');
  d.querySelector('[data-close]').onclick = () => d.close();
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const s = await login(form);
    if (!s) return;
    d.close();
    onSave?.(s);
  });
  d.addEventListener('close', () => d.remove());
  d.showModal();
}

export function renderStudentChip() {
  const chip = document.getElementById('student-chip');
  const s = store.student();
  chip.hidden = !s;
  if (s) {
    chip.innerHTML = `${icon.user}<span>${esc(studentLabel(s))}</span>`;
    chip.title = '切換學生';
    chip.onclick = () => openStudentDialog(() => window.dispatchEvent(new Event('student-changed')));
  }
}
