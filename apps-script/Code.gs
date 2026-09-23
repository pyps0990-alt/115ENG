/**
 * B5 Practice — 成績回傳與老師後台（Google Apps Script，綁定在一份 Google 試算表上）
 *
 *   GET  ?action=config  → 學生網站讀取顯示設定（JSON，不需要登入）
 *   POST (text/plain JSON) → 學生完成測驗（單字片語三段連續、課文理解），寫入 scores 分頁
 *   GET  （不帶參數）     → 老師後台；只有 teachers 分頁白名單裡的 Google 帳號能進入
 *
 * 使用方式：這個檔案和 Admin.html 貼進試算表的 Apps Script，執行一次 setup()，再部署成網頁應用程式。
 * 詳細步驟請見 README.md。
 */

var SHEET_SCORES = 'scores';
var SHEET_SETTINGS = 'settings';
var SHEET_TEACHERS = 'teachers';
var CONFIG_CACHE_KEY = 'config-json';

var SETTINGS_HEADER = ['id', 'title', 'type', 'visible', 'disabled', 'questionCount'];
var SCORES_HEADER = ['serverTime', 'cls', 'seat', 'name', 'unit', 'unitTitle', 'level', 'mode', 'score', 'total', 'pct', 'basic', 'advanced', 'mastery', 'wrong', 'durationSec', 'clientTime'];

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
      cell_(d.level, 20),
      cell_(d.mode, 30),
      num_(d.score),
      num_(d.total),
      num_(d.pct),
      text_(d.basic, 12),
      text_(d.advanced, 12),
      text_(d.mastery, 12),
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
/* 初始化與試算表選單                                                   */
/* ------------------------------------------------------------------ */

/**
 * 第一次使用時執行一次：建立 settings / teachers / scores 三個分頁，
 * 並把目前執行的帳號加入老師名單。之後新增單元時，在 settings 分頁加一列（id 要和 data/lessons/index.json 相同）。
 */
var DEFAULT_UNITS = [
  ['l1-voc', 'L1 單字片語', 'vocab'],
  ['l1-reading', 'L1 課文理解', 'reading'],
  ['l2-voc', 'L2 單字片語', 'vocab'],
  ['l2-reading', 'L2 課文理解', 'reading'],
  ['l3-voc', 'L3 單字片語', 'vocab'],
  ['l3-reading', 'L3 課文理解', 'reading'],
  ['l4-voc', 'L4 單字片語', 'vocab'],
  ['l4-reading', 'L4 課文理解', 'reading'],
];

function setup() {
  var settings = sheet_(SHEET_SETTINGS, SETTINGS_HEADER);
  if (settings.getLastRow() < 2) {
    var rows = DEFAULT_UNITS.map(function (u) { return [u[0], u[1], u[2], true, '', 10]; });
    settings.getRange(2, 1, rows.length, SETTINGS_HEADER.length).setValues(rows);
  }
  var teachers = sheet_(SHEET_TEACHERS, ['email', 'note']);
  var me = Session.getEffectiveUser().getEmail();
  if (me && teachers.getLastRow() < 2) teachers.appendRow([me, '建立者']);
  sheet_(SHEET_SCORES, SCORES_HEADER);
  CacheService.getScriptCache().remove(CONFIG_CACHE_KEY);
  Logger.log('完成。老師名單：' + me);
}

// 試算表上方的「B5 Practice」選單
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('B5 Practice')
    .addItem('初始化（建立分頁）', 'setup')
    .addItem('開啟老師後台', 'openAdmin')
    .addToUi();
}

function openAdmin() {
  var url = ScriptApp.getService().getUrl();
  var ui = SpreadsheetApp.getUi();
  if (!url) {
    ui.alert('還沒部署', '請先在 Apps Script 編輯器按「部署 → 新增部署作業 → 網頁應用程式」。', ui.ButtonSet.OK);
    return;
  }
  var html = HtmlService.createHtmlOutput(
    '<p style="font-family:sans-serif">老師後台網址：</p><p><a href="' + url + '" target="_blank">' + url + '</a></p>'
  ).setWidth(460).setHeight(140);
  ui.showModalDialog(html, 'B5 Practice 老師後台');
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
      Math.min(100, Math.max(1, Number(u.questionCount) || 10)),
    ];
  });
  var last = sh.getLastRow();
  if (last > 1) sh.getRange(2, 1, last - 1, SETTINGS_HEADER.length).clearContent();
  if (rows.length) {
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
      unit: String(r[4]), unitTitle: String(r[5]), level: String(r[6]), mode: String(r[7]),
      score: r[8], total: r[9], pct: r[10],
      basic: String(r[11]), advanced: String(r[12]), mastery: String(r[13]),
      wrong: String(r[14]), durationSec: r[15],
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
    cfg.units[u.id] = { visible: u.visible, disabled: u.disabled, questionCount: u.questionCount };
  });
  cache.put(CONFIG_CACHE_KEY, JSON.stringify(cfg), 60);
  return cfg;
}

function readSettingsRows_() {
  var sh = sheet_(SHEET_SETTINGS, SETTINGS_HEADER);
  var last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, SETTINGS_HEADER.length).getValues()
    .filter(function (r) { return String(r[0]).trim(); })
    .map(function (r) {
      return {
        id: String(r[0]).trim(),
        title: String(r[1]),
        type: String(r[2]),
        visible: bool_(r[3], true),
        disabled: String(r[4] || '').split(',').map(function (s) { return s.trim(); }).filter(String),
        questionCount: Number(r[5]) || 10,
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

// 強制存成文字（例如 "9/10" 不能被試算表當成日期）
function text_(v, max) {
  var s = cell_(v, max);
  return s && s.charAt(0) !== "'" ? "'" + s : s;
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
