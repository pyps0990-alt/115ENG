// 老師後台的「即時監控」頁（admin.html → 左邊「即時」）
//   - 現在在線人數、作答中／其他畫面、裝置
//   - 在哪個畫面、正在做的單元
//   - 過去 24 小時每小時使用人次、交卷健康度
// 資料來自 Firebase Realtime Database（學生端 js/presence.js 寫入，匿名，不含姓名、班級、座號），規則與 monitor.js 相同。
// mountLive(el, { titles, demo })：titles 是 { 單元代號: 名稱 }；demo 為 true 時用示範資料（本機預覽用，不連資料庫）
import { firebaseApp, watchStaff } from './firebase.js';
import { RTDB_URL } from './config.js';
import { hourKey } from './presence.js';
import { esc } from './util.js';

const SDK = 'https://www.gstatic.com/firebasejs/10.13.2/firebase-database.js';
const STALE_MS = 4 * 60000; // 學生端每 90 秒更新一次；超過 4 分鐘沒更新就當成已離開
const VIEWS = [
  ['quiz-vocab', '作答中・單字片語'], ['quiz-reading', '作答中・課文理解'], ['quiz-pattern', '作答中・句型練習'],
  ['unit', '單元頁（未作答）'], ['home', '首頁'], ['me', '我的成績'], ['login', '輸入資料'], ['other', '其他'],
];
const DEVICES = [['mobile', '手機'], ['tablet', '平板'], ['desktop', '電腦']];
const HEALTH = [
  ['sent', '直接送出', 'good', '交卷當下就確認送到'],
  ['late', '排隊後送出', 'good', '當下沒送到，之後自動補送成功'],
  ['queued', '先排隊', 'warn', '當下沒送到，存在學生裝置稍後自動重送'],
  ['volatile', '存不了', 'warn', '裝置不能暫存，只在記憶體（學生被提醒先別離開）'],
  ['rejected', '被拒收', 'bad', '伺服器拒收，學生被請求截圖給老師'],
];
const keyOf = (email) => String(email || '').toLowerCase().replace(/\./g, ',');

let live = null; // 同一頁只連一次；離開「即時」頁時暫停畫圖，回來再畫

export function mountLive(el, opts = {}) {
  if (live) { live.el = el; live.titles = opts.titles || live.titles; live.paused = false; live.render(true); return; }
  live = { el, titles: opts.titles || {}, paused: false, render: () => {} };
  el.innerHTML = layoutHTML();
  wireTip(el);
  if (opts.demo) { demo(); return; }
  if (!RTDB_URL) { help('error'); return; }
  connect().catch((e) => help('error', '', e));
}
export function pauseLive() { if (live) live.paused = true; }

function setState(state, text) {
  const s = live.el.querySelector('[data-lv-state]');
  if (s) { s.dataset.state = state; s.querySelector('span').textContent = text; }
}

async function connect() {
  const email = await new Promise((res) => { const off = watchStaff((st) => { res(st && st.email || ''); setTimeout(() => off && off(), 0); }); });
  const m = await import(SDK);
  const db = m.getDatabase(firebaseApp, RTDB_URL);
  let offset = 0, presence = null, gotAny = false, failed = false;
  const stats = {};
  const fail = (err) => {
    if (failed) return; failed = true;
    help(String(err && err.code || err).toUpperCase().includes('PERMISSION') ? 'denied' : 'error', email, err);
  };
  const guard = setTimeout(() => { if (!gotAny) fail(new Error('8 秒內沒有回應')); }, 8000);
  m.onValue(m.ref(db, '.info/serverTimeOffset'), (s) => { offset = Number(s.val()) || 0; });
  m.onValue(m.ref(db, '.info/connected'), (s) => { if (!failed) { if (s.val()) setState('on', '即時連線中'); else setState('wait', '連線中斷，正在重新連線…'); } });
  m.onValue(m.ref(db, 'presence'), (s) => { gotAny = true; clearTimeout(guard); presence = s.val() || {}; live.render(); }, fail);
  let days = [];
  const ensureDays = () => {
    const now = Date.now() + offset;
    [hourKey(now - 86400000)[0], hourKey(now)[0]].filter((d) => !days.includes(d)).forEach((day) => {
      days.push(day);
      m.onValue(m.ref(db, `stats/${day}`), (s) => { stats[day] = s.val() || {}; live.render(); }, fail);
    });
  };
  ensureDays();
  setInterval(() => { ensureDays(); live.render(); }, 30000);
  // 超過 12 分鐘沒更新的在線紀錄（關掉分頁時伺服器沒收到斷線，很少見）由監控頁清掉
  setInterval(() => {
    if (!presence) return;
    const now = Date.now() + offset;
    Object.entries(presence).forEach(([sid, p]) => { if (now - Number(p.t || 0) > STALE_MS * 3) m.remove(m.ref(db, `presence/${sid}`)).catch(() => {}); });
  }, 120000);
  live.render = (force) => {
    if (failed || !presence || (live.paused && !force)) return;
    const now = Date.now() + offset;
    paint(Object.values(presence).filter((p) => now - Number(p.t || 0) <= STALE_MS), hoursOf(stats, now));
  };
}

