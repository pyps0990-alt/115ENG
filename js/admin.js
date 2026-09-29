// 老師後台（網站版）：只在確認是老師之後才載入，學生的瀏覽器不會下載這個檔案。
// 畫面在網站上，資料一律透過 Apps Script API 讀寫，伺服器端用 Firebase 登入憑證再驗證一次老師身分。
import { SCRIPT_URL } from './config.js';
import { esc } from './util.js';

const MODES = {
  vocab: [['basic', '基礎'], ['advanced', '進階'], ['mastery', '精熟']],
  reading: [['reading', '課文理解']],
};

export function mountAdmin(host, { getToken, legacyUrl }) {
  let units = [];
  const api = async (name, ...args) => {
    const idToken = await getToken();
    const r = await fetch(SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ api: name, args, idToken }),
    });
    const text = await r.text();
    let j;
    try { j = JSON.parse(text); } catch {
      // 收到的是網頁不是資料：通常是 Apps Script 還是舊版、需要重新授權，或部署設定不是「任何人」
      const plain = text.replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      let ver = '';
      try { ver = (await (await fetch(`${SCRIPT_URL}?action=ping`)).json()).version || ''; } catch { ver = ''; }
      throw new Error(`Apps Script 回應的不是資料（${ver ? `後台版本 ${ver}` : '後台可能還是舊版，請確認 clasp push 與 deploy 都有執行'}）：${plain.slice(0, 160) || `HTTP ${r.status}`}`);
    }
    if (!j.ok) throw new Error(j.error || '伺服器錯誤');
    return j.data;
  };

  host.innerHTML = `
    <section class="card teacher adm">
      <div class="adm-tabs" role="tablist">
        <button class="on" type="button" data-tab="settings">單元設定</button>
        <button type="button" data-tab="scores">成績</button>
      </div>
      <div data-pane="settings">
        <div class="btn-row"><button class="btn primary" type="button" data-save>儲存設定</button><span class="adm-msg" data-msg></span></div>
        <p class="muted adm-note">儲存後立即生效，學生打開或重新整理網頁就會看到。</p>
        <div class="adm-scroll"><table class="adm-table">
          <thead><tr><th>顯示</th><th>單元</th><th>包含的階段</th><th>每段題數</th><th></th></tr></thead>
          <tbody data-units><tr><td colspan="5" class="muted">載入中…</td></tr></tbody>
        </table></div>
        <details class="adm-add"><summary>＋ 新增單元</summary>
          <div class="form-grid">
            <div class="field"><label>代號</label><input data-nu="id" placeholder="例：l5-voc" autocomplete="off"></div>
            <div class="field"><label>標題</label><input data-nu="title" placeholder="例：L5 單字片語"></div>
            <div class="field"><label>課次</label><input data-nu="lesson" type="number" min="1" max="99" value="5"></div>
            <div class="field"><label>類型</label><select data-nu="type"><option value="vocab">單字片語</option><option value="reading">課文理解</option></select></div>
          </div>
          <div class="btn-row"><button class="btn" type="button" data-add>加入清單</button><span class="adm-msg" data-nmsg></span></div>
          <p class="muted adm-note">加入後記得按「儲存設定」。題目內容目前仍在舊版後台的「匯入內容」匯入。</p>
        </details>
      </div>
      <div data-pane="scores" hidden>
        <div class="form-grid">
          <div class="field"><label>班級</label><input data-f="cls" inputmode="numeric" placeholder="全部"></div>
          <div class="field"><label>單元</label><select data-f="unit"><option value="">全部</option></select></div>
        </div>
        <div class="btn-row"><button class="btn primary" type="button" data-load>查詢成績</button><button class="btn" type="button" data-wrong>錯題分析</button><span class="adm-msg" data-smsg></span></div>
        <div data-stats></div>
        <div data-result></div>
      </div>
      ${legacyUrl ? `<p class="muted adm-note">匯入內容、AI 出題、學期結算等功能還在搬移中，暫時請用<a href="${esc(legacyUrl)}" target="_blank" rel="noopener">舊版後台</a>（建議用電腦或 Chrome 開啟）。</p>` : ''}
    </section>`;

  const $ = (sel) => host.querySelector(sel);
  const msg = (el, text, kind = '') => { el.textContent = text; el.className = `adm-msg ${kind}`; };

  host.querySelectorAll('.adm-tabs button').forEach((b) => {
    b.onclick = () => {
      host.querySelectorAll('.adm-tabs button').forEach((x) => x.classList.toggle('on', x === b));
      host.querySelectorAll('[data-pane]').forEach((p) => { p.hidden = p.dataset.pane !== b.dataset.tab; });
    };
  });

  /* ---------- 單元設定 ---------- */
  const titleCell = (u) => `
    <input type="text" data-k="title" value="${esc(u.title || u.id)}" class="adm-title">
    <div class="adm-meta"><span>${esc(u.id)}</span>${u.custom ? `
      <label>課次 <input type="number" min="1" max="99" data-k="lesson" value="${esc(u.lesson)}"></label>
      <label>類型 <select data-k="type"><option value="vocab"${u.type === 'vocab' ? ' selected' : ''}>單字片語</option><option value="reading"${u.type === 'reading' ? ' selected' : ''}>課文理解</option></select></label>` : ''}</div>`;

  function render() {
    $('[data-units]').innerHTML = units.map((u, i) => `
      <tr data-i="${i}" class="${u.visible ? '' : 'off'}">
        <td><input type="checkbox" data-k="visible" ${u.visible ? 'checked' : ''} aria-label="顯示"></td>
        <td>${titleCell(u)}</td>
        <td><div class="adm-modes">${(MODES[u.type] || MODES.reading).map(([id, name]) => `<label><input type="checkbox" data-mode="${id}" ${u.disabled.includes(id) ? '' : 'checked'}>${name}</label>`).join('')}</div></td>
        <td>${u.type === 'vocab' ? `<input type="number" min="1" max="100" data-k="questionCount" value="${esc(u.questionCount)}" class="adm-num">` : '<span class="muted">依文章</span>'}</td>
        <td>${u.custom ? '<button class="btn small ghost" type="button" data-del>刪除</button>' : ''}</td>
      </tr>`).join('') || '<tr><td colspan="5" class="muted">沒有單元資料</td></tr>';
    $('[data-f="unit"]').innerHTML = '<option value="">全部</option>' + units.map((u) => `<option value="${esc(u.id)}">${esc(u.title || u.id)}</option>`).join('');
  }
  const dirty = () => msg($('[data-msg]'), '尚未儲存');

  $('[data-units]').addEventListener('change', (e) => {
    const tr = e.target.closest('tr'); if (!tr) return;
    const u = units[Number(tr.dataset.i)];
    const t = e.target;
    if (t.dataset.mode) {
      u.disabled = u.disabled.filter((m) => m !== t.dataset.mode);
      if (!t.checked) u.disabled.push(t.dataset.mode);
    } else if (t.dataset.k) {
      u[t.dataset.k] = t.type === 'checkbox' ? t.checked : t.type === 'number' ? Number(t.value) : t.value;
      if (t.dataset.k === 'visible') tr.classList.toggle('off', !t.checked);
      if (t.dataset.k === 'type') render();
    }
    dirty();
  });
  $('[data-units]').addEventListener('click', (e) => {
    if (!e.target.closest('[data-del]')) return;
    const i = Number(e.target.closest('tr').dataset.i);
    const u = units[i];
    if (!confirm(`確定要刪除「${u.title || u.id}」嗎？按「儲存設定」後，這個單元的代號和匯入的題目會一起清除；學生成績保留到學期結算。`)) return;
    units.splice(i, 1);
    render(); dirty();
  });
  $('[data-add]').onclick = () => {
    const v = (k) => $(`[data-nu="${k}"]`).value.trim();
    const id = v('id'); const title = v('title');
    const m = $('[data-nmsg]');
    if (!/^[a-z0-9-]+$/i.test(id)) { msg(m, '代號只能用英文字母、數字、連字號', 'err'); return; }
    if (units.some((u) => u.id === id)) { msg(m, '這個代號已經存在了', 'err'); return; }
    if (!title) { msg(m, '請填標題', 'err'); return; }
    units.push({ id, title, type: v('type'), lesson: Math.max(1, Number(v('lesson')) || 1), topic: '', visible: true, disabled: [], questionCount: 10, custom: true });
    $('[data-nu="id"]').value = ''; $('[data-nu="title"]').value = '';
    msg(m, `已加入「${title}」，記得按「儲存設定」`, 'ok');
    render(); dirty();
  };
  $('[data-save]').onclick = async (e) => {
    const btn = e.currentTarget; btn.disabled = true;
    msg($('[data-msg]'), '儲存中…');
    try {
      await Promise.all([
        api('saveSettings', units.filter((u) => !u.custom)),
        api('saveCustomUnits', units.filter((u) => u.custom)),
      ]);
      msg($('[data-msg]'), '✓ 已儲存', 'ok');
    } catch (err) {
      msg($('[data-msg]'), `儲存失敗：${err.message}`, 'err');
    } finally { btn.disabled = false; }
  };

  /* ---------- 成績 ---------- */
  const filter = () => ({ cls: $('[data-f="cls"]').value.trim(), unit: $('[data-f="unit"]').value });
  $('[data-load]').onclick = async (e) => {
    const btn = e.currentTarget; btn.disabled = true;
    msg($('[data-smsg]'), '載入中…');
    try {
      const rows = await api('getScores', filter());
      const n = rows.length;
      const avg = n ? Math.round(rows.reduce((a, r) => a + Number(r.pct || 0), 0) / n) : 0;
      $('[data-stats]').innerHTML = n ? `<div class="adm-stats"><span>筆數 ${n}</span><span>平均 ${avg}%</span></div>` : '';
      $('[data-result]').innerHTML = `<div class="adm-scroll"><table class="adm-table">
        <thead><tr><th>時間</th><th>班級</th><th>座號</th><th>姓名</th><th>單元</th><th>分數</th><th>%</th><th>基礎</th><th>進階</th><th>精熟</th><th>錯題</th></tr></thead>
        <tbody>${rows.map((r) => `<tr><td>${esc(r.time)}</td><td>${esc(r.cls)}</td><td>${esc(r.seat)}</td><td>${esc(r.name)}</td><td>${esc(r.unitTitle || r.unit)}</td>
          <td>${esc(r.score)} / ${esc(r.total)}</td><td>${esc(r.pct)}</td><td>${esc(r.basic)}</td><td>${esc(r.advanced)}</td><td>${esc(r.mastery)}</td><td class="wrap">${esc(r.wrong)}</td></tr>`).join('')
          || '<tr><td colspan="11" class="muted">沒有資料</td></tr>'}</tbody></table></div>`;
      msg($('[data-smsg]'), '');
    } catch (err) {
      msg($('[data-smsg]'), `載入失敗：${err.message}`, 'err');
    } finally { btn.disabled = false; }
  };
  $('[data-wrong]').onclick = async (e) => {
    const btn = e.currentTarget; btn.disabled = true;
    msg($('[data-smsg]'), '分析中…');
    try {
      const d = await api('getWrongStats', filter());
      $('[data-stats]').innerHTML = '';
      if (!d.top.length) { $('[data-result]').innerHTML = '<p class="muted">目前的篩選條件下還沒有答錯的紀錄。</p>'; msg($('[data-smsg]'), ''); return; }
      const types = Object.keys(d.errTypes).sort((a, b) => d.errTypes[b] - d.errTypes[a]);
      $('[data-result]').innerHTML = `<h3 class="adm-h3">全班最常答錯（共 ${d.answered} 題次作答）</h3>
        ${types.length ? `<div class="adm-stats">${types.map((t) => `<span>${esc(t)} ${d.errTypes[t]}</span>`).join('')}</div>` : ''}
        <div class="adm-scroll"><table class="adm-table"><thead><tr><th>#</th><th>單字／題目</th><th>單元</th><th>答錯／作答</th><th>答錯率</th><th>主要錯誤</th></tr></thead>
        <tbody>${d.top.map((r, i) => `<tr><td>${i + 1}</td><td class="wrap"><b>${esc(r.word)}</b></td><td>${esc(r.unitTitle)}</td><td>${r.wrong} / ${r.total}</td>
          <td><span class="adm-rate"><span style="width:${r.rate}%"></span></span> ${r.rate}%</td><td>${esc(r.mainErr || '—')}</td></tr>`).join('')}</tbody></table></div>`;
      msg($('[data-smsg]'), '');
    } catch (err) {
      msg($('[data-smsg]'), `分析失敗：${err.message}`, 'err');
    } finally { btn.disabled = false; }
  };

  api('getAdminData').then((d) => {
    units = (d.units || []).concat(d.customUnits || []);
    render();
  }).catch((err) => {
    $('[data-units]').innerHTML = `<tr><td colspan="5" class="adm-msg err">讀取失敗：${esc(err.message)}</td></tr>`;
  });
}
