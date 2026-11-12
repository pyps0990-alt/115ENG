export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

export function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export const sample = (arr, n) => shuffle(arr).slice(0, n);

export const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export const wait = (ms) => new Promise((r) => setTimeout(r, reducedMotion() ? Math.min(ms, 60) : ms));

let toastTimer;
export function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

export function fmtTime(ms) {
  const s = ms / 1000;
  const m = Math.floor(s / 60);
  return `${m}:${(s % 60).toFixed(1).padStart(4, '0')}`;
}

export function nowStamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

// 例句中用 [ ] 標出目標字，例如 "She stayed calm in the face of [adversity]."
export const exampleHTML = (ex) => esc(ex).replace(/\[([^\]]+)\]/g, '<mark class="hl">$1</mark>');
export const plainExample = (ex) => String(ex ?? '').replace(/\[([^\]]+)\]/g, '$1');

export function clozeParts(w) {
  const ex = w.example || '';
  let m = ex.match(/\[([^\]]+)\]/);
  if (m) return { before: ex.slice(0, m.index), answer: m[1], after: ex.slice(m.index + m[0].length) };
  // 沒有標記時，用字首推測（例如 adapt → adapted）
  const stem = w.word.slice(0, Math.max(3, w.word.length - 2)).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  m = ex.match(new RegExp(`\\b(${stem}[a-z]*)`, 'i'));
  if (m) return { before: ex.slice(0, m.index), answer: m[1], after: ex.slice(m.index + m[0].length) };
  return null;
}

// 中文意思拆成一個個義項（去掉括號裡的詞性、說明，用「；;、，,/」分開），用來判斷兩個字的意思是否重疊
export const meaningsOf = (zh) => String(zh ?? '').replace(/[（(][^）)]*[）)]/g, '').replace(/^\s*(?:[a-z]+\.\s*)+/i, '')
  .split(/[；;、，,／/]+/).map((s) => s.replace(/\s+/g, '').replace(/[的地得]$/, '')).filter(Boolean);
export const sameMeaning = (a, b) => { const A = new Set(meaningsOf(a)); return meaningsOf(b).some((m) => A.has(m)); };
export const lettersOf = (s) => String(s).toLowerCase().replace(/[^a-z]/g, '');

// 一個字如果存了不只一句例句（老師手動輸入或 AI 補充），每次出題隨機挑一句，
// 讓同一個字、同一種題型，每次考的句子內容也不一樣。只有一句時就是原本那句。
export function pickExample(w) {
  const list = Array.isArray(w.examples) && w.examples.length ? w.examples : [{ ex: w.example || '', zh: w.exampleZh || '' }];
  return list[Math.floor(Math.random() * list.length)];
}

