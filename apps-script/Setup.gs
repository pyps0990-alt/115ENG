/**
 * 第一次使用時，在 Apps Script 編輯器選擇 setup 並按「執行」。
 * 會建立 settings / teachers / scores 三個分頁，並把目前執行的帳號加入老師名單。
 * 之後新增單元時，只要在 settings 分頁加一列（id 要和 data/lessons/index.json 相同）。
 */
var DEFAULT_UNITS = [
  ['l1-voc', 'L1 VOC', 'vocab'],
  ['l1-reading', 'L1 Reading', 'passage'],
  ['l2-reading-comprehension', 'L2 Reading Comprehension', 'passage'],
  ['l2-grammar-in-reading', 'L2 Grammar in Reading', 'passage'],
  ['l2-cloze-test', 'L2 Cloze Test', 'passage'],
  ['l2-cloze-test-2', 'L2 Cloze Test 2', 'passage'],
  ['l3-voc', 'L3 VOC', 'vocab'],
  ['l4-reading', 'L4 Reading', 'passage'],
];

function setup() {
  var settings = sheet_(SHEET_SETTINGS, SETTINGS_HEADER);
  if (settings.getLastRow() < 2) {
    var rows = DEFAULT_UNITS.map(function (u) { return [u[0], u[1], u[2], true, '', true, 20, '', '']; });
    settings.getRange(2, 8, rows.length, 2).setNumberFormat('@');
    settings.getRange(2, 1, rows.length, SETTINGS_HEADER.length).setValues(rows);
  }
  var teachers = sheet_(SHEET_TEACHERS, ['email', 'note']);
  var me = Session.getEffectiveUser().getEmail();
  if (me && teachers.getLastRow() < 2) teachers.appendRow([me, '建立者']);
  sheet_(SHEET_SCORES, SCORES_HEADER);
  CacheService.getScriptCache().remove(CONFIG_CACHE_KEY);
  Logger.log('完成。老師名單：' + me);
}
