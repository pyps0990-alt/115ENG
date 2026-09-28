/**
 * B5 Practice — 成績回傳與老師後台（Google Apps Script，綁定在一份 Google 試算表上）
 *
 *   GET  ?action=config  → 學生網站讀取顯示設定（JSON，不需要登入）
 *   POST (text/plain JSON) → 學生完成測驗（單字片語三段連續、課文理解），寫入 scores 總表、「班級 xxx」分頁與 details（每題明細），用 attemptId 去除重複；
 *                            同時更新「成績單 xxx」矩陣式分頁（老師預先用選單建立名單後才會寫入，只保留每個單元的最高分）
 *   GET  （不帶參數）     → 老師後台；只有 teachers 分頁白名單裡的 Google 帳號能進入
 *
 * 使用方式：這個檔案和 Admin.html 貼進試算表的 Apps Script，執行一次 setup()，再部署成網頁應用程式。
 * 詳細步驟請見 README.md。
 */

var SHEET_SCORES = 'scores';
var SHEET_SETTINGS = 'settings';
var SHEET_TEACHERS = 'teachers';
var SHEET_CONTENT = 'content';
var CONFIG_CACHE_KEY = 'config-json';
var CONTENT_HEADER = ['id', 'json', 'updated', 'updatedBy'];
var MAX_CONTENT_CHARS = 45000; // 試算表單一儲存格上限 50000 字元

// 學生網站的網址：後台「載入網站目前內容」會從這裡讀取內建的題目
var SITE_URL = 'https://eng-3385e.web.app/';

// 老師儲存後，把設定與匯入內容同步寫到 Firestore（public 集合），學生網站直接從 Firestore 讀，
// 不用等 Apps Script 開機（約 2～5 秒）。寫入失敗時學生網站會退回讀 Apps Script，不影響功能。
var FIRESTORE_DOCS = 'https://firestore.googleapis.com/v1/projects/eng-3385e/databases/(default)/documents/public/';

var SETTINGS_HEADER = ['id', 'title', 'type', 'visible', 'disabled', 'questionCount'];

// 老師後台「新增單元」建立的全新單元（網站原本沒有的課次），跟 settings（只調整既有單元的顯示/題數）分開存放。
var SHEET_CUSTOM_UNITS = 'custom_units';
var CUSTOM_UNITS_FIELDS = ['id', 'title', 'type', 'lesson', 'topic', 'visible', 'disabled', 'questionCount'];
var CUSTOM_UNITS_HEADER = ['單元代號', '標題', '類型', '課次', '主題', '顯示', '停用的段落', '每段題數'];

// SCORES_FIELDS／DETAILS_FIELDS：程式內部用的欄位代號，順序要跟 doPost 組 row 的順序一致，不能改。
// SCORES_HEADER／DETAILS_HEADER：實際寫進試算表第一列的中文欄名，只影響顯示，跟 FIELDS 一一對應。
var SCORES_FIELDS = ['serverTime', 'cls', 'seat', 'name', 'unit', 'unitTitle', 'level', 'mode', 'score', 'total', 'pct', 'basic', 'advanced', 'mastery', 'wrong', 'durationSec', 'clientTime', 'attemptId'];
var SCORES_HEADER = ['時間', '班級', '座號', '姓名', '單元', '單元名稱', '階段', '模式', '得分', '總分', '百分比', '基礎', '進階', '精熟', '錯題', '作答秒數', '送出時間(裝置)', '記錄編號'];
var SHEET_DETAILS = 'details';
var DETAILS_FIELDS = ['serverTime', 'attemptId', 'cls', 'seat', 'name', 'unit', 'stage', 'kind', 'n', 'question', 'correct', 'yours', 'ok', 'points', 'hints', 'word', 'err'];
var DETAILS_HEADER = ['時間', '記錄編號', '班級', '座號', '姓名', '單元', '段落', '題型', '題號', '題目', '正確答案', '學生答案', '對錯', '得分', '提示次數', '單字／題目', '錯誤類型'];
var CLASS_SHEET_PREFIX = '班級 ';

/* ------------------------------------------------------------------ */
/* Web App entry points                                                */
/* ------------------------------------------------------------------ */