// 把一段文章切成句子；課文題目的 ref（"段-句"，從 1 開始）依這個切法編號。
// 老師後台（Admin.html）與 Apps Script（Code.gs）有同一套規則，改這裡要一起改。
export const splitSentences = (p) => (String(p).match(/[^.!?]+(?:[.!?]+["'”’)\]]*|$)/g) || []).map((s) => s.trim()).filter(Boolean);

// danger：確認的是破壞性動作（例如離開測驗）。預設停在「取消」，確認鈕改成安靜的外框鈕，避免按 Enter 就誤中斷
// 換內容前先讓舊的淡出（約 0.18 秒），再放新的進來：不會「啪」一下直接換掉
// 轉場中點擊不會被吃掉：轉場的那零點幾秒，瀏覽器把點擊交給整頁（html）而不是畫面上的按鈕。
// 手指一碰到螢幕就立刻結束轉場，這一下點擊改送到手指下真正的按鈕、選項或連結上
// 手機上正在打字（鍵盤開著）：收起測驗底部固定的「下一題」列，不讓它浮在鍵盤上方擋住題目；收起鍵盤後再出現
if (typeof document !== 'undefined' && window.matchMedia && matchMedia('(pointer: coarse)').matches) {
  const typing = (el) => el && el.matches && el.matches('input[type="text"], input:not([type]), textarea') && !el.closest('dialog');
  document.addEventListener('focusin', (e) => { if (typing(e.target)) document.documentElement.classList.add('kb-typing'); });
  document.addEventListener('focusout', () => setTimeout(() => { if (!typing(document.activeElement)) document.documentElement.classList.remove('kb-typing'); }, 60));
}
// 英文發音（iPhone、電腦內建的英文語音，不用錄音檔）：sayBtn(英文) 產生 🔊 按鈕，點了就念。不支援的瀏覽器不顯示按鈕
const canSay = typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';
let enVoice = null;
const pickVoice = () => {
  const vs = speechSynthesis.getVoices();
  enVoice = vs.find((v) => /^en[-_]US/i.test(v.lang) && /Samantha|Google US|Aaron|Nicky/i.test(v.name)) || vs.find((v) => /^en[-_]US/i.test(v.lang)) || vs.find((v) => /^en/i.test(v.lang)) || null;
};
export function say(text) {
  if (!canSay || !text) return;
  if (!enVoice) pickVoice();
  const u = new SpeechSynthesisUtterance(String(text).replace(/\{\d+:([^}]*)\}/g, '$1').replace(/[[\]]/g, ''));
  u.lang = 'en-US'; if (enVoice) u.voice = enVoice; u.rate = 0.9;
  speechSynthesis.cancel(); speechSynthesis.speak(u);
}
const attrEsc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
export const sayBtn = (text, label = '發音') => (canSay && text ? `<button class="say" type="button" data-say="${attrEsc(text)}" aria-label="${label}" title="${label}"><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5L6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 010 7M18.5 5.5a9 9 0 010 13"/></svg></button>` : '');
if (canSay) {
  speechSynthesis.addEventListener?.('voiceschanged', pickVoice);
  document.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('[data-say]'); if (!b) return;
    e.preventDefault(); e.stopPropagation();
    say(b.dataset.say);
    b.classList.remove('saying'); void b.offsetWidth; b.classList.add('saying');
  });
}
// 正在跑的換頁／換場轉場：結束（或被跳過）時才 resolve。轉場中不要捲動頁面（iPhone Safari 截圖位置會算錯）
let vtLive = null;
export const afterVT = () => vtLive || Promise.resolve();
(() => {
  if (typeof document === 'undefined' || !document.startViewTransition || document.__vtTap) return;
  document.__vtTap = true;
  const orig = document.startViewTransition.bind(document);
  let active = null, retarget = 0;
  document.startViewTransition = (cb) => {
    const t = orig(cb);
    active = t;
    const done = t.finished.catch(() => {});
    vtLive = done;
    done.finally(() => { if (active === t) active = null; if (vtLive === done) vtLive = null; });
    return t;
  };
  let downAt = null;
  document.addEventListener('pointerdown', (e) => {
    if (!active) return;
    try { active.skipTransition(); } catch { /* ignore */ }
    active = null; retarget = Date.now(); downAt = [e.clientX, e.clientY];
    // 按下的那一下也轉給底下的元素（例如句型應用題拖單字，按下去就能直接拖）
    const root = document.documentElement;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (el && el !== root && el !== document.body && (e.target === root || e.target === document.body)) {
      e.stopImmediatePropagation();
      try { el.dispatchEvent(new PointerEvent('pointerdown', e)); } catch { /* 舊瀏覽器：只轉點擊 */ }
    }
  }, true);
  document.addEventListener('click', (e) => {
    if (!retarget || Date.now() - retarget > 1500) return;
    retarget = 0;
    const root = document.documentElement;
    if (e.target !== root && e.target !== document.body) return;
    if (downAt && Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 8) return; // 是拖動，不是點擊
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || el === root || el === document.body) return;
    e.stopImmediatePropagation(); e.preventDefault();
    el.click();
  }, true);
})();

// 單元裡的「場景」切換（開始測驗、交卷、看成績、進檢討、檢討完回單元頁）：跟換頁一樣用 View Transition 交叉淡化，
// 封面高度、版面一起平順過去，不會硬切。不支援的瀏覽器、減少動態、或已經有轉場在跑時直接換
let sceneBusy = false;
export function scene(fn) {
  const ok = !!document.startViewTransition && !reducedMotion() && document.visibilityState === 'visible' && !sceneBusy;
  if (!ok) return Promise.resolve(fn());
  // 捲在下面（例如在最後一題按交卷）：不用截圖式轉場（iPhone Safari 捲動中截圖位置會算錯），內容淡出 → 換 → 淡入
  const app = document.getElementById('app');
  if (window.scrollY > 120 && app) {
    sceneBusy = true;
    app.classList.remove('far-in'); app.classList.add('far-out'); document.documentElement.classList.add('far-run');
    return new Promise((r) => setTimeout(r, 110)).then(() => fn()).then((out) => {
      app.classList.remove('far-out'); void app.offsetWidth; app.classList.add('far-in');
      setTimeout(() => { app.classList.remove('far-in'); document.documentElement.classList.remove('far-run'); }, 400);
      return out;
    }).finally(() => { sceneBusy = false; });
  }
  sceneBusy = true;
  document.documentElement.dataset.nav = 'scene';
  let out;
  const t = document.startViewTransition(() => { out = fn(); return Promise.race([Promise.resolve(out), new Promise((r) => setTimeout(r, 100))]); });
  t.finished.catch(() => {}).finally(() => { sceneBusy = false; });
  t.ready.catch(() => {});
  return t.updateCallbackDone.catch(() => {}).then(() => out);
}

// 正在換場景：新內容不要再自己做進場動畫（換場的交叉淡化已經處理了，兩個疊在一起會先空白一下）
export const inScene = () => sceneBusy;