// 本機預覽：示範資料，每 4 秒變動一點
function demo() {
  setState('on', '即時連線中（示範資料）');
  const ids = Object.keys(live.titles);
  const make = () => Array.from({ length: 18 + Math.floor(Math.random() * 8) }, (_, i) => ({
    v: VIEWS[(i * 7 + Math.floor(Math.random() * 3)) % 6][0], u: ids.length && i % 3 ? ids[i % ids.length] : '', d: ['mobile', 'mobile', 'desktop', 'tablet'][i % 4],
  }));
  const now = Date.now();
  const hs = Array.from({ length: 24 }, (_, k) => {
    const [day, hh] = hourKey(now - (23 - k) * 3600000); const h = Number(hh);
    const base = h >= 8 && h <= 17 ? 30 + ((h * 37) % 50) : h >= 19 && h <= 22 ? 20 + ((h * 13) % 30) : (h * 3) % 6;
    return { day, hh, sessions: base, sent: Math.round(base * 0.6), late: Math.round(base * 0.05), queued: Math.round(base * 0.06), volatile: h === 20 ? 1 : 0, rejected: 0 };
  });
  live.render = (force) => { if (!live.paused || force) paint(make(), hs); };
  live.render(true);
  setInterval(() => live.render(), 4000);
}

function hoursOf(stats, now) {
  const out = [];
  for (let i = 23; i >= 0; i--) { const [day, hh] = hourKey(now - i * 3600000); out.push({ day, hh, ...((stats[day] || {})[hh] || {}) }); }
  return out;
}

function layoutHTML() {
  return `
    <div class="lv-top"><span class="lv-state" data-lv-state data-state="wait"><i></i><span>連線中…</span></span><span class="muted small">每 90 秒更新；匿名，不含學生姓名</span></div>
    <div class="usc-stats lv-tiles">
      <div class="usc-stat lv-now"><b data-lv="now">0</b><span>現在在線</span></div>
      <div class="usc-stat good"><b data-lv="quiz">0</b><span>作答中</span></div>
      <div class="usc-stat"><b data-lv="other">0</b><span>其他畫面</span></div>
      ${DEVICES.map(([k, t]) => `<div class="usc-stat lv-dev"><b data-lv="${k}">0</b><span>${t}</span></div>`).join('')}
    </div>
    <div class="usc-grid lv-grid">
      <section class="card"><div class="nv-panel-h"><h2>在哪個畫面</h2></div><ul class="lv-bars" data-lv="views"></ul></section>
      <section class="card"><div class="nv-panel-h"><h2>正在做的單元</h2></div><ul class="lv-bars" data-lv="units"></ul></section>
    </div>
    <section class="card">
      <div class="nv-panel-h"><h2>過去 24 小時・每小時使用人次</h2><span class="muted small" data-lv="total"></span></div>
      <div class="lv-chart-wrap"><div class="lv-chart" data-lv="chart"></div><div class="lv-tip" data-lv-tip hidden></div></div>
    </section>
    <section class="card" style="margin-top:16px">
      <div class="nv-panel-h"><h2>過去 24 小時・交卷是否順利</h2></div>
      <div class="lv-health" data-lv="health"></div>
      <details class="nv-adv"><summary>每小時明細</summary><div class="uc-tbl" data-lv="table"></div></details>
    </section>
    <p class="small muted" style="margin:14px 0 0">只記錄畫面、單元與裝置類型。閒置 2 分鐘（作答中 6 分鐘）或切到背景 1 分鐘的學生不算在線。</p>`;
}