function doGet(e) {
  var action = e && e.parameter && e.parameter.action;
  if (action === 'config') {
    return json_(readConfigCached_());
  }
  if (action === 'content') {
    return json_(readContentCached_(String(e.parameter.unit || '')));
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
    var attemptId = String(d.attemptId || '').slice(0, 64);
    // 學生端網路不穩時會補送，同一筆成績只寫一次
    if (attemptId && seenAttempt_(attemptId)) return json_({ ok: true, duplicate: true });
    var now = new Date();
    var row = [
      now,
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
      cell_(attemptId, 64),
    ];
    sheet_(SHEET_SCORES, SCORES_HEADER).appendRow(row);
    // 依班級分頁（班級只接受 3–4 位數字）
    var cls = String(d.cls || '').trim();
    if (/^\d{3,4}$/.test(cls)) sheet_(CLASS_SHEET_PREFIX + cls, SCORES_HEADER).appendRow(row);
    // 矩陣式成績單（老師預先建立好名單才會寫入，見「成績單 XXX」分頁）
    writeGradebook_(cls, d.seat, d.unit, d.pct);
    // 每題作答明細
    var details = Array.isArray(d.details) ? d.details.slice(0, 120) : [];
    if (details.length) {
      var rows = details.map(function (x) {
        return [
          now, cell_(attemptId, 64), cell_(d.cls, 8), cell_(d.seat, 4), cell_(d.name, 40), cell_(d.unit, 60),
          cell_(x.stage, 20), cell_(x.kind, 20), num_(x.n), cell_(x.q, 300), cell_(x.correct, 200), cell_(x.yours, 200),
          x.ok ? '✓' : '✗', num_(x.points), num_(x.hints), cell_(x.word, 80), cell_(x.err, 20),
        ];
      });
      var ds = sheet_(SHEET_DETAILS, DETAILS_HEADER);
      // 舊版建立的 details 分頁欄位比較少：補上新欄位的標題
      if (ds.getLastColumn() < DETAILS_HEADER.length) {
        ds.getRange(1, 1, 1, DETAILS_HEADER.length).setValues([DETAILS_HEADER]).setFontWeight('bold');
      }
      ds.getRange(ds.getLastRow() + 1, 1, rows.length, DETAILS_HEADER.length).setValues(rows);
    }
    if (attemptId) CacheService.getScriptCache().put('att:' + attemptId, '1', 21600);
    return json_({ ok: true });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

/* ------------------------------------------------------------------ */
/* 矩陣式成績單（成績單 XXX）——老師預先建立名單，系統只填格子，不新增學生列   */
/* ------------------------------------------------------------------ */

var GRADEBOOK_PREFIX = '成績單 ';
var GRADEBOOK_BASE_HEADER = ['班級', '座號', '姓名'];

// 寫入（或更新）一格分數：找到「座號」對應的列、「單元」對應的欄，只有比原分數高才覆蓋。
// 找不到分頁、找不到座號（名單裡沒有這個學生）都直接略過，不會自動新增列。
function writeGradebook_(cls, seat, unit, pct) {
  var clsTrim = String(cls || '').trim();
  if (!/^\d{3,4}$/.test(clsTrim)) return;
  var seatTrim = String(seat || '').trim();
  var unitTrim = String(unit || '').trim();
  if (!seatTrim || !unitTrim) return;

  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(GRADEBOOK_PREFIX + clsTrim);
  if (!sh) return; // 老師還沒用選單建立這個班級的成績單分頁

  var lastRow = sh.getLastRow();
  var lastCol = sh.getLastColumn();
  if (lastRow < 2 || lastCol < GRADEBOOK_BASE_HEADER.length) return;

  var seatValues = sh.getRange(2, 2, lastRow - 1, 1).getValues();
  var rowIdx = -1;
  for (var i = 0; i < seatValues.length; i++) {
    if (String(seatValues[i][0]).trim() === seatTrim) { rowIdx = i + 2; break; }
  }
  if (rowIdx === -1) return; // 名單裡沒有這個座號

  var unitColCount = lastCol - GRADEBOOK_BASE_HEADER.length;
  var colIdx = -1;
  if (unitColCount > 0) {
    var header = sh.getRange(1, GRADEBOOK_BASE_HEADER.length + 1, 1, unitColCount).getValues()[0];
    for (var j = 0; j < header.length; j++) {
      if (String(header[j]).trim() === unitTrim) { colIdx = GRADEBOOK_BASE_HEADER.length + 1 + j; break; }
    }
  }
  if (colIdx === -1) {
    colIdx = lastCol + 1;
    sh.getRange(1, colIdx).setValue(unitTrim).setFontWeight('bold');
  }

  var cell = sh.getRange(rowIdx, colIdx);
  var next = Number(pct);
  var current = Number(cell.getValue());
  if (isFinite(next) && (!isFinite(current) || next > current)) {
    cell.setValue(next);
  }
}

// 選單用：建立一個班級的成績單範本分頁（班級/座號/姓名 三欄），老師貼上名單後即可使用。
function createGradebookSheet() {
  var ui = SpreadsheetApp.getUi();
  var res = ui.prompt('建立班級成績單', '請輸入班級（例如 306）：', ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;
  var cls = String(res.getResponseText() || '').trim();
  if (!/^\d{3,4}$/.test(cls)) {
    ui.alert('班級請填 3–4 位數字，例如 306。');
    return;
  }
  var name = GRADEBOOK_PREFIX + cls;
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (ss.getSheetByName(name)) {
    ui.alert('「' + name + '」已經存在了。');
    return;
  }
  var sh = ss.insertSheet(name);
  sh.getRange(1, 1, 1, GRADEBOOK_BASE_HEADER.length).setValues([GRADEBOOK_BASE_HEADER]).setFontWeight('bold');
  sh.setFrozenRows(1);
  sh.setFrozenColumns(GRADEBOOK_BASE_HEADER.length);
  ui.alert('建好了，請在「' + name + '」分頁的班級/座號/姓名欄貼上這個班的學生名單（從第 2 列開始），之後學生測驗完分數就會自動填進對應欄位。');
}

function seenAttempt_(id) {
  if (CacheService.getScriptCache().get('att:' + id)) return true;
  var sh = sheet_(SHEET_SCORES, SCORES_HEADER);
  var last = sh.getLastRow();
  if (last < 2) return false;
  var col = SCORES_FIELDS.indexOf('attemptId') + 1;
  var from = Math.max(2, last - 499);
  return sh.getRange(from, col, last - from + 1, 1).getValues().some(function (r) { return String(r[0]) === id; });
}

/* ------------------------------------------------------------------ */
/* 初始化與試算表選單                                                   */
/* ------------------------------------------------------------------ */

/**
 * 第一次使用時執行一次：建立 settings / teachers / scores / details / content 分頁，
 * 並把目前執行的帳號加入老師名單。之後新增單元時，在 settings 分頁加一列（id 要和 data/lessons/index.json 相同）。
 */
var DEFAULT_UNITS = [
  ['l1-voc', 'L1 單字片語', 'vocab'],
  ['l1-reading', 'L1 課文理解', 'reading'],
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
  sheet_(SHEET_CONTENT, CONTENT_HEADER);
  sheet_(SHEET_DETAILS, DETAILS_HEADER);
  sheet_(SHEET_CUSTOM_UNITS, CUSTOM_UNITS_HEADER);
  CacheService.getScriptCache().remove(CONFIG_CACHE_KEY);
  Logger.log('完成。老師名單：' + me);
}

// 試算表上方的「B5 Practice」選單
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('B5 Practice')
    .addItem('初始化（建立分頁）', 'setup')
    .addItem('建立班級成績單', 'createGradebookSheet')
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
    customUnits: readCustomUnitsRows_(),
    content: readContentRows_().map(function (r) { return { id: r.id, updated: r.updated, updatedBy: r.updatedBy, count: r.count }; }),
    siteUrl: SITE_URL,
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
  publishConfig_();
  return { ok: true, savedAt: new Date().toISOString() };
}

// 老師後台「新增單元」：讀取／整批覆寫全新單元清單。id 只接受英數字與連字號，
// 網站前端會把這些單元併進首頁與課次清單；內容仍要靠「匯入內容」分頁填入才會有實際題目。
function readCustomUnitsRows_() {
  var sh = sheet_(SHEET_CUSTOM_UNITS, CUSTOM_UNITS_HEADER);
  var last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, CUSTOM_UNITS_FIELDS.length).getValues()
    .filter(function (r) { return String(r[0]).trim(); })
    .map(function (r) {
      return {
        id: String(r[0]).trim(),
        title: String(r[1] || r[0]),
        type: String(r[2]) === 'reading' ? 'reading' : 'vocab',
        lesson: Math.max(1, Number(r[3]) || 1),
        topic: String(r[4] || ''),
        visible: bool_(r[5], true),
        disabled: String(r[6] || '').split(',').map(function (s) { return s.trim(); }).filter(String),
        questionCount: Number(r[7]) || 10,
        custom: true,
      };
    });
}

function saveCustomUnits(units) {
  assertTeacher_();
  var rows = (units || [])
    .filter(function (u) { return /^[a-z0-9-]+$/i.test(String(u.id || '').trim()); })
    .map(function (u) {
      return [
        String(u.id).trim(), String(u.title || u.id), (u.type === 'reading' ? 'reading' : 'vocab'),
        Math.max(1, Number(u.lesson) || 1), String(u.topic || ''),
        u.visible !== false, (u.disabled || []).join(','),
        Math.min(100, Math.max(1, Number(u.questionCount) || 10)),
      ];
    });
  // 被刪掉的單元：連同代號一起清除（匯入的題目、Firestore 上的題目），代號可以重新使用。
  // 學生成績不在這裡刪，留到學期結算時由老師決定。
  var keep = {};
  rows.forEach(function (r) { keep[r[0]] = true; });
  var removed = readCustomUnitsRows_().map(function (u) { return u.id; }).filter(function (id) { return !keep[id]; });
  var sh = sheet_(SHEET_CUSTOM_UNITS, CUSTOM_UNITS_HEADER);
  var last = sh.getLastRow();
  if (last > 1) sh.getRange(2, 1, last - 1, CUSTOM_UNITS_FIELDS.length).clearContent();
  if (rows.length) sh.getRange(2, 1, rows.length, CUSTOM_UNITS_FIELDS.length).setValues(rows);
  removed.forEach(purgeUnit_);
  publishConfig_();
  return { ok: true, savedAt: new Date().toISOString() };
}

// 老師後台「錯題分析」：從 details 統計全班最常答錯的單字／題目，以及錯誤類型分布
function getWrongStats(filter) {
  assertTeacher_();
  filter = filter || {};
  var sh = sheet_(SHEET_DETAILS, DETAILS_HEADER);
  var last = sh.getLastRow();
  var empty = { top: [], errTypes: {}, answered: 0 };
  if (last < 2) return empty;
  var from = Math.max(2, last - 19999);
  var rows = sh.getRange(from, 1, last - from + 1, DETAILS_FIELDS.length).getValues();
  var col = function (k) { return DETAILS_FIELDS.indexOf(k); };
  var cCls = col('cls'), cUnit = col('unit'), cWord = col('word'), cOk = col('ok'), cErr = col('err'), cCorrect = col('correct');
  var titles = {};
  readSettingsRows_().concat(readCustomUnitsRows_()).forEach(function (u) { titles[u.id] = u.title; });
  var groups = {}, errTypes = {}, answered = 0;
  rows.forEach(function (r) {
    var word = String(r[cWord] || '').trim();
    if (!word) return;
    if (filter.cls && String(r[cCls]).trim() !== String(filter.cls).trim()) return;
    if (filter.unit && String(r[cUnit]) !== filter.unit) return;
    answered++;
    var key = r[cUnit] + '\u0001' + word;
    var g = groups[key] || (groups[key] = { unit: String(r[cUnit]), word: word, total: 0, wrong: 0, errs: {}, answer: '' });
    g.total++;
    if (String(r[cOk]) === '✓') return;
    g.wrong++;
    var e = String(r[cErr] || '').trim();
    if (e) { g.errs[e] = (g.errs[e] || 0) + 1; errTypes[e] = (errTypes[e] || 0) + 1; }
    if (!g.answer) g.answer = String(r[cCorrect] || '');
  });
  var top = Object.keys(groups).map(function (k) { return groups[k]; })
    .filter(function (g) { return g.wrong > 0; })
    .sort(function (a, b) { return b.wrong - a.wrong || b.wrong / b.total - a.wrong / a.total; })
    .slice(0, 15)
    .map(function (g) {
      var main = Object.keys(g.errs).sort(function (a, b) { return g.errs[b] - g.errs[a]; })[0] || '';
      return { unit: g.unit, unitTitle: titles[g.unit] || g.unit, word: g.word, total: g.total, wrong: g.wrong,
        rate: Math.round((g.wrong / g.total) * 100), mainErr: main };
    });
  return { top: top, errTypes: errTypes, answered: answered };
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
/* 匯入內容（單字片語、課文理解）                                        */
/* ------------------------------------------------------------------ */

function getContent(unitId) {
  assertTeacher_();
  var row = findContentRow_(unitId);
  return row ? { data: JSON.parse(row.json), updated: row.updated, updatedBy: row.updatedBy } : null;
}

function saveContent(unitId, data) {
  var email = assertTeacher_();
  unitId = String(unitId || '').trim();
  var type = unitType_(unitId);
  if (!type) throw new Error('找不到單元：' + unitId);
  var err = validateContent_(type, data);
  if (err) throw new Error(err);
  var json = JSON.stringify(data);
  if (json.length > MAX_CONTENT_CHARS) throw new Error('內容太長（' + json.length + ' 字元），請分成兩個單元。');
  var now = new Date().toISOString();
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sh = sheet_(SHEET_CONTENT, CONTENT_HEADER);
    var row = findContentRow_(unitId);
    var values = [[unitId, json, now, email]];
    if (row) sh.getRange(row.index, 1, 1, 4).setValues(values);
    else sh.appendRow(values[0]);
  } finally {
    lock.releaseLock();
  }
  clearContentCache_(unitId);
  // 版本號用設定裡的 updated（跟網站比對用的是同一個值）
  var cfg = publishConfig_();
  var v = (cfg.content[unitId] || {}).updated || now;
  publishDoc_('content_' + unitId, JSON.stringify({ v: v, data: data }));
  return { ok: true, count: countOf_(type, data) };
}

// 刪除匯入的內容，網站改回使用內建題目
function deleteContent(unitId) {
  assertTeacher_();
  var row = findContentRow_(unitId);
  if (row) sheet_(SHEET_CONTENT, CONTENT_HEADER).deleteRow(row.index);
  clearContentCache_(unitId);
  publishConfig_();
  return { ok: true };
}

function purgeUnit_(unitId) {
  var row = findContentRow_(unitId);
  if (row) sheet_(SHEET_CONTENT, CONTENT_HEADER).deleteRow(row.index);
  clearContentCache_(unitId);
  firestoreRequest_('delete', FIRESTORE_DOCS + encodeURIComponent('content_' + unitId));
}

/* ------------------------------------------------------------------ */
/* 學期結算：先備份，再由老師選擇要清除哪些資料                         */
/* ------------------------------------------------------------------ */

// 把整份試算表複製一份到老師的雲端硬碟（成績、明細、成績單都在裡面）
function backupSpreadsheet() {
  assertTeacher_();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var name = ss.getName() + ' 成績備份 ' + Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd HHmm');
  var copy = ss.copy(name);
  return { ok: true, name: name, url: copy.getUrl() };
}

// opts: { sheets: 試算表成績, attempts: Firestore 作答與檢討紀錄, roster: 學生名單 }
// Firestore 資料很多時一次刪不完：回傳 done:false，後台會自動再呼叫一次。
function semesterReset(opts) {
  assertTeacher_();
  opts = opts || {};
  var out = { done: true, sheets: 0, docs: 0 };
  if (opts.sheets && !opts.skipSheets) {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    ss.getSheets().forEach(function (sh) {
      var n = sh.getName();
      if (n === SHEET_SCORES || n === SHEET_DETAILS) {
        if (sh.getLastRow() > 1) sh.deleteRows(2, sh.getLastRow() - 1);
        out.sheets++;
      } else if (n.indexOf(CLASS_SHEET_PREFIX) === 0 || n.indexOf(GRADEBOOK_PREFIX) === 0) {
        ss.deleteSheet(sh);
        out.sheets++;
      }
    });
  }
  var groups = [];
  if (opts.attempts || opts.roster) groups.push('attempts', 'reviews');
  if (opts.roster) groups.push('vault', 'seats');
  var deadline = Date.now() + 240000;
  for (var g = 0; g < groups.length; g++) {
    while (true) {
      if (Date.now() > deadline) { out.done = false; return out; }
      var names = firestoreList_(groups[g], 300);
      if (!names.length) break;
      firestoreDelete_(names);
      out.docs += names.length;
    }
  }
  return out;
}

// 危險功能：刪除某個單元的所有紀錄（成績、作答明細、檢討狀態、單元設定、匯入題目；試算表＋Firestore）。預設關閉：
// 管理者要先在 Apps Script「專案設定 → 指令碼屬性」新增 PURGE_PASSPHRASE（通關密語），輸入相同密語才能執行。
function purgeUnitScores(unitId, passphrase) {
  assertTeacher_();
  var secret = PropertiesService.getScriptProperties().getProperty('PURGE_PASSPHRASE');
  if (!secret) throw new Error('這個功能尚未啟用：請管理者在 Apps Script 專案設定的「指令碼屬性」新增 PURGE_PASSPHRASE。');
  if (String(passphrase || '') !== secret) throw new Error('通關密語錯誤。');
  unitId = String(unitId || '').trim();
  if (!/^[a-z0-9-]+$/i.test(unitId)) throw new Error('單元代號格式錯誤。');
  var out = { rows: 0, docs: 0, done: true };
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ss.getSheets().forEach(function (sh) {
    var n = sh.getName();
    var col = (n === SHEET_SCORES || n.indexOf(CLASS_SHEET_PREFIX) === 0) ? SCORES_FIELDS.indexOf('unit') + 1
      : n === SHEET_DETAILS ? DETAILS_FIELDS.indexOf('unit') + 1 : 0;
    if (col) {
      var last = sh.getLastRow();
      if (last < 2) return;
      var vals = sh.getRange(2, col, last - 1, 1).getValues();
      for (var i = vals.length - 1; i >= 0; i--) {
        if (String(vals[i][0]).trim() !== unitId) continue;
        var j = i; while (j > 0 && String(vals[j - 1][0]).trim() === unitId) j--;
        sh.deleteRows(j + 2, i - j + 1); out.rows += i - j + 1; i = j;
      }
    } else if (n.indexOf(GRADEBOOK_PREFIX) === 0 && sh.getLastColumn() > GRADEBOOK_BASE_HEADER.length) {
      var head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
      for (var c = head.length - 1; c >= GRADEBOOK_BASE_HEADER.length; c--) {
        if (String(head[c]).trim() === unitId) sh.deleteColumn(c + 1);
      }
    }
  });
  // Firestore：這個單元的作答紀錄與檢討狀態
  var deadline = Date.now() + 240000;
  var after = null;
  while (true) {
    if (Date.now() > deadline) { out.done = false; return out; }
    var page = firestorePage_('attempts', ['unit'], after, 300);
    if (!page.length) break;
    var hit = page.filter(function (d) { return d.fields && d.fields.unit && d.fields.unit.stringValue === unitId; })
      .map(function (d) { return d.name; });
    if (hit.length) { firestoreDelete_(hit); out.docs += hit.length; }
    after = page[page.length - 1].name;
  }
  var reviews = firestoreList_('reviews', 5000).filter(function (n) { return /\/reviews\/([^/]+)$/.exec(n)[1] === unitId; });
  for (var k = 0; k < reviews.length; k += 300) { firestoreDelete_(reviews.slice(k, k + 300)); out.docs += Math.min(300, reviews.length - k); }
  // 單元本身：設定列、自訂單元列、匯入的題目（試算表與 Firestore），全部清除後代號可重新使用
  [[SHEET_SETTINGS, SETTINGS_HEADER], [SHEET_CUSTOM_UNITS, CUSTOM_UNITS_HEADER]].forEach(function (t) {
    var sh = sheet_(t[0], t[1]);
    var last = sh.getLastRow();
    if (last < 2) return;
    var ids = sh.getRange(2, 1, last - 1, 1).getValues();
    for (var r = ids.length - 1; r >= 0; r--) if (String(ids[r][0]).trim() === unitId) sh.deleteRow(r + 2);
  });
  purgeUnit_(unitId);
  publishConfig_();
  return out;
}

// 依文件路徑排序、一頁一頁讀出某個集合名稱的所有文件（只取指定欄位）
function firestorePage_(collectionId, fields, afterName, limit) {
  var q = {
    from: [{ collectionId: collectionId, allDescendants: true }],
    select: { fields: fields.map(function (f) { return { fieldPath: f }; }) },
    orderBy: [{ field: { fieldPath: '__name__' }, direction: 'ASCENDING' }],
    limit: limit,
  };
  if (afterName) q.startAt = { values: [{ referenceValue: afterName }], before: false };
  var res = firestoreRequest_('post', FIRESTORE_ROOT + ':runQuery', { structuredQuery: q }) || [];
  return res.filter(function (r) { return r.document; }).map(function (r) { return r.document; });
}

function firestoreRequest_(method, url, body) {
  var res = UrlFetchApp.fetch(url, {
    method: method,
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    payload: body ? JSON.stringify(body) : undefined,
    muteHttpExceptions: true,
  });
  var code = res.getResponseCode();
  if (code >= 300 && code !== 404) throw new Error('Firestore 錯誤 ' + code + '：' + res.getContentText().slice(0, 300));
  return code === 404 ? null : JSON.parse(res.getContentText() || 'null');
}

var FIRESTORE_ROOT = 'https://firestore.googleapis.com/v1/projects/eng-3385e/databases/(default)/documents';

// 列出某個集合名稱（不論在哪一層）的文件路徑
function firestoreList_(collectionId, limit) {
  var res = firestoreRequest_('post', FIRESTORE_ROOT + ':runQuery', {
    structuredQuery: {
      from: [{ collectionId: collectionId, allDescendants: true }],
      select: { fields: [{ fieldPath: '__name__' }] },
      limit: limit,
    },
  }) || [];
  return res.filter(function (r) { return r.document; }).map(function (r) { return r.document.name; });
}

function firestoreDelete_(names) {
  firestoreRequest_('post', FIRESTORE_ROOT + ':commit', {
    writes: names.map(function (n) { return { delete: n }; }),
  });
}

function getSiteUrl() {
  assertTeacher_();
  return SITE_URL;
}

function readContentCached_(unitId) {
  var key = 'content:' + unitId;
  var cache = CacheService.getScriptCache();
  var hit = cache.get(key);
  if (hit) return JSON.parse(hit);
  var row = findContentRow_(unitId);
  var out = row ? { ok: true, updated: row.updated, data: JSON.parse(row.json) } : { ok: false };
  var s = JSON.stringify(out);
  if (s.length < 90000) cache.put(key, s, 300);
  return out;
}

function clearContentCache_(unitId) {
  var cache = CacheService.getScriptCache();
  cache.remove('content:' + unitId);
  cache.remove(CONFIG_CACHE_KEY);
}

function readContentRows_() {
  var sh = sheet_(SHEET_CONTENT, CONTENT_HEADER);
  var last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, 4).getValues()
    .map(function (r, i) {
      var id = String(r[0]).trim();
      if (!id) return null;
      var data = {};
      try { data = JSON.parse(r[1]); } catch (err) { return null; }
      var type = unitType_(id) || (data.words ? 'vocab' : 'reading');
      return { index: i + 2, id: id, json: String(r[1]), updated: String(r[2]), updatedBy: String(r[3]), count: countOf_(type, data), topic: String(data.topic || '') };
    })
    .filter(Boolean);
}

