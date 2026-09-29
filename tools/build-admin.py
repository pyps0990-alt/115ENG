#!/usr/bin/env python3
"""把 apps-script/Admin.html 轉成網站上的 admin.html（老師後台網站版）。

網站版跟 Apps Script 版用同一份畫面與程式，差別只在：
  - 先用網站的 Firebase 登入確認是老師，才顯示後台、執行後台程式
  - google.script.run 改成呼叫 Apps Script 的 API（附上登入憑證，伺服器端再驗證一次）
  - 「學生名單」分頁直接在這裡匯入名單

改了 apps-script/Admin.html 之後，執行一次：python3 tools/build-admin.py
"""
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent.parent
src = (ROOT / 'apps-script' / 'Admin.html').read_text(encoding='utf-8')

def sub1(old, new, text):
    if old not in text:
        raise SystemExit(f'build-admin: 找不到要替換的內容：{old[:60]!r}')
    return text.replace(old, new, 1)

out = src
out = sub1('  <base target="_top">\n', '', out)
out = sub1('  <meta charset="utf-8">\n', '''  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <title>老師後台 — B5 Practice</title>
  <link rel="icon" href="favicon-32.png" type="image/png" sizes="32x32">
''', out)
out = sub1('<?= email ?>', '<span id="who-email"></span> · <a href="#" id="sign-out" style="color:inherit">登出</a>', out)

# 登入確認畫面；後台本體先藏起來
out = sub1('<body>\n', '''<body>
  <div id="gate" class="wrap" style="max-width:520px;margin:12vh auto;text-align:center">
    <div class="card"><h2 style="margin-top:0">B5 Practice 老師後台</h2><p class="muted" id="gate-msg">確認登入狀態…</p>
      <p id="gate-link" hidden><a class="btn primary" href="/#/teacher">前往老師登入</a></p></div>
  </div>
  <div id="app-root" hidden>
''', out)
out = sub1('  <div id="toast"', '  </div>\n  <div id="toast"', out)

# 學生名單分頁：原本只放一個連到網站老師頁的連結，改成直接在這裡匯入
old_roster = re.search(r'(<section id="tab-roster" hidden>\s*)<div class="card">.*?</div>\s*</div>\s*(<div class="card">)', out, re.S)
if not old_roster:
    raise SystemExit('build-admin: 找不到學生名單分頁')
roster_card = '''<div class="card">
        <h2 style="margin-top:0">匯入學生名單</h2>
        <div class="help">每行一位學生：<b>座號　姓名</b>（用 Tab、空白或逗號隔開，可從試算表直接複製兩欄貼上）。學生要輸入跟名單完全一樣的班級、座號、姓名才能登入。重複匯入同一位學生不會產生重複資料。</div>
        <div class="imp-grid">
          <label>班級<input type="text" id="ro-cls" inputmode="numeric" maxlength="4" placeholder="例：306" style="max-width:160px"></label>
          <label>名單<textarea id="ro-text" spellcheck="false" placeholder="1&#9;王小明&#10;3&#9;李小華"></textarea></label>
        </div>
        <div class="bar" style="margin-top:12px"><button class="btn primary" id="ro-go" type="button">匯入</button><span class="msg" id="ro-msg"></span></div>
        <div id="ro-report" class="report"></div>
      </div>
      '''
out = out[:old_roster.start()] + old_roster.group(1) + roster_card + old_roster.group(2) + out[old_roster.end():]

# 後台程式等登入確認後才執行
out = sub1('  <script>\n', '  <script type="text/plain" id="admin-main">\n', out)

