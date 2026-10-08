// 即時監控頁（monitor.html）：老師登入後看
//   - 現在在線人數、各畫面人數、正在做哪些單元、裝置
//   - 過去 24 小時每小時的使用人次
//   - 過去 24 小時的交卷健康度（直接送出、先排隊、排隊後送出、存不了、被拒收）
// 資料來自 Firebase Realtime Database（學生端 js/presence.js 寫入，匿名，不含姓名、班級、座號）。
// 讀取權限：Realtime Database 的 staff/{email，點換成逗號} 要設成 true（見頁面上的說明）。
import { watchStaff, staffSignIn, staffSignOut, firebaseApp } from './firebase.js';
import { RTDB_URL } from './config.js';
import { getConfig } from './remote-config.js';
import { hourKey } from './presence.js';
import { esc } from './util.js';
import { icon } from './icons.js';

const SDK = 'https://www.gstatic.com/firebasejs/10.13.2/firebase-database.js';
const STALE_MS = 4 * 60000; // 學生端每 90 秒更新一次；超過 4 分鐘沒更新就當成已離開
const CAP = 100; // Spark 免費方案同時連線上限
const main = document.getElementById('main');
const live = document.getElementById('live');
const liveText = document.getElementById('live-text');
const who = document.getElementById('who');

const VIEWS = [
  ['quiz-vocab', '作答中・單字片語'],
  ['quiz-reading', '作答中・課文理解'],
  ['quiz-pattern', '作答中・句型練習'],
  ['unit', '單元頁（未作答）'],
  ['home', '首頁'],
  ['me', '我的成績'],
  ['login', '輸入資料'],
  ['other', '其他'],
];
const DEVICES = [['mobile', '手機'], ['tablet', '平板'], ['desktop', '電腦']];
const HEALTH = [
  ['sent', '直接送出', 'good', 'check', '交卷當下就確認送到老師試算表'],
  ['queued', '先排隊', 'warn', 'clock', '當下沒送到，存在學生裝置稍後自動重送'],
  ['late', '排隊後送出', 'good', 'check', '排隊的成績之後送到了'],
  ['volatile', '存不了', 'warn', 'alert', '裝置不能暫存，只在記憶體（學生被提醒先別離開）'],
  ['rejected', '被拒收', 'bad', 'alert', '伺服器拒收，學生被請求截圖給老師'],
];

const setLive = (state, text) => { live.dataset.state = state; liveText.textContent = text; };
const keyOf = (email) => String(email || '').toLowerCase().replace(/\./g, ',');

/* ---------------- 登入 ---------------- */
watchStaff((staff) => {
  if (!staff) {
    who.textContent = '';
    setLive('off', '未登入');
    main.innerHTML = `<section class="card mon-card mon-gate">
        <h1>老師登入</h1>
        <p class="muted">即時監控只給老師看。請用老師名單內的 Google 帳號登入。</p>
        <div class="btn-row"><button class="btn primary" type="button" data-in>${icon.user} 用 Google 帳號登入</button></div>
        <p class="form-err" aria-live="polite"></p></section>`;
    main.querySelector('[data-in]').onclick = () => staffSignIn().catch((e) => { main.querySelector('.form-err').textContent = `登入失敗：${e.message}`; });
    return;
  }
  who.innerHTML = `${esc(staff.email)} <button class="link-btn" type="button" data-out>登出</button>`;
  who.querySelector('[data-out]').onclick = () => staffSignOut();
  if (!staff.role) {
    setLive('off', '沒有權限');
    main.innerHTML = `<section class="card mon-card mon-gate"><h1>沒有權限</h1><p class="muted">${esc(staff.email)} 不在老師名單中。</p></section>`;
    return;
  }
  start(staff.email).catch((e) => setupHelp('error', staff.email, e));
});