function findContentRow_(unitId) {
  var rows = readContentRows_();
  for (var i = 0; i < rows.length; i++) if (rows[i].id === unitId) return rows[i];
  return null;
}

function unitType_(unitId) {
  var rows = readSettingsRows_().concat(readCustomUnitsRows_());
  for (var i = 0; i < rows.length; i++) if (rows[i].id === unitId) return rows[i].type;
  return '';
}

function countOf_(type, data) {
  return type === 'vocab' ? (data.words || []).length : (data.questions || []).length;
}

// 伺服器端的最後把關（詳細檢查在後台頁面上進行）
function validateContent_(type, d) {
  if (!d || typeof d !== 'object') return '資料格式錯誤';
  if (type === 'vocab') {
    if (!Array.isArray(d.words) || d.words.length < 4) return '單字片語至少要 4 個';
    for (var i = 0; i < d.words.length; i++) {
      var w = d.words[i];
      if (!w.word || !w.zh) return '第 ' + (i + 1) + ' 個缺少英文或中文';
      if (!/\[[^\]]+\]/.test(w.example || '')) return '「' + w.word + '」的例句沒有用 [ ] 標出要考的字';
    }
    return '';
  }
  if (!Array.isArray(d.passage) || !d.passage.length) return '缺少文章';
  if (!Array.isArray(d.questions) || !d.questions.length) return '至少要 1 題';
  for (var j = 0; j < d.questions.length; j++) {
    var q = d.questions[j];
    if (!q.q || !Array.isArray(q.options) || q.options.length < 2) return '第 ' + (j + 1) + ' 題不完整';
    if (!(q.answer >= 0 && q.answer < q.options.length)) return '第 ' + (j + 1) + ' 題沒有設定正確答案';
  }
  return '';
}