export async function leaveOut(host, ms = 180) {
  if (!host || !host.children.length || reducedMotion()) return;
  [...host.children].forEach((c) => c.classList.add('leaving'));
  await new Promise((r) => setTimeout(r, ms));
}

// 對話框柔和關閉：先淡出、縮回一點，再真的關掉（按鈕、Esc 都一樣）
export function softClose(d, value = '') {
  if (!d.open || d.classList.contains('closing')) return;
  if (reducedMotion()) { d.close(value); return; }
  d.classList.add('closing');
  setTimeout(() => d.close(value), 170);
}
function softDialog(d) {
  d.addEventListener('cancel', (e) => { e.preventDefault(); softClose(d, 'cancel'); });
  const form = d.querySelector('form[method="dialog"]');
  if (form) form.addEventListener('submit', (e) => { e.preventDefault(); softClose(d, (e.submitter && e.submitter.value) || ''); });
}

export function confirmDialog({ title, body, ok = '確定', cancel = '取消', danger = false }) {
  return new Promise((resolve) => {
    const d = el(`<dialog class="modal"><form method="dialog" class="modal-body">
      <h2>${esc(title)}</h2><div class="muted">${body}</div>
      <div class="btn-row" style="justify-content:flex-end">
        <button class="btn ${danger ? 'primary' : 'ghost'}" value="cancel"${danger ? ' autofocus' : ''}>${esc(cancel)}</button>
        <button class="btn ${danger ? 'outline' : 'primary'}" value="ok"${danger ? '' : ' autofocus'}>${esc(ok)}</button>
      </div></form></dialog>`);
    document.body.append(d);
    d.addEventListener('close', () => { resolve(d.returnValue === 'ok'); d.remove(); });
    softDialog(d);
    d.showModal();
  });
}

export function confetti() {
  if (reducedMotion()) return;
  const fx = document.getElementById('fx');
  const colors = ['#1E3A8A', '#F59E0B', '#FCD34D', '#3B5BB5', '#FDE68A'];
  for (let i = 0; i < 70; i++) {
    const c = document.createElement('span');
    c.className = 'confetti';
    c.style.left = `${Math.random() * 100}%`;
    c.style.background = colors[i % colors.length];
    c.style.animationDuration = `${1.8 + Math.random() * 1.6}s`;
    c.style.animationDelay = `${Math.random() * 0.4}s`;
    c.style.transform = `rotate(${Math.random() * 360}deg)`;
    fx.append(c);
    setTimeout(() => c.remove(), 4000);
  }
}

// 進入考試、換下一題時，把題目卷動到使用者螢幕中間（已經在中間附近就不動，避免多餘的捲動）。
// 比螢幕還高的內容（例如長文章）改成對齊上方。
// 捲到看得見的區域：扣掉上方固定的導覽列與下方固定的橫幅（單字作答的 .q-dock、句型說明的 .ln-bar），題目不會被蓋住
function visibleBand() {
  const vh = (window.visualViewport && window.visualViewport.height) || window.innerHeight;
  const bar = document.querySelector('.topbar');
  let top = bar ? Math.max(0, bar.getBoundingClientRect().bottom) : 0;
  // 會黏在上方的進度卡（.st-bar）：捲動後會停在導覽列下面，也算被擋住的範圍
  document.querySelectorAll('.st-bar, .ln-top').forEach((d) => {
    const cs = getComputedStyle(d);
    if (cs.position === 'sticky') top = Math.max(top, (parseFloat(cs.top) || 0) + d.offsetHeight);
  });
  let bottom = vh;
  document.querySelectorAll('.q-dock, .ln-bar:not([hidden])').forEach((d) => {
    if (getComputedStyle(d).position === 'fixed') bottom = Math.min(bottom, d.getBoundingClientRect().top);
  });
  return { top, bottom };
}
export function centerInView(el, block = 'center') {
  if (!el) return;
  // 轉場進行中先不捲：等轉場結束再把題目捲到中間
  afterVT().then(() => requestAnimationFrame(() => {
    if (!el.isConnected) return;
    const { top, bottom } = visibleBand();
    const room = bottom - top;
    const r = el.getBoundingClientRect();
    const pad = 12;
    // 放得下：放在可見區域正中間（已經完整看得到、而且差不多在中間就不動）；放不下：頂端貼齊導覽列下方
    const fits = r.height <= room - pad * 2;
    if (fits && block === 'center' && r.top >= top + pad && r.bottom <= bottom - pad && Math.abs((r.top + r.bottom) / 2 - (top + bottom) / 2) < room * 0.18) return;
    const want = fits && block === 'center' ? top + (room - r.height) / 2 : top + pad;
    const dy = r.top - want;
    if (Math.abs(dy) < 2) return;
    window.scrollBy({ top: dy, behavior: reducedMotion() ? 'auto' : 'smooth' });
  }));
}