const $q = (k) => live.el.querySelector(`[data-lv="${k}"]`);
function setNum(k, n) { const el = $q(k); if (el && el.textContent !== String(n)) { el.textContent = n; el.classList.remove('lv-bump'); void el.offsetWidth; el.classList.add('lv-bump'); } }
// 橫條：同一列重複使用，寬度用 transform 變化（不重排版面，動畫順）
function bars(el, list, empty) {
  if (!list.length) { el.innerHTML = `<li class="muted lv-empty">${empty}</li>`; return; }
  const max = Math.max(1, ...list.map((x) => x[2]));
  const keep = {}; [...el.children].forEach((li) => { if (li.dataset.k) keep[li.dataset.k] = li; });
  el.innerHTML = '';
  list.forEach(([k, label, n]) => {
    let li = keep[k];
    if (!li) { li = document.createElement('li'); li.dataset.k = k; li.innerHTML = '<span class="lv-l"></span><span class="lv-track"><i></i></span><b></b>'; li.querySelector('i').style.transform = 'scaleX(0)'; }
    li.querySelector('.lv-l').textContent = label; li.querySelector('b').textContent = n;
    el.appendChild(li);
    requestAnimationFrame(() => { li.querySelector('i').style.transform = `scaleX(${n / max})`; });
  });
}