/* ------------------------------------------------------------------ */
/* AI 出題（Google Gemini）                                              */
/* ------------------------------------------------------------------ */
// API 金鑰存在「指令碼屬性」，只有老師能在後台設定，不會傳到學生網站。

var AI_KEY_PROP = 'GEMINI_API_KEY';
var AI_MODEL_PROP = 'GEMINI_MODEL';
var AI_DEFAULT_MODEL = 'gemini-2.5-flash';
var AI_MAX_COPY = 6; // 和課文連續相同的英文字數上限（與後台、tools/check-content.mjs 一致）
var SKILLS = ['主旨', '細節', '字義', '推論', '態度'];

function getAiStatus() {
  assertTeacher_();
  var props = PropertiesService.getScriptProperties();
  var key = props.getProperty(AI_KEY_PROP) || '';
  return { configured: !!key, hint: key ? '…' + key.slice(-4) : '', model: props.getProperty(AI_MODEL_PROP) || AI_DEFAULT_MODEL };
}

function setAiSettings(key, model) {
  assertTeacher_();
  var props = PropertiesService.getScriptProperties();
  key = String(key || '').trim();
  model = String(model || '').trim();
  if (key) props.setProperty(AI_KEY_PROP, key);
  if (model) props.setProperty(AI_MODEL_PROP, model);
  return getAiStatus();
}

