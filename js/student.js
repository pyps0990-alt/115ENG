import { store } from './storage.js';
import { esc, el } from './util.js';
import { icon } from './icons.js';

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
    <div class="form-err" aria-live="polite"></div>
    <p class="privacy-note">會保存你的班級、座號、姓名與測驗紀錄，僅供授課老師使用，詳見<a href="#/privacy">隱私權說明</a>。</p>`;
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

// 登入後在背景載入這位學生的紀錄（換頁不用等它）；進入單元前會等它載完，才不會把做過的單元當成沒做過
let pendingHistory = Promise.resolve();
export const historyReady = () => Promise.race([pendingHistory, new Promise((r) => setTimeout(r, 8000))]);

// 登入按鈕的狀態回饋：確認中（轉圈）→ 成功（綠色打勾）或失敗（輕輕抖一下），取代整段紅字
const btnLabel = new WeakMap();
function setBtn(btn, state, html) {
  if (!btnLabel.has(btn)) btnLabel.set(btn, btn.innerHTML);
  btn.dataset.state = state;
  btn.innerHTML = html;
}
function resetBtn(btn) {
  delete btn.dataset.state;
  if (btnLabel.has(btn)) btn.innerHTML = btnLabel.get(btn);
  btn.disabled = false;
}
function shakeBtn(btn) {
  resetBtn(btn);
  btn.classList.remove('shake');
  void btn.offsetWidth; // 重新觸發動畫
  btn.classList.add('shake');
}
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// 驗證身分 → 存成目前登入的學生 → 紀錄在背景載入。成功時按鈕先顯示「已確認」一下再換頁。
async function login(form) {
  const btn = form.querySelector('[type="submit"]');
  const err = form.querySelector('.form-err');
  const s = readForm(form);
  const hint = (text) => {
    err.textContent = text;
    form.addEventListener('input', () => { err.textContent = ''; }, { once: true });
  };
  if (!s) { shakeBtn(btn); form.addEventListener('input', () => { err.textContent = ''; }, { once: true }); return null; }
  btn.disabled = true;
  err.textContent = '';
  setBtn(btn, 'busy', '<span class="spinner sm"></span>確認中…');
  try {
    const { verifyStudent, loadHistory } = await import('./firebase.js');
    const res = await verifyStudent(s);
    if (!res.ok) {
      shakeBtn(btn);
      hint('名單裡找不到這組班級、座號和姓名，請確認有沒有打錯字，或詢問老師。');
      return null;
    }
    const student = { cls: s.cls, seat: s.seat, name: res.name, key: res.key };
    if ((store.student() || {}).key !== res.key) store.resetProgress();
    store.setStudent(student);
    let returned = false;
    pendingHistory = loadHistory(res.key).then((h) => {
      if ((store.student() || {}).key === res.key) store.applyHistory(h.attempts, h.reviews);
      // 「已確認」還在顯示時不要換畫面；紀錄比它晚到才通知首頁更新
      if (returned) window.dispatchEvent(new Event('history-applied'));
    }).catch(() => { /* 讀不到就先用裝置上的紀錄 */ });
    setBtn(btn, 'ok', `${icon.check}已確認，歡迎 ${esc(res.name)}`);
    renderStudentChip();
    await pause(reduced() ? 0 : 480); // 讓學生看到「已確認」，紀錄同時在背景載入
    returned = true;
    return student;
  } catch (e) {
    console.error(e);
    shakeBtn(btn);
    hint('連線失敗，請確認網路後再試一次。');
    return null;
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
    // 上方名牌：完整顯示班級座號姓名，姓名第二個字用〇代替（旁人看螢幕時不會看到全名）
    const masked = s.name.length >= 2 ? `${s.name[0]}〇${s.name.slice(2)}` : s.name;
    chip.innerHTML = `${icon.user}<span>${esc(`${s.cls} 班 ${s.seat} 號 ${masked}`)}</span>`;
    chip.title = '切換學生';
    chip.onclick = async () => {
      // 作答中不能切換學生（考試鎖定）
      if (document.body.dataset.busy) return;
      openStudentDialog(() => window.dispatchEvent(new Event('student-changed')));
    };
  }
}