bootstrap = r'''
  <script type="module">
    import { SCRIPT_URL } from './js/config.js';
    const $ = (id) => document.getElementById(id);
    const gate = (text, showLink) => { $('gate-msg').textContent = text; $('gate-link').hidden = !showLink; };
    let fb;
    try { fb = await import('./js/firebase.js'); } catch (e) { gate('無法載入登入元件，請確認網路後重新整理。', false); throw e; }

    // Google 偶爾會回「無法開啟這個檔案」之類的網頁而不是資料（重新整理頁面時比較常見），自動重試兩次
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    async function api(name, args) {
      const idToken = await fb.staffIdToken();
      const body = JSON.stringify({ api: name, args, idToken });
      let lastText = '', lastStatus = 0;
      for (let attempt = 0; attempt < 3; attempt++) {
        if (attempt) await sleep(attempt * 1000);
        let r;
        try {
          r = await fetch(SCRIPT_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body, credentials: 'omit', cache: 'no-store' });
        } catch (err) { lastText = String(err.message || err); continue; }
        const text = await r.text();
        let j;
        try { j = JSON.parse(text); } catch { lastText = text; lastStatus = r.status; continue; }
        if (!j.ok) throw new Error(j.error || '伺服器錯誤');
        return j.data;
      }
      const plain = lastText.replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      throw new Error('Apps Script 暫時沒有回應資料（已重試 3 次），請稍後重新整理：' + (plain.slice(0, 120) || 'HTTP ' + lastStatus));
    }
    // 讓原本 Apps Script 版的 google.script.run 寫法原封不動就能用
    function runner(ok, fail) {
      return new Proxy({}, { get(_, k) {
        if (k === 'withSuccessHandler') return (h) => runner(h, fail);
        if (k === 'withFailureHandler') return (h) => runner(ok, h);
        if (k === 'withUserObject') return () => runner(ok, fail);
        return (...args) => { api(k, args).then((res) => ok && ok(res), (err) => (fail ? fail(err) : console.error(err))); };
      } });
    }

    function parseRoster(text) {
      return text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((line, i) => {
        const [seatRaw = '', ...rest] = line.split(/[\t,，\s]+/);
        const seat = seatRaw.replace(/^0+(?=\d)/, '');
        const name = rest.join('');
        return { line: i + 1, seat, name, ok: /^\d{1,2}$/.test(seat) && !!name };
      });
    }
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    function initRoster() {
      $('ro-go').onclick = async () => {
        const msg = $('ro-msg');
        const cls = $('ro-cls').value.trim();
        if (!/^\d{3,4}$/.test(cls)) { msg.textContent = '班級請填 3～4 位數字'; msg.className = 'msg err'; return; }
        const rows = parseRoster($('ro-text').value);
        const good = rows.filter((r) => r.ok);
        $('ro-report').innerHTML = '<table><thead><tr><th>行</th><th>座號</th><th>姓名</th><th>狀態</th></tr></thead><tbody>' +
          rows.map((r) => `<tr><td>${r.line}</td><td>${esc(r.seat)}</td><td>${esc(r.name)}</td><td>${r.ok ? '✓' : '✗ 座號或姓名格式錯誤'}</td></tr>`).join('') + '</tbody></table>';
        if (!good.length) { msg.textContent = '沒有可匯入的資料'; msg.className = 'msg err'; return; }
        $('ro-go').disabled = true;
        msg.textContent = `匯入中…（${good.length} 位）`; msg.className = 'msg';
        try {
          await fb.importRoster(cls, good);
          msg.textContent = `✓ 已匯入 ${good.length} 位` + (rows.length > good.length ? `，${rows.length - good.length} 行格式錯誤未匯入` : ''); msg.className = 'msg ok';
        } catch (err) {
          msg.textContent = '匯入失敗：' + err.message; msg.className = 'msg err';
        } finally { $('ro-go').disabled = false; }
      };
    }

    let started = false;
    fb.watchStaff((staff) => {
      if (!staff) { if (started) location.reload(); gate('請先在老師頁面用 Google 帳號登入。', true); return; }
      if (!staff.role) { gate(staff.email + ' 不在老師名單中。', true); return; }
      if (started) return;
      started = true;
      $('who-email').textContent = staff.email;
      $('sign-out').onclick = (e) => { e.preventDefault(); fb.staffSignOut(); };
      window.google = { script: { run: runner(null, null) } };
      $('gate').hidden = true;
      $('app-root').hidden = false;
      const s = document.createElement('script');
      s.textContent = $('admin-main').textContent;
      document.body.appendChild(s);
      initRoster();
    });
  </script>
'''
out = sub1('</body>', bootstrap + '</body>', out)

banner = '<!-- 這個檔案由 tools/build-admin.py 從 apps-script/Admin.html 產生，請改 Admin.html 後重新執行，不要直接修改 -->\n'
first, rest = out.split('\n', 1)
(ROOT / 'admin.html').write_text(first + '\n' + banner + rest, encoding='utf-8')
print('admin.html 已更新')