function clearAiKey() {
  assertTeacher_();
  PropertiesService.getScriptProperties().deleteProperty(AI_KEY_PROP);
  return getAiStatus();
}

// 課文理解：依文章產生選擇題（題目、選項改寫，不照抄文章）
function aiGenerateReading(passage, count, title) {
  assertTeacher_();
  passage = (passage || []).map(String).filter(function (p) { return p.trim(); });
  if (!passage.length) throw new Error('請先貼上文章');
  count = Math.max(1, Math.min(10, Number(count) || 5));
  var text = passage.map(function (p, i) {
    return splitSentences_(p).map(function (s, j) { return '[' + (i + 1) + '-' + (j + 1) + '] ' + s; }).join(' ');
  }).join('\n\n');
  var schema = {
    type: 'OBJECT',
    properties: {
      questions: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            skill: { type: 'STRING', enum: SKILLS },
            q: { type: 'STRING' },
            options: { type: 'ARRAY', items: { type: 'STRING' } },
            answer: { type: 'INTEGER' },
            explain: { type: 'STRING' },
            ref: { type: 'STRING' },
            key: { type: 'STRING' },
          },
          required: ['skill', 'q', 'options', 'answer', 'explain', 'ref', 'key'],
        },
      },
    },
    required: ['questions'],
  };
  var prompt = [
    'You are an experienced English teacher at a senior high school in Taiwan, writing a reading comprehension quiz for 11th-grade students.',
    'Write exactly ' + count + ' multiple-choice questions about the passage below' + (title ? ' (title: "' + title + '")' : '') + '.',
    'Rules:',
    '- Mix these question types and put the type in "skill": 主旨 (main idea), 細節 (detail), 字義 (word meaning in context), 推論 (inference), 態度 (attitude/tone). Use 主旨 at most once.',
    '- Each question has exactly 4 options in English; exactly one is correct. "answer" is the 0-based index of the correct option. Vary the position of the correct answer.',
    '- Wrong options must be plausible and similar in length, but clearly wrong according to the passage. Do not use "All of the above" or "None of the above".',
    '- Paraphrase. Never copy ' + (AI_MAX_COPY - 1) + ' or more consecutive words from the passage into a question or an option. Students must understand the passage, not match words.',
    '- For 字義 questions you may quote the single target word or short phrase in quotation marks.',
    '- Every sentence in the passage is labelled [paragraph-sentence], e.g. [2-3] is paragraph 2, sentence 3.',
    '- "ref" is the label (without brackets, e.g. "2-3") of the ONE sentence that best supports the correct answer. For 主旨 questions with no single supporting sentence, use "".',
    '- "key" is the exact words copied from the passage (3–25 words, within one paragraph, may cross a sentence boundary, without the [x-y] labels) that directly prove the correct answer — the precise clue a teacher would underline, not the whole sentence if only part of it matters. This is the ONLY field that must be copied verbatim. For 主旨 questions use "".',
    '- "explain" is a short explanation in Traditional Chinese (Taiwan usage), saying which paragraph supports the answer and why.',
    '- Keep the English at a CEFR B1–B2 level.',
    '',
    'Passage:',
    text,
  ].join('\n');

  var pw = aiWords_(passage.join(' '));
  var refs = {};
  passage.forEach(function (p, i) { splitSentences_(p).forEach(function (s, j) { refs[(i + 1) + '-' + (j + 1)] = true; }); });
  var result = aiCall_(prompt, schema);
  var qs = cleanQuestions_(result.questions || [], refs, passage);
  var copied = copiedParts_(qs, pw);
  if (copied.length) {
    // 有照抄就請 AI 改寫一次
    var retry = prompt + '\n\nYour previous answer copied these phrases from the passage. Rewrite so that no question or option copies ' + (AI_MAX_COPY - 1) + '+ consecutive words:\n- ' + copied.join('\n- ');
    qs = cleanQuestions_((aiCall_(retry, schema).questions) || [], refs, passage);
  }
  if (!qs.length) throw new Error('AI 沒有產生可用的題目，請再試一次');
  return { questions: qs.slice(0, count) };
}

