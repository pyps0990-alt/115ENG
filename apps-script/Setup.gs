/**
 * 第一次使用時，在 Apps Script 編輯器選擇 setup 並按「執行」。
 * 會建立 settings / teachers / scores 三個分頁，並把目前執行的帳號加入老師名單。
 * 之後新增單元時，只要在 settings 分頁加一列（id 要和 data/lessons/index.json 相同）。
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