/* ---------------- 設定說明（資料庫還沒建立、沒有讀取權限） ---------------- */
function setupHelp(kind, email, err) {
  setLive('off', kind === 'denied' ? '沒有讀取權限' : '連不上資料庫');
  const k = keyOf(email);
  main.innerHTML = `<section class="card mon-card mon-gate">
      <h1>${kind === 'denied' ? '還沒開放這個帳號讀取監控資料' : '連不上即時監控資料庫'}</h1>
      ${kind === 'denied' ? `
        <p>請到 Firebase 主控台 → Realtime Database → 資料，在最上層新增：</p>
        <ol class="mon-steps">
          <li>名稱 <code>staff</code>，底下再新增名稱 <code>${esc(k)}</code>、值 <code>true</code>（布林值）。</li>
          <li>email 裡的「.」要換成「,」，全部小寫；其他老師也照同樣方式加。</li>
          <li>回到這一頁重新整理。</li>
        </ol>` : `
        <p>可能的原因：</p>
        <ol class="mon-steps">
          <li>還沒在 Firebase 主控台建立 Realtime Database（建議選新加坡 asia-southeast1）。</li>
          <li><code>js/config.js</code> 的 <code>RTDB_URL</code> 和主控台「資料」頁上方的網址不同。</li>
          <li>還沒部署規則：<code>firebase deploy --only database</code>。</li>
          <li>學校網路擋掉了 Firebase 的連線。</li>
        </ol>
        <p class="muted">目前設定的網址：<code>${esc(RTDB_URL || '（空白，未啟用）')}</code>${err ? `<br>錯誤：${esc(err.message || err)}` : ''}</p>`}
    </section>`;
}

