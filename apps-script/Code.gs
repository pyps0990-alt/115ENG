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
var SHEET_CONTENT = 'content';
var CONFIG_CACHE_KEY = 'config-json';
var CONTENT_HEADER = ['id', 'json', 'updated', 'updatedBy'];
var MAX_CONTENT_CHARS = 45000; // 試算表單一儲存格上限 50000 字元

// 學生網站的網址：後台「載入網站目前內容」會從這裡讀取內建的題目
var SITE_URL = 'https://pyps0990-alt.github.io/115ENG/';

var SETTINGS_HEADER = ['id', 'title', 'type', 'visible', 'disabled', 'questionCount'];
var SCORES_HEADER = ['serverTime', 'cls', 'seat', 'name', 'unit', 'unitTitle', 'level', 'mode', 'score', 'total', 'pct', 'basic', 'advanced', 'mastery', 'wrong', 'durationSec', 'clientTime', 'attemptId'];
var SHEET_DETAILS = 'details';
var DETAILS_HEADER = ['serverTime', 'attemptId', 'cls', 'seat', 'name', 'unit', 'stage', 'kind', 'n', 'question', 'correct', 'yours', 'ok', 'points', 'hints'];
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
    // 每題作答明細
    var details = Array.isArray(d.details) ? d.details.slice(0, 120) : [];
    if (details.length) {
      var rows = details.map(function (x) {
        return [
          now, cell_(attemptId, 64), cell_(d.cls, 8), cell_(d.seat, 4), cell_(d.name, 40), cell_(d.unit, 60),
          cell_(x.stage, 20), cell_(x.kind, 20), num_(x.n), cell_(x.q, 300), cell_(x.correct, 200), cell_(x.yours, 200),
          x.ok ? '✓' : '✗', num_(x.points), num_(x.hints),
        ];
      });
      var ds = sheet_(SHEET_DETAILS, DETAILS_HEADER);
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

function seenAttempt_(id) {
  if (CacheService.getScriptCache().get('att:' + id)) return true;
  var sh = sheet_(SHEET_SCORES, SCORES_HEADER);
  var last = sh.getLastRow();
  if (last < 2) return false;
  var col = SCORES_HEADER.indexOf('attemptId') + 1;
  var from = Math.max(2, last - 499);
  return sh.getRange(from, col, last - from + 1, 1).getValues().some(function (r) { return String(r[0]) === id; });
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
  sheet_(SHEET_CONTENT, CONTENT_HEADER);
  sheet_(SHEET_DETAILS, DETAILS_HEADER);
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
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sh = sheet_(SHEET_CONTENT, CONTENT_HEADER);
    var now = new Date().toISOString();
    var row = findContentRow_(unitId);
    var values = [[unitId, json, now, email]];
    if (row) sh.getRange(row.index, 1, 1, 4).setValues(values);
    else sh.appendRow(values[0]);
  } finally {
    lock.releaseLock();
  }
  clearContentCache_(unitId);
  return { ok: true, count: countOf_(type, data) };
}

// 刪除匯入的內容，網站改回使用內建題目
function deleteContent(unitId) {
  assertTeacher_();
  var row = findContentRow_(unitId);
  if (row) sheet_(SHEET_CONTENT, CONTENT_HEADER).deleteRow(row.index);
  clearContentCache_(unitId);
  return { ok: true };
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
  var rows = readSettingsRows_();
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
  var text = passage.map(function (p, i) { return '[' + (i + 1) + '] ' + p; }).join('\n\n');
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
          },
          required: ['skill', 'q', 'options', 'answer', 'explain'],
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
    '- "explain" is a short explanation in Traditional Chinese (Taiwan usage), saying which paragraph ([1], [2]...) supports the answer and why.',
    '- Keep the English at a CEFR B1–B2 level.',
    '',
    'Passage:',
    text,
  ].join('\n');

  var pw = aiWords_(passage.join(' '));
  var result = aiCall_(prompt, schema);
  var qs = cleanQuestions_(result.questions || []);
  var copied = copiedParts_(qs, pw);
  if (copied.length) {
    // 有照抄就請 AI 改寫一次
    var retry = prompt + '\n\nYour previous answer copied these phrases from the passage. Rewrite so that no question or option copies ' + (AI_MAX_COPY - 1) + '+ consecutive words:\n- ' + copied.join('\n- ');
    qs = cleanQuestions_((aiCall_(retry, schema).questions) || []);
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

function cleanQuestions_(qs) {
  return qs.map(function (q) {
    var options = (q.options || []).map(function (o) { return String(o || '').trim(); }).filter(String).slice(0, 4);
    var answer = Number(q.answer);
    return {
      skill: SKILLS.indexOf(q.skill) >= 0 ? q.skill : '細節',
      q: String(q.q || '').trim(),
      options: options,
      answer: answer >= 0 && answer < options.length ? answer : -1,
      explain: String(q.explain || '').trim(),
    };
  }).filter(function (q) { return q.q && q.options.length >= 2 && q.answer >= 0; });
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

function readConfigCached_() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get(CONFIG_CACHE_KEY);
  if (hit) return JSON.parse(hit);
  var cfg = { units: {}, updated: new Date().toISOString() };
  readSettingsRows_().forEach(function (u) {
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
