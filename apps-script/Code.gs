/**
 * B5 Practice — 成績回傳與老師後台（Google Apps Script，綁定在一份 Google 試算表上）
 *
 *   GET  ?action=config  → 學生網站讀取顯示設定（JSON，不需要登入）
 *   POST (text/plain JSON) → 學生正式測驗交卷，寫入 scores 分頁
 *   GET  （不帶參數）     → 老師後台；只有 teachers 分頁白名單裡的 Google 帳號能進入
 *
 * 部署方式請見 README.md。
 */

var SHEET_SCORES = 'scores';
var SHEET_SETTINGS = 'settings';
var SHEET_TEACHERS = 'teachers';
var CONFIG_CACHE_KEY = 'config-json';

var SETTINGS_HEADER = ['id', 'title', 'type', 'visible', 'disabled', 'examOpen', 'examCount', 'examFrom', 'examTo'];
var SCORES_HEADER = ['serverTime', 'cls', 'seat', 'name', 'unit', 'unitTitle', 'mode', 'score', 'total', 'pct', 'wrong', 'durationSec', 'clientTime'];

/* ------------------------------------------------------------------ */
/* Web App entry points                                                */
/* ------------------------------------------------------------------ */

function doGet(e) {
  var action = e && e.parameter && e.parameter.action;
  if (action === 'config') {
    return json_(readConfigCached_());
  }
  var email = currentEmail_();
  if (!isTeacher_(email)) {
    var html = '<meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<div style="font-family:system-ui,sans-serif;max-width:480px;margin:15vh auto;padding:24px;text-align:center">' +
      '<div style="font-size:48px">🔒</div><h2>僅限老師使用</h2>' +
      '<p style="color:#666">' + (email
        ? '目前登入的帳號 <b>' + escapeHtml_(email) + '</b> 不在老師名單中。'
        : '請先用學校的 Google 帳號登入，再重新開啟這個頁面。') + '</p></div>';
    return HtmlService.createHtmlOutput(html).setTitle('B5 Practice 老師後台');
  }
  var t = HtmlService.createTemplateFromFile('Admin');
  t.email = email;
  return t.evaluate()
    .setTitle('B5 Practice 老師後台')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var d = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (!d.name || !d.cls || !d.unit) return json_({ ok: false, error: 'missing fields' });
    sheet_(SHEET_SCORES, SCORES_HEADER).appendRow([
      new Date(),
      cell_(d.cls, 8),
      cell_(d.seat, 4),
      cell_(d.name, 40),
      cell_(d.unit, 60),
      cell_(d.unitTitle, 80),
      cell_(d.mode, 30),
      num_(d.score),
      num_(d.total),
      num_(d.pct),
      cell_((d.wrong || []).join(', '), 1000),
      num_(d.durationSec),
      cell_(d.clientTs, 30),
    ]);
    return json_({ ok: true });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

/* ------------------------------------------------------------------ */
/* Functions called from Admin.html via google.script.run              */
/* ------------------------------------------------------------------ */

function getAdminData() {
  var email = assertTeacher_();
  return {
    email: email,
    units: readSettingsRows_(),
    sheetUrl: SpreadsheetApp.getActiveSpreadsheet().getUrl(),
  };
}

function saveSettings(units) {
  assertTeacher_();
  var sh = sheet_(SHEET_SETTINGS, SETTINGS_HEADER);
  var rows = (units || []).map(function (u) {
    return [
      String(u.id), String(u.title || ''), String(u.type || ''),
      u.visible !== false,
      (u.disabled || []).join(','),
      u.examOpen !== false,
      Number(u.examCount) || 20,
      String(u.examFrom || ''),
      String(u.examTo || ''),
    ];
  });
  var last = sh.getLastRow();
  if (last > 1) sh.getRange(2, 1, last - 1, SETTINGS_HEADER.length).clearContent();
  if (rows.length) {
    sh.getRange(2, 8, rows.length, 2).setNumberFormat('@'); // 日期以文字儲存
    sh.getRange(2, 1, rows.length, SETTINGS_HEADER.length).setValues(rows);
  }
  CacheService.getScriptCache().remove(CONFIG_CACHE_KEY);
  return { ok: true, savedAt: new Date().toISOString() };
}

function getScores(filter) {
  assertTeacher_();
  filter = filter || {};
  var sh = sheet_(SHEET_SCORES, SCORES_HEADER);
  var last = sh.getLastRow();
  if (last < 2) return [];
  var values = sh.getRange(2, 1, last - 1, SCORES_HEADER.length).getValues();
  var tz = Session.getScriptTimeZone();
  var out = [];
  for (var i = values.length - 1; i >= 0 && out.length < 500; i--) {
    var r = values[i];
    if (filter.cls && String(r[1]) !== String(filter.cls)) continue;
    if (filter.unit && String(r[4]) !== String(filter.unit)) continue;
    out.push({
      time: r[0] instanceof Date ? Utilities.formatDate(r[0], tz, 'yyyy-MM-dd HH:mm') : String(r[0]),
      cls: String(r[1]), seat: String(r[2]), name: String(r[3]),
      unit: String(r[4]), unitTitle: String(r[5]), mode: String(r[6]),
      score: r[7], total: r[8], pct: r[9], wrong: String(r[10]), durationSec: r[11],
    });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Config                                                              */
/* ------------------------------------------------------------------ */

function readConfigCached_() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get(CONFIG_CACHE_KEY);
  if (hit) return JSON.parse(hit);
  var cfg = { units: {}, updated: new Date().toISOString() };
  readSettingsRows_().forEach(function (u) {
    cfg.units[u.id] = {
      visible: u.visible, disabled: u.disabled, examOpen: u.examOpen,
      examCount: u.examCount, examFrom: u.examFrom, examTo: u.examTo,
    };
  });
  cache.put(CONFIG_CACHE_KEY, JSON.stringify(cfg), 60);
  return cfg;
}

function readSettingsRows_() {
  var sh = sheet_(SHEET_SETTINGS, SETTINGS_HEADER);
  var last = sh.getLastRow();
  if (last < 2) return [];
  var tz = Session.getScriptTimeZone();
  var fmtDate = function (v) {
    if (v instanceof Date) return Utilities.formatDate(v, tz, 'yyyy-MM-dd');
    return String(v || '').trim();
  };
  return sh.getRange(2, 1, last - 1, SETTINGS_HEADER.length).getValues()
    .filter(function (r) { return String(r[0]).trim(); })
    .map(function (r) {
      return {
        id: String(r[0]).trim(),
        title: String(r[1]),
        type: String(r[2]),
        visible: bool_(r[3], true),
        disabled: String(r[4] || '').split(',').map(function (s) { return s.trim(); }).filter(String),
        examOpen: bool_(r[5], true),
        examCount: Number(r[6]) || 20,
        examFrom: fmtDate(r[7]),
        examTo: fmtDate(r[8]),
      };
    });
}

/* ------------------------------------------------------------------ */
/* Auth                                                                */
/* ------------------------------------------------------------------ */

function currentEmail_() {
  try {
    return String(Session.getActiveUser().getEmail() || '').toLowerCase();
  } catch (err) {
    return '';
  }
}

function isTeacher_(email) {
  if (!email) return false;
  var sh = sheet_(SHEET_TEACHERS, ['email', 'note']);
  var last = sh.getLastRow();
  if (last < 2) return false;
  return sh.getRange(2, 1, last - 1, 1).getValues().some(function (r) {
    return String(r[0]).trim().toLowerCase() === email;
  });
}

function assertTeacher_() {
  var email = currentEmail_();
  if (!isTeacher_(email)) throw new Error('沒有權限：這個帳號不在老師名單中。');
  return email;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function sheet_(name, header) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(header);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, header.length).setFontWeight('bold');
  }
  return sh;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// 防止試算表公式注入（開頭為 = + - @ 的字串會被當成公式）
function cell_(v, max) {
  var s = String(v == null ? '' : v).slice(0, max || 200);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

function num_(v) {
  var n = Number(v);
  return isFinite(n) ? n : '';
}

function bool_(v, dflt) {
  if (v === true || v === false) return v;
  var s = String(v).trim().toLowerCase();
  if (s === 'false' || s === '0' || s === 'no' || s === '否') return false;
  if (s === 'true' || s === '1' || s === 'yes' || s === '是') return true;
  return dflt;
}

function escapeHtml_(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