function paint(people, hs) {
  const n = people.length, quiz = people.filter((p) => String(p.v).startsWith('quiz')).length;
  setNum('now', n); setNum('quiz', quiz); setNum('other', n - quiz);
  DEVICES.forEach(([k]) => setNum(k, people.filter((p) => p.d === k).length));
  const byV = {}; people.forEach((p) => { const v = VIEWS.some((x) => x[0] === p.v) ? p.v : 'other'; byV[v] = (byV[v] || 0) + 1; });
  bars($q('views'), VIEWS.filter(([k]) => byV[k]).map(([k, t]) => [k, t, byV[k]]), '目前沒有人在線上');
  const byU = {}; people.forEach((p) => { if (p.u) byU[p.u] = (byU[p.u] || 0) + 1; });
  bars($q('units'), Object.entries(byU).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([id, c]) => [id, live.titles[id] || id, c]), '目前沒有人在單元裡');
  const total = (f) => hs.reduce((s, h) => s + (Number(h[f]) || 0), 0);
  $q('total').textContent = `共 ${total('sessions')} 人次`;
  const ch = $q('chart');
  if (ch.dataset.drawn) ch.classList.add('calm'); // 只有第一次畫的時候長條長出來，之後更新不再重播
  ch.innerHTML = chartSVG(hs); ch.dataset.drawn = '1';
  $q('health').innerHTML = HEALTH.map(([f, label, tone, tip]) => `<div class="lv-h ${tone}${total(f) && tone !== 'good' ? ' hot' : ''}"><b>${total(f)}</b><span>${label}</span><small>${esc(tip)}</small></div>`).join('');
  $q('table').innerHTML = `<table><thead><tr><th>時間</th><th class="r">使用人次</th>${HEALTH.map((h) => `<th class="r">${h[1]}</th>`).join('')}</tr></thead><tbody>${
    hs.slice().reverse().map((h) => `<tr><td>${h.day.slice(5).replace('-', '/')} ${h.hh}:00</td><td class="r">${Number(h.sessions) || 0}</td>${HEALTH.map(([f]) => `<td class="r">${Number(h[f]) || 0}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}

// 每小時使用人次：單一數列長條圖（目前這一小時用琥珀色），刻度取整、細長條、上緣圓角
function chartSVG(hs) {
  const W = 720, H = 210, L = 34, R = 8, T = 14, B = 28;
  const vals = hs.map((h) => Number(h.sessions) || 0), max = Math.max(...vals);
  const step = max <= 4 ? 1 : max <= 10 ? 2 : max <= 25 ? 5 : max <= 50 ? 10 : max <= 100 ? 20 : Math.ceil(max / 5 / 50) * 50;
  const top = Math.max(step * 4, Math.ceil(max / step) * step);
  const y = (v) => T + (H - T - B) * (1 - v / top);
  const slot = (W - L - R) / hs.length, bw = Math.max(4, Math.min(16, slot - 8));
  let g = '';
  for (let v = 0; v <= top; v += step) g += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="${v ? 'g' : 'g0'}"/><text x="${L - 8}" y="${y(v) + 4}" class="yl">${v}</text>`;
  const b = hs.map((h, i) => {
    const v = vals[i], x = L + i * slot + (slot - bw) / 2, yy = y(v), base = y(0), r = Math.min(4, bw / 2, base - yy);
    const path = v ? `<path class="bar${i === hs.length - 1 ? ' now' : ''}" style="--d:${i * 14}ms" d="M${x},${base} V${yy + r} Q${x},${yy} ${x + r},${yy} H${x + bw - r} Q${x + bw},${yy} ${x + bw},${yy + r} V${base} Z"/>` : '';
    const label = Number(h.hh) % 3 === 0 ? `<text x="${x + bw / 2}" y="${H - 8}" class="xl">${Number(h.hh)}時</text>` : '';
    const tip = `<b>${h.day.slice(5).replace('-', '/')} ${h.hh}:00–${h.hh}:59</b><br>使用人次 ${v}`;
    return `${path}${label}<rect class="hit" x="${L + i * slot}" y="${T}" width="${slot}" height="${H - T - B}" tabindex="0" data-tip="${esc(tip)}" aria-label="${esc(`${Number(h.hh)} 點 ${v} 人次`)}"/>`;
  }).join('');
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="過去 24 小時每小時使用人次長條圖">${g}${b}</svg>`;
}

function wireTip(el) {
  const box = el.querySelector('[data-lv="chart"]'), tip = el.querySelector('[data-lv-tip]');
  const show = (t) => {
    const r = t.getBoundingClientRect(), b = box.getBoundingClientRect();
    tip.innerHTML = t.dataset.tip; tip.hidden = false;
    // 提示框放在那一小時的長條上方（以圖表為準，不會跑到頁面最上面）
    const bar = t.previousElementSibling && t.previousElementSibling.classList.contains('bar') ? t.previousElementSibling.getBoundingClientRect() : r;
    const x = Math.min(b.width - tip.offsetWidth, Math.max(0, r.left - b.left + r.width / 2 - tip.offsetWidth / 2));
    const y = Math.max(0, bar.top - b.top - tip.offsetHeight - 8);
    tip.style.transform = `translate(${x}px, ${y}px)`;
  };
  box.addEventListener('pointerover', (e) => { const t = e.target.closest('[data-tip]'); if (t) show(t); });
  box.addEventListener('pointerleave', () => { tip.hidden = true; });
  box.addEventListener('focusin', (e) => { const t = e.target.closest('[data-tip]'); if (t) show(t); });
  box.addEventListener('focusout', () => { tip.hidden = true; });
}

function help(kind, email, err) {
  setState('off', kind === 'denied' ? '沒有讀取權限' : '連不上資料庫');
  live.el.innerHTML = `<section class="card"><div class="nv-panel-h"><h2>${kind === 'denied' ? '這個帳號還不能讀取監控資料' : '連不上即時監控資料庫'}</h2></div>
    ${kind === 'denied' ? `<p>請到 Firebase 主控台 → Realtime Database → 資料，在最上層新增名稱 <code>staff</code>，底下再新增名稱 <code>${esc(keyOf(email))}</code>、值 <code>true</code>（布林值）。email 裡的「.」換成「,」、全部小寫。完成後重新整理這一頁。</p>`
      : `<p class="muted">可能是 Realtime Database 還沒建立、網址設定不同、規則沒部署，或學校網路擋掉連線。</p><p class="small muted">網址：<code>${esc(RTDB_URL || '（未設定）')}</code>${err ? `<br>錯誤：${esc(err.message || err)}` : ''}</p>`}</section>`;
}