// 單字片語：補上詞性、中文、例句（用 [ ] 標出目標字）與例句翻譯
function aiFillVocab(items) {
  assertTeacher_();
  items = (items || []).map(function (x) { return String(x || '').trim(); }).filter(String).slice(0, 60);
  if (!items.length) throw new Error('請先輸入英文單字或片語');
  var schema = {
    type: 'OBJECT',
    properties: {
      words: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            word: { type: 'STRING' }, pos: { type: 'STRING' }, zh: { type: 'STRING' },
            example: { type: 'STRING' }, exampleZh: { type: 'STRING' },
          },
          required: ['word', 'pos', 'zh', 'example', 'exampleZh'],
        },
      },
    },
    required: ['words'],
  };
  var prompt = [
    'You are an English teacher at a senior high school in Taiwan preparing a vocabulary list for 11th-grade students.',
    'For each English word or phrase below, return one entry in the same order with:',
    '- "word": exactly as given',
    '- "pos": one of n. / v. / adj. / adv. / prep. / conj. / phr. (use "phr." for multi-word phrases; for words with two common uses write e.g. "n. / v.")',
    '- "zh": the most common meaning in Traditional Chinese (Taiwan usage), short, with ； between senses, at most two senses',
    '- "example": one natural example sentence at CEFR B1–B2 level, 8–16 words, in which the target word or phrase appears once and is wrapped in square brackets, e.g. "The team [bounced back] after the loss." The bracketed text may be an inflected form (past tense, plural, -ing).',
    '- "exampleZh": a natural Traditional Chinese translation of the example',
    '',
    'Words:',
    items.map(function (w, i) { return (i + 1) + '. ' + w; }).join('\n'),
  ].join('\n');
  var out = (aiCall_(prompt, schema).words || []).map(function (w) {
    return {
      word: String(w.word || '').trim(), pos: String(w.pos || '').trim(), zh: String(w.zh || '').trim(),
      example: String(w.example || '').trim(), exampleZh: String(w.exampleZh || '').trim(),
    };
  }).filter(function (w) { return w.word; });
  return { words: out };
}