/* ---------------- 即時資料 ---------------- */
async function start(email) {
  if (!RTDB_URL) { setupHelp('error', email); return; }
  main.innerHTML = '<div class="loading"><span class="spinner"></span>連線到即時資料…</div>';
  const m = await import(SDK);
  const db = m.getDatabase(firebaseApp, RTDB_URL);
  const titles = {};
  getConfig().then((c) => { (c.customUnits || []).forEach((u) => { titles[u.id] = u.title || u.id; }); render(); }).catch(() => {});

  let offset = 0;
  let presence = null;
  const stats = {};
  let gotAny = false;
  let denied = false;
  const fail = (err) => {
    if (denied) return;
    denied = true;
    setupHelp(String(err && err.code || err).toUpperCase().includes('PERMISSION') ? 'denied' : 'error', email, err);
  };
  // 8 秒內連不上也收不到資料：多半是資料庫還沒建立或網址不對
  const guard = setTimeout(() => { if (!gotAny) fail(new Error('8 秒內沒有回應')); }, 8000);

  m.onValue(m.ref(db, '.info/serverTimeOffset'), (s) => { offset = Number(s.val()) || 0; });
  m.onValue(m.ref(db, '.info/connected'), (s) => {
    if (denied) return;
    if (s.val()) setLive('on', '即時連線中'); else setLive('wait', '連線中斷，正在重新連線…');
  });
  m.onValue(m.ref(db, 'presence'), (s) => { gotAny = true; clearTimeout(guard); presence = s.val() || {}; render(); }, fail);
  const watchDay = (day) => m.onValue(m.ref(db, `stats/${day}`), (s) => { stats[day] = s.val() || {}; render(); }, fail);
  let days = [];
  const ensureDays = () => {
    const now = Date.now() + offset;
    const want = [hourKey(now - 86400000)[0], hourKey(now)[0]];
    want.filter((d) => !days.includes(d)).forEach(watchDay);
    days = [...new Set([...days, ...want])];
  };
  ensureDays();
  setInterval(() => { ensureDays(); render(); }, 30000); // 過午夜換日、過期的在線紀錄淡出

  // 超過 4 分鐘沒更新的在線紀錄：關掉分頁時伺服器沒收到斷線（很少見），由監控頁清掉
  const sweep = () => {
    if (!presence) return;
    const now = Date.now() + offset;
    Object.entries(presence).forEach(([sid, p]) => { if (now - Number(p.t || 0) > STALE_MS * 3) m.remove(m.ref(db, `presence/${sid}`)).catch(() => {}); });
  };
  setInterval(sweep, 120000);

  let built = false;
  function render() {
    if (denied || !presence) return;
    const now = Date.now() + offset;
    const people = Object.values(presence).filter((p) => now - Number(p.t || 0) <= STALE_MS);
    if (!built) { main.innerHTML = layoutHTML(); built = true; wireTip(); }
    paintNow(people);
    paintHours(now);
  }
  function paintNow(people) {
    const n = people.length;
    const quiz = people.filter((p) => String(p.v).startsWith('quiz')).length;
    main.querySelector('[data-now]').textContent = n;
    main.querySelector('[data-now-sub]').textContent = n ? `作答中 ${quiz} 人・其他畫面 ${n - quiz} 人` : '目前沒有人在線上';
    const used = n + 1; // 加上這個監控頁自己的連線
    const cap = main.querySelector('[data-cap]');
    cap.style.setProperty('--w', `${Math.min(100, (used / CAP) * 100)}%`);
    cap.dataset.level = used >= 90 ? 'bad' : used >= 70 ? 'warn' : 'ok';
    main.querySelector('[data-cap-text]').textContent = `同時連線 ${used} / ${CAP}（免費方案上限，含這個監控頁）`;

    const byView = Object.fromEntries(VIEWS.map(([k]) => [k, 0]));
    people.forEach((p) => { byView[p.v in byView ? p.v : 'other']++; });
    const maxV = Math.max(1, ...Object.values(byView));
    main.querySelector('[data-views]').innerHTML = VIEWS.map(([k, label]) => `<li>
        <span class="hb-label">${esc(label)}</span>
        <span class="hb-track"><span class="hb-bar" style="--w:${(byView[k] / maxV) * 100}%"></span></span>
        <span class="hb-val">${byView[k]}</span></li>`).join('');

    const byUnit = {};
    people.forEach((p) => { if (p.u) byUnit[p.u] = (byUnit[p.u] || 0) + 1; });
    const units = Object.entries(byUnit).sort((a, b) => b[1] - a[1]).slice(0, 10);
    const maxU = Math.max(1, ...units.map((x) => x[1]));
    main.querySelector('[data-units]').innerHTML = units.length
      ? units.map(([id, c]) => `<li>
          <span class="hb-label">${esc(titles[id] || id)}</span>
          <span class="hb-track"><span class="hb-bar" style="--w:${(c / maxU) * 100}%"></span></span>
          <span class="hb-val">${c}</span></li>`).join('')
      : '<li class="muted mon-empty">目前沒有人在單元裡</li>';

    const byDev = { mobile: 0, tablet: 0, desktop: 0 };
    people.forEach((p) => { if (p.d in byDev) byDev[p.d]++; });
    main.querySelector('[data-devices]').innerHTML = DEVICES.map(([k, label]) => `<div class="mon-stat"><b>${byDev[k]}</b><span>${label}</span></div>`).join('');
  }

  // 過去 24 小時（到目前這一小時為止）
  function hours(now) {
    const out = [];
    for (let i = 23; i >= 0; i--) {
      const t = now - i * 3600000;
      const [day, hh] = hourKey(t);
      out.push({ day, hh, ...((stats[day] || {})[hh] || {}) });
    }
    return out;
  }
  function paintHours(now) {
    const hs = hours(now);
    main.querySelector('[data-chart]').innerHTML = chartSVG(hs);
    const total = (f) => hs.reduce((s, h) => s + (Number(h[f]) || 0), 0);
    main.querySelector('[data-sessions-total]').textContent = `共 ${total('sessions')} 人次`;
    main.querySelector('[data-health]').innerHTML = HEALTH.map(([f, label, tone, ic, tip]) => `<div class="mon-health ${tone}" title="${esc(tip)}">
        <span class="mh-ic">${icon[ic] || ''}</span>
        <b>${total(f)}</b><span class="mh-label">${label}</span><span class="mh-tip">${esc(tip)}</span></div>`).join('');
    main.querySelector('[data-table]').innerHTML = `<table class="mon-table"><thead><tr><th>時間</th><th>使用人次</th>${HEALTH.map((h) => `<th>${h[1]}</th>`).join('')}</tr></thead><tbody>${
      hs.slice().reverse().map((h) => `<tr><td>${h.day.slice(5).replace('-', '/')} ${h.hh}:00</td><td>${Number(h.sessions) || 0}</td>${HEALTH.map(([f]) => `<td>${Number(h[f]) || 0}</td>`).join('')}</tr>`).join('')
    }</tbody></table>`;
  }
  function wireTip() {
    const tip = main.querySelector("[data-tooltip]");
    const box = main.querySelector('[data-chart]');
    const show = (el) => {
      const r = el.getBoundingClientRect(); const b = box.getBoundingClientRect();
      tip.innerHTML = el.dataset.tip;
      tip.hidden = false;
      const x = Math.min(b.width - tip.offsetWidth, Math.max(0, r.left - b.left + r.width / 2 - tip.offsetWidth / 2));
      tip.style.transform = `translate(${x}px, 0)`;
    };
    box.addEventListener('pointerover', (e) => { const el = e.target.closest('[data-tip]'); if (el) show(el); });
    box.addEventListener('pointerleave', () => { tip.hidden = true; });
    box.addEventListener('focusin', (e) => { const el = e.target.closest('[data-tip]'); if (el) show(el); });
    box.addEventListener('focusout', () => { tip.hidden = true; });
  }
}