function aiCall_(prompt, schema) {
  var props = PropertiesService.getScriptProperties();
  var key = props.getProperty(AI_KEY_PROP);
  if (!key) throw new Error('還沒有設定 Gemini API 金鑰，請先在「AI 設定」填入');
  var model = props.getProperty(AI_MODEL_PROP) || AI_DEFAULT_MODEL;
  var res = UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent', {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-goog-api-key': key },
    muteHttpExceptions: true,
    payload: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json', responseSchema: schema, temperature: 0.7 },
    }),
  });
  var code = res.getResponseCode();
  var body = res.getContentText();
  if (code !== 200) {
    var msg = '';
    try { msg = JSON.parse(body).error.message; } catch (err) { msg = body.slice(0, 200); }
    if (code === 400 && /API key/i.test(msg)) throw new Error('API 金鑰無效，請到「AI 設定」重新填入');
    if (code === 403) throw new Error('這組金鑰沒有權限使用 Gemini（學校帳號可能被管理員關閉，可改用個人 Gmail 申請）：' + msg);
    if (code === 404) throw new Error('找不到模型「' + model + '」，請到「AI 設定」改成目前可用的模型名稱');
    if (code === 429) throw new Error('Gemini 用量已達上限（免費額度），請過幾分鐘再試');
    throw new Error('Gemini 錯誤 ' + code + '：' + msg);
  }
  var data = JSON.parse(body);
  var cand = data.candidates && data.candidates[0];
  var text = cand && cand.content && cand.content.parts && cand.content.parts.map(function (p) { return p.text || ''; }).join('');
  if (!text) throw new Error('Gemini 沒有回傳內容' + (cand && cand.finishReason ? '（' + cand.finishReason + '）' : '') + '，請再試一次');
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error('Gemini 回傳的格式無法解析，請再試一次');
  }
}