function layoutHTML() {
  return `
    <section class="mon-hero card mon-card">
      <div class="mh-now"><span class="mh-label-top">現在在線</span><b data-now>0</b><span class="muted" data-now-sub></span></div>
      <div class="mon-cap"><span class="mon-cap-track" data-cap><span></span></span><span class="muted" data-cap-text></span></div>
    </section>
    <div class="mon-grid">
      <section class="card mon-card"><h2>在哪個畫面</h2><ul class="hbars" data-views></ul></section>
      <section class="card mon-card"><h2>正在做的單元</h2><ul class="hbars" data-units></ul>
        <h2 class="mon-sub">裝置</h2><div class="mon-stats" data-devices></div></section>
    </div>
    <section class="card mon-card">
      <div class="mon-head"><h2>過去 24 小時・每小時使用人次</h2><span class="muted" data-sessions-total></span></div>
      <div class="mon-chart" data-chart></div>
      <div class="mon-tip" data-tooltip hidden></div>
    </section>
    <section class="card mon-card">
      <h2>過去 24 小時・交卷健康度</h2>
      <div class="mon-healths" data-health></div>
      <details class="mon-details"><summary>每小時明細（表格）</summary><div class="mon-table-wrap" data-table></div></details>
    </section>
    <p class="muted mon-foot">資料為匿名：只記錄畫面、單元與裝置類型，不含學生姓名、班級、座號。閒置 2 分鐘（作答中 6 分鐘）或切到背景 1 分鐘的學生不算在線。</p>`;
}

// 每小時使用人次：單一數列長條圖（同一個顏色，不需要圖例），四捨五入的刻度、細長條、上緣圓角貼齊基線
function chartSVG(hs) {
  const W = 720; const H = 200; const L = 32; const R = 8; const T = 12; const B = 28;
  const vals = hs.map((h) => Number(h.sessions) || 0);
  const max = Math.max(...vals);
  const step = max <= 4 ? 1 : max <= 10 ? 2 : max <= 25 ? 5 : max <= 50 ? 10 : max <= 100 ? 20 : Math.ceil(max / 5 / 50) * 50;
  const top = Math.max(step * 4, Math.ceil(max / step) * step);
  const y = (v) => T + (H - T - B) * (1 - v / top);
  const slot = (W - L - R) / hs.length;
  const bw = Math.max(4, Math.min(18, slot - 6));
  const grid = [];
  for (let v = 0; v <= top; v += step) grid.push(`<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="${v ? 'g' : 'g0'}"/><text x="${L - 6}" y="${y(v) + 4}" class="yl">${v}</text>`);
  const bars = hs.map((h, i) => {
    const v = vals[i];
    const x = L + i * slot + (slot - bw) / 2;
    const yy = y(v); const base = y(0); const r = Math.min(4, bw / 2, base - yy);
    const path = v ? `<path class="bar" d="M${x},${base} V${yy + r} Q${x},${yy} ${x + r},${yy} H${x + bw - r} Q${x + bw},${yy} ${x + bw},${yy + r} V${base} Z"/>` : '';
    const label = Number(h.hh) % 3 === 0 ? `<text x="${x + bw / 2}" y="${H - 8}" class="xl">${Number(h.hh)}時</text>` : '';
    const tip = `<b>${h.day.slice(5).replace('-', '/')} ${h.hh}:00–${h.hh}:59</b><br>使用人次 ${v}`;
    return `${path}${label}<rect class="hit" x="${L + i * slot}" y="${T}" width="${slot}" height="${H - T - B}" tabindex="0" data-tip="${esc(tip)}" aria-label="${esc(`${h.hh} 點 ${v} 人次`)}"/>`;
  }).join('');
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="過去 24 小時每小時使用人次長條圖">${grid.join('')}${bars}</svg>`;
}