// 引號統一、不分大小寫（跟網站比對關鍵字句的方式一樣）
function normQ_(s) { return String(s).replace(/[‘’]/g, "'").replace(/[“”]/g, '"').toLowerCase(); }

function cleanQuestions_(qs, refs, paras) {
  var normParas = (paras || []).map(normQ_);
  return qs.map(function (q) {
    var options = (q.options || []).map(function (o) { return String(o || '').trim(); }).filter(String).slice(0, 4);
    var answer = Number(q.answer);
    var ref = String(q.ref || '').replace(/[\[\]\s]/g, '');
    var out = {
      skill: SKILLS.indexOf(q.skill) >= 0 ? q.skill : '細節',
      q: String(q.q || '').trim(),
      options: options,
      answer: answer >= 0 && answer < options.length ? answer : -1,
      explain: String(q.explain || '').trim(),
    };
    if (refs && refs[ref]) out.ref = ref;
    // AI 給的關鍵字句必須真的出現在文章裡（同一段），找不到就不要
    var key = String(q.key || '').replace(/\[\d+-\d+\]\s*/g, '').replace(/\s+/g, ' ').trim();
    if (key && normParas.some(function (p) { return p.indexOf(normQ_(key)) >= 0; })) out.key = key;
    return out;
  }).filter(function (q) { return q.q && q.options.length >= 2 && q.answer >= 0; });
}

// 跟網站 js/util.js 的 splitSentences 同一套切句規則，課文題目的 ref（段-句）才對得上
function splitSentences_(p) {
  return (String(p).match(/[^.!?]+(?:[.!?]+["'”’)\]]*|$)/g) || []).map(function (s) { return s.trim(); }).filter(String);
}

function aiWords_(s) { return String(s).toLowerCase().replace(/[“”"]/g, ' ').match(/[a-z0-9']+/g) || []; }

function copiedParts_(qs, pw) {
  var out = [];
  qs.forEach(function (q) {
    [q.q].concat(q.options).forEach(function (t) {
      var a = aiWords_(t);
      var best = 0; var at = -1;
      for (var i = 0; i < a.length; i++) for (var j = 0; j < pw.length; j++) {
        var k = 0; while (a[i + k] && a[i + k] === pw[j + k]) k++;
        if (k > best) { best = k; at = i; }
      }
      if (best >= AI_MAX_COPY) out.push(a.slice(at, at + best).join(' '));
    });
  });
  return out;
}

/* ------------------------------------------------------------------ */
/* Config                                                              */
/* ------------------------------------------------------------------ */

function publishDoc_(docId, json) {
  try {
    var res = UrlFetchApp.fetch(FIRESTORE_DOCS + encodeURIComponent(docId), {
      method: 'patch',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
      payload: JSON.stringify({ fields: { json: { stringValue: json } } }),
      muteHttpExceptions: true,
    });
    if (res.getResponseCode() >= 300) Logger.log('Firestore 同步失敗 ' + docId + '：' + res.getContentText());
  } catch (e) {
    Logger.log('Firestore 同步失敗 ' + docId + '：' + e);
  }
}

function publishConfig_() {
  CacheService.getScriptCache().remove(CONFIG_CACHE_KEY);
  var cfg = readConfigCached_();
  publishDoc_('config', JSON.stringify(cfg));
  return cfg;
}

// 手動全部同步一次（第一次設定、或 Firestore 資料不見時）：在編輯器選這個函式按「執行」
function syncToFirestore() {
  publishConfig_();
  readContentRows_().forEach(function (r) {
    publishDoc_('content_' + r.id, JSON.stringify({ v: r.updated, data: JSON.parse(r.json) }));
  });
}

function readConfigCached_() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get(CONFIG_CACHE_KEY);
  if (hit) return JSON.parse(hit);
  var cfg = { units: {}, updated: new Date().toISOString() };
  readSettingsRows_().forEach(function (u) {
    cfg.units[u.id] = { visible: u.visible, disabled: u.disabled, questionCount: u.questionCount };
  });
  // 老師後台新增的全新單元：網站前端會把這些併進課次清單（見 js/data.js 的 addCustomUnits）
  var customUnits = readCustomUnitsRows_();
  cfg.customUnits = customUnits.map(function (u) {
    return { id: u.id, title: u.title, type: u.type, lesson: u.lesson, topic: u.topic };
  });
  customUnits.forEach(function (u) {
    cfg.units[u.id] = { visible: u.visible, disabled: u.disabled, questionCount: u.questionCount };
  });
  // 老師匯入過的單元：網站會改讀試算表裡的內容
  cfg.content = {};
  readContentRows_().forEach(function (r) {
    cfg.content[r.id] = { updated: r.updated, count: r.count, topic: r.topic };
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
