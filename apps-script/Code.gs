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
var CONTENT_HEADER = ['id', 'json', 'updated', 'updatedBy', 'count', 'topic'];
var MAX_CONTENT_CHARS = 45000; // 試算表單一儲存格上限 50000 字元

// 學生網站的網址：後台「載入網站目前內容」會從這裡讀取內建的題目
var SITE_URL = 'https://eng-3385e.web.app/';

// 老師儲存後，把設定與匯入內容同步寫到 Firestore（public 集合），學生網站直接從 Firestore 讀，
// 不用等 Apps Script 開機（約 2～5 秒）。寫入失敗時學生網站會退回讀 Apps Script，不影響功能。
var FIRESTORE_DOCS = 'https://firestore.googleapis.com/v1/projects/eng-3385e/databases/(default)/documents/public/';

var SETTINGS_HEADER = ['id', 'title', 'type', 'visible', 'disabled', 'questionCount', 'openAt', 'closeAt'];

// 老師後台「新增單元」建立的全新單元（網站原本沒有的課次），跟 settings（只調整既有單元的顯示/題數）分開存放。
var SHEET_CUSTOM_UNITS = 'custom_units';

// 個別學生的補作時間：這些學生在單元截止後，可以做正式測驗到指定時間
var SHEET_EXTENSIONS = 'extensions';
var EXTENSIONS_HEADER = ['單元代號', '班級', '座號', '補作到', '備註'];
var CUSTOM_UNITS_FIELDS = ['id', 'title', 'type', 'lesson', 'topic', 'visible', 'disabled', 'questionCount', 'createdAt', 'openAt', 'closeAt'];
var CUSTOM_UNITS_HEADER = ['單元代號', '標題', '類型', '課次', '主題', '顯示', '停用的段落', '每段題數', '建立時間', '開放時間', '截止時間'];

// SCORES_FIELDS／DETAILS_FIELDS：程式內部用的欄位代號，順序要跟 doPost 組 row 的順序一致，不能改。
// SCORES_HEADER／DETAILS_HEADER：實際寫進試算表第一列的中文欄名，只影響顯示，跟 FIELDS 一一對應。
var SCORES_FIELDS = ['serverTime', 'cls', 'seat', 'name', 'unit', 'unitTitle', 'level', 'mode', 'score', 'total', 'pct', 'basic', 'advanced', 'mastery', 'wrong', 'durationSec', 'clientTime', 'attemptId', 'check'];
var SCORES_HEADER = ['時間', '班級', '座號', '姓名', '單元', '單元名稱', '階段', '模式', '得分', '總分', '百分比', '基礎', '進階', '精熟', '錯題', '作答秒數', '送出時間(裝置)', '記錄編號', '驗證'];
var SHEET_DETAILS = 'details';
var DETAILS_FIELDS = ['serverTime', 'attemptId', 'cls', 'seat', 'name', 'unit', 'stage', 'kind', 'n', 'question', 'correct', 'yours', 'ok', 'points', 'hints', 'word', 'err'];
var DETAILS_HEADER = ['時間', '記錄編號', '班級', '座號', '姓名', '單元', '段落', '題型', '題號', '題目', '正確答案', '學生答案', '對錯', '得分', '提示次數', '單字／題目', '錯誤類型'];
var CLASS_SHEET_PREFIX = '班級 ';

/* ------------------------------------------------------------------ */
/* Web App entry points                                                */
/* ------------------------------------------------------------------ */

function doGet(e) {
  var action = e && e.parameter && e.parameter.action;
  // 成績是否已寫入（學生端送出後讀不到回應時，用這個確認；Safari 常見）
  if (action === 'check') {
    var id = String(e.parameter.id || '').slice(0, 64);
    return json_({ ok: true, seen: !!id && seenAttempt_(id) });
  }
  if (action === 'ping') {
    return json_({ ok: true, version: API_VERSION });
  }
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

/* ------------------------------------------------------------------ */
/* 老師後台 API：網站 #/teacher 用 Firebase 登入後，帶登入憑證呼叫這裡      */
/* （取代直接打開 Apps Script 網頁，Safari 也能穩定使用）                 */
/* ------------------------------------------------------------------ */
var FIREBASE_WEB_KEY = 'AIzaSyC0HFF3YjrsONdvYwTrofihkqNGiQjjdyc';
var API_EMAIL = null;
var API_VERSION = 'admin-api-4';

// 用 Google 的 Identity Toolkit 驗證 Firebase 登入憑證，回傳登入的 email（有快取，5 分鐘內不重查）
function verifyIdToken_(token) {
  token = String(token || '');
  if (!token) throw new Error('請先登入');
  var cache = CacheService.getScriptCache();
  var ck = 'tok:' + Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, token)).slice(0, 40);
  var hit = cache.get(ck);
  if (hit) return hit;
  var res = UrlFetchApp.fetch('https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' + FIREBASE_WEB_KEY, {
    method: 'post', contentType: 'application/json', payload: JSON.stringify({ idToken: token }), muteHttpExceptions: true,
  });
  if (res.getResponseCode() !== 200) throw new Error('登入已過期，請重新整理頁面');
  var u = (JSON.parse(res.getContentText()).users || [])[0];
  var email = u && u.email ? String(u.email).toLowerCase() : '';
  if (!email || u.emailVerified === false) throw new Error('無法確認登入帳號');
  cache.put(ck, email, 300);
  return email;
}

function handleApi_(d) {
  // 網站版後台可以呼叫的函式（每一個函式內部都會再檢查一次老師身分）
  var fns = {
    whoami: function () { return { email: assertTeacher_() }; },
    getAdminData: getAdminData, saveAllSettings: saveAllSettings, saveExtensions: saveExtensions, listRoster: listRoster, saveSettings: saveSettings, saveCustomUnits: saveCustomUnits,
    getScores: getScores, getWrongStats: getWrongStats,
    syncGradebookRoster: syncGradebookRoster, syncAllGradebooks: syncAllGradebooks,
    getContent: getContent, saveContent: saveContent, deleteContent: deleteContent, getSiteUrl: getSiteUrl,
    getAiStatus: getAiStatus, setAiSettings: setAiSettings, clearAiKey: clearAiKey, testLocalAi: testLocalAi,
    aiGenerateReading: aiGenerateReading, aiCheckAnswers: aiCheckAnswers, aiGeneratePattern: aiGeneratePattern, aiGenerateExam: aiGenerateExam, aiGenerateExamPart: aiGenerateExamPart, getAiPrompts: getAiPrompts, setAiPrompt: setAiPrompt, aiFillVocab: aiFillVocab, aiAddExamples: aiAddExamples,
    lookupStudent: lookupStudent, deleteStudent: deleteStudent,
    backupSpreadsheet: backupSpreadsheet, semesterReset: semesterReset, purgeUnitScores: purgeUnitScores,
  };
  try {
    API_EMAIL = verifyIdToken_(d.idToken);
    var fn = fns[d.api];
    if (!fn) throw new Error('不支援的操作：' + d.api);
    return json_({ ok: true, data: fn.apply(null, d.args || []) });
  } catch (err) {
    return json_({ ok: false, error: err.message });
  }
}

// 學生交卷分兩步：
//   1. 收件（receiveScore_）：核對後把整筆成績當成一列加到 inbox 分頁（appendRow 本身不會互相覆蓋，不用排隊等鎖），馬上回覆學生。
//   2. 整理（drainInbox_）：一次把 inbox 裡累積的成績整批寫進 scores、班級分頁、成績單與 details，寫完刪掉 inbox 那些列。
//      收件後順手整理（同一時間只有一個在整理，其他人收完件就回覆）；老師打開後台成績、打開試算表時也會先整理。
// 全班同時交卷時，每個人只佔用伺服器不到一秒；以前每筆都要排隊等前一筆寫完 4 個分頁，人一多就會等到逾時。
var SHEET_INBOX = 'inbox';
var INBOX_HEADER = ['收到時間', '記錄編號', '資料（系統自動整理，請勿編輯）'];
var INBOX_CHUNK = 45000;     // 試算表單一儲存格上限 50000 字元：太長的資料分成好幾格
var INBOX_MAX_CHUNKS = 12;
var DRAIN_BUDGET_MS = 25000; // 一次整理最多花這麼久（整理的那位學生要等它，學生端 45 秒才逾時），其餘留給下一次
var DRAIN_MAX_ROWS = 300;    // 每一批最多整理幾筆
var MAX_POST_CHARS = 1000000;

function doPost(e) {
  var raw = (e && e.postData && e.postData.contents) || '{}';
  if (raw.length > MAX_POST_CHARS) return json_({ ok: false, error: 'too large' });
  var body = {};
  try { body = JSON.parse(raw); } catch (err) { body = {}; }
  if (!body || typeof body !== 'object') body = {};
  if (body.api === 'ping') return json_({ ok: true, version: API_VERSION, via: 'POST' }); // 連線測試頁用
  if (body.api) return handleApi_(body);
  var res = receiveScore_(body);
  // 收件成功就順手整理一批（別人正在整理時直接回覆，那邊會一起處理這筆）
  if (res.ok && !res.duplicate) drainInbox_(0);
  return json_(res);
}

function receiveScore_(d) {
  if (!d.name || !d.cls || !d.unit) return { ok: false, error: 'missing fields' };
  var attemptId = String(d.attemptId || '').slice(0, 64);
  // 限頻：同一位學生、同一單元 10 分鐘內最多 8 筆（正常使用遠低於這個數字）。超過就回「忙碌」，學生端會稍後重試，不會丟掉
  if (!allowSubmit_(d)) return { ok: false, busy: true, error: 'rate' };
  try {
    // 學生端網路不穩時會補送，同一筆成績只收一次
    if (attemptId && seenAttempt_(attemptId)) return { ok: true, duplicate: true };
    // 名單確認：不在名單上的（有人直接對網址亂送）不收
    var roster = rosterCheck_(d);
    if (roster === 'bad') return { ok: false, error: 'not on roster' };
    var check = checkAttempt_(d); // 伺服器用題庫核對這筆成績：空白＝核對通過；否則寫下哪裡對不起來（不拒收，只標記，避免誤傷學生的成績）
    if (roster === 'nokey') check = (check ? check + '；' : '') + '未附名單憑證（舊版網頁送出）';
    var details = Array.isArray(d.details) ? d.details.slice(0, 120) : [];
    var row = [
      '', // 時間：整理時填入收件時間
      cell_(d.cls, 8),
      cell_(d.seat, 4),
      cell_(d.name, 40),
      cell_(d.unit, 60),
      cell_(d.unitTitle, 80),
      cell_(d.level, 60),
      cell_(d.mode, 30),
      num_(d.score),
      num_(d.total),
      num_(d.pct),
      text_(d.basic, 12),
      text_(d.advanced, 12),
      text_(d.mastery, 12),
      cell_((Array.isArray(d.wrong) ? d.wrong : []).join(', '), 1000),
      num_(d.durationSec),
      cell_(d.clientTs, 30),
      cell_(attemptId, 64),
      check,
    ];
    var det = details.map(function (x) {
      x = x || {};
      return [
        cell_(x.stage, 20), cell_(x.kind, 20), num_(x.n), cell_(x.q, 300), cell_(x.correct, x.open ? 800 : 200), cell_(x.yours, x.open ? 3000 : 200),
        x.open ? '—' : (x.ok ? '✓' : '✗'), num_(x.points), num_(x.hints), cell_(x.word, 80), cell_(x.err, 20),
      ];
    });
    var t = Date.now();
    var json = JSON.stringify({ t: t, row: row, det: det });
    if (json.length > INBOX_CHUNK * INBOX_MAX_CHUNKS) {
      row[18] = (check ? check + '；' : '') + '作答明細太長，未記錄';
      json = JSON.stringify({ t: t, row: row, det: [] });
    }
    // 每一格前面加 ~：資料被切開時，下一格開頭可能是 = 或 +，避免被試算表當成公式
    var cells = [new Date(t), cell_(attemptId, 64)];
    for (var i = 0; i < json.length; i += INBOX_CHUNK) cells.push('~' + json.slice(i, i + INBOX_CHUNK));
    sheet_(SHEET_INBOX, INBOX_HEADER).appendRow(cells);
    if (attemptId) CacheService.getScriptCache().put('att:' + attemptId, '1', 21600);
    return { ok: true };
  } catch (err) {
    // 試算表暫時出錯：回「忙碌」，學生端留在排隊清單稍後重送（不能回 ok:false，學生端會當成被拒收而丟掉）
    console.warn('收件失敗', err);
    return { ok: false, busy: true, error: 'busy' };
  }
}

// 整理 inbox：拿得到鎖才整理（waitMs 毫秒內），回傳是否有整理
function drainInbox_(waitMs) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(waitMs || 0)) return false;
  try {
    drainLoop_();
    return true;
  } catch (err) {
    console.warn('整理成績失敗（資料仍在 inbox，下次再整理）', err);
    return false;
  } finally {
    lock.releaseLock();
  }
}

// 呼叫前要先拿到鎖
function drainLoop_() {
  var until = Date.now() + DRAIN_BUDGET_MS;
  while (drainBatch_() && Date.now() < until) { /* 整理期間又有新的成績進來：繼續下一批 */ }
}

// 試算表選單、或在 Apps Script「觸發條件」設定每分鐘執行（選用）
function drainInbox() {
  drainInbox_(30000);
}

// 整理一批，回傳處理了幾列（0＝inbox 是空的）。寫入順序：明細、班級分頁、成績單、scores，最後才刪 inbox：
// 中途出錯時資料還在 inbox，下次重來；scores 用記錄編號去重，不會多一筆。
function drainBatch_(maxRows) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ib = ss.getSheetByName(SHEET_INBOX);
  if (!ib) return 0;
  var last = ib.getLastRow();
  if (last < 2) return 0;
  var n = Math.min(last - 1, maxRows || DRAIN_MAX_ROWS);
  var vals = ib.getRange(2, 1, n, Math.max(ib.getLastColumn(), INBOX_HEADER.length)).getValues();
  var recs = [], broken = [];
  vals.forEach(function (r) {
    var s = '';
    for (var c = 2; c < r.length; c++) {
      var part = String(r[c] == null ? '' : r[c]);
      if (!part) break;
      s += part.charAt(0) === '~' ? part.slice(1) : part;
    }
    try {
      var rec = JSON.parse(s);
      if (!rec || !Array.isArray(rec.row)) throw new Error('bad');
      rec.id = String(rec.row[17] || '');
      recs.push(rec);
    } catch (err) { broken.push(r); }
  });

  var ssh = sheet_(SHEET_SCORES, SCORES_HEADER);
  ensureScoresHeader_(ssh);
  var idCol = SCORES_FIELDS.indexOf('attemptId') + 1;
  var sLast = ssh.getLastRow();
  var seen = {};
  if (recs.length > 5 && sLast >= 2) {
    ssh.getRange(2, idCol, sLast - 1, 1).getValues().forEach(function (r) { seen[String(r[0])] = true; });
  }
  var fresh = recs.filter(function (rec) {
    if (!rec.id) return true;
    if (seen[rec.id]) return false;
    if (recs.length <= 5 && sLast >= 2 && ssh.getRange(2, idCol, sLast - 1, 1).createTextFinder(rec.id).matchEntireCell(true).findNext()) return false;
    seen[rec.id] = true; // 同一批裡重複的也只寫一次
    return true;
  });

  if (fresh.length) {
    var scoreRows = [], detailRows = [], byCls = {};
    fresh.forEach(function (rec) {
      var now = new Date(Number(rec.t) || Date.now());
      var row = rec.row.slice(0, SCORES_HEADER.length);
      while (row.length < SCORES_HEADER.length) row.push('');
      row[0] = now;
      scoreRows.push(row);
      (rec.det || []).forEach(function (x) {
        detailRows.push([now, row[17], row[1], row[2], row[3], row[4]].concat(x.slice(0, DETAILS_HEADER.length - 6)));
      });
      // 依班級分頁、成績單（班級只接受 3–4 位數字）
      var cls = String(row[1]).trim();
      if (/^\d{3,4}$/.test(cls)) (byCls[cls] = byCls[cls] || []).push(row);
    });
    if (detailRows.length) {
      var ds = sheet_(SHEET_DETAILS, DETAILS_HEADER);
      // 舊版建立的 details 分頁欄位比較少：補上新欄位的標題
      if (ds.getLastColumn() < DETAILS_HEADER.length) {
        ds.getRange(1, 1, 1, DETAILS_HEADER.length).setValues([DETAILS_HEADER]).setFontWeight('bold');
      }
      detailRows.forEach(function (r) { while (r.length < DETAILS_HEADER.length) r.push(''); });
      ds.getRange(ds.getLastRow() + 1, 1, detailRows.length, DETAILS_HEADER.length).setValues(detailRows);
    }
    Object.keys(byCls).forEach(function (cls) {
      var csh = sheet_(CLASS_SHEET_PREFIX + cls, SCORES_HEADER);
      ensureScoresHeader_(csh);
      csh.getRange(csh.getLastRow() + 1, 1, byCls[cls].length, SCORES_HEADER.length).setValues(byCls[cls]);
      writeGradebook_(cls, byCls[cls]);
    });
    ssh.getRange(ssh.getLastRow() + 1, 1, scoreRows.length, SCORES_HEADER.length).setValues(scoreRows);
  }
  if (broken.length) {
    // 讀不懂的列（有人手動改過 inbox）：搬到 inbox_error 保留原始資料，不擋住後面的成績
    var es = sheet_(SHEET_INBOX + '_error', INBOX_HEADER);
    broken.forEach(function (r) { es.appendRow(r); });
  }
  ib.deleteRows(2, n);
  SpreadsheetApp.flush();
  return n;
}

/* ------------------------------------------------------------------ */
/* 矩陣式成績單（成績單 XXX）——老師預先建立名單，系統只填格子，不新增學生列   */
/* ------------------------------------------------------------------ */

var GRADEBOOK_PREFIX = '成績單 ';
var GRADEBOOK_BASE_HEADER = ['班級', '座號', '姓名'];

// 寫入（或更新）一格分數：找到「座號」對應的列、「單元」對應的欄，只有比原分數高才覆蓋。
// 成績單不用老師事先建立：這個班第一筆成績進來時自動建立分頁；名單裡還沒有的學生（學生登入時已經對過名單）自動補一列；
// 新單元的欄位在老師新增單元時就會建好（見 syncGradebookColumns_），沒有的話這裡補上。
// 座號統一存成兩位數文字（1 → 01），成績單排序整齊；比對時前面的 0 一律忽略（01、1 視為同一個座號）
function padSeat_(seat) {
  var t = String(seat == null ? '' : seat).trim().replace(/^0+(?=\d)/, '');
  return /^\d$/.test(t) ? '0' + t : t;
}
function seatKey_(seat) { return String(seat == null ? '' : seat).trim().replace(/^0+(?=\d)/, ''); }

// rows：這個班這一批的成績列（scores 格式，已經過 cell_ 處理）。同一位學生同一單元只留這批最高分，再跟格子裡的分數比。
// 先把需要的資料一次讀完，再寫入（試算表讀寫交錯會很慢）。
function writeGradebook_(cls, rows) {
  var best = {};
  rows.forEach(function (r) {
    var seat = String(r[2] || '').trim(), unit = String(r[4] || '').trim(), pct = Number(r[10]);
    if (!seat || !unit || r[10] === '' || !isFinite(pct)) return;
    var k = seatKey_(seat) + '\u0001' + unit;
    if (!best[k] || pct > best[k].pct) best[k] = { seat: seat, unit: unit, pct: pct, name: String(r[3] || '') };
  });
  var keys = Object.keys(best);
  if (!keys.length) return;
  var base = GRADEBOOK_BASE_HEADER.length;
  var sh = ensureGradebook_(cls);
  var lastRow = sh.getLastRow();
  var lastCol = Math.max(sh.getLastColumn(), base);
  var rowOf = {}, colOf = {};
  if (lastRow >= 2) {
    sh.getRange(2, 2, lastRow - 1, 1).getValues().forEach(function (v, i) {
      var k = seatKey_(v[0]);
      if (k && !rowOf[k]) rowOf[k] = i + 2;
    });
  }
  var cur = [];
  if (lastCol > base) {
    sh.getRange(1, base + 1, 1, lastCol - base).getValues()[0].forEach(function (h, j) {
      var k = String(h).trim();
      if (k && !colOf[k]) colOf[k] = base + 1 + j;
    });
    if (lastRow >= 2) cur = sh.getRange(2, base + 1, lastRow - 1, lastCol - base).getValues();
  }
  // 名單裡還沒有的學生補一列、還沒有的單元補一欄
  var add = [];
  keys.forEach(function (k) {
    var b = best[k];
    var sk = seatKey_(b.seat);
    if (!rowOf[sk]) { rowOf[sk] = Math.max(lastRow, 1) + 1 + add.length; add.push([cls, padSeat_(b.seat), b.name]); }
    if (!colOf[b.unit]) {
      colOf[b.unit] = ++lastCol;
      sh.getRange(1, lastCol).setValue(b.unit).setFontWeight('bold');
    }
  });
  if (add.length) {
    var start = Math.max(lastRow, 1) + 1;
    sh.getRange(start, 2, add.length, 1).setNumberFormat('@');
    sh.getRange(start, 1, add.length, 3).setValues(add);
  }
  // 只有比原分數高才覆蓋
  keys.forEach(function (k) {
    var b = best[k];
    var r = rowOf[seatKey_(b.seat)], c = colOf[b.unit];
    var line = cur[r - 2];
    var current = Number(line && c - base - 1 < line.length ? line[c - base - 1] : '');
    if (!isFinite(current) || b.pct > current) sh.getRange(r, c).setValue(b.pct);
  });
}

// 取得（沒有就建立）某個班級的成績單分頁：班級／座號／姓名三欄，加上目前所有單元的欄位
function ensureGradebook_(cls) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var name = GRADEBOOK_PREFIX + cls;
  var sh = ss.getSheetByName(name);
  if (sh) return sh;
  sh = ss.insertSheet(name);
  sh.getRange(1, 1, 1, GRADEBOOK_BASE_HEADER.length).setValues([GRADEBOOK_BASE_HEADER]).setFontWeight('bold');
  sh.setFrozenRows(1);
  sh.setFrozenColumns(GRADEBOOK_BASE_HEADER.length);
  ensureGradebookColumns_(sh, gradebookUnits_());
  return sh;
}

// 目前所有單元（依課次排序），成績單的欄位標題用單元代號、儲存格備註寫單元名稱
function gradebookUnits_() {
  return readSettingsRows_().map(function (u) { return { id: u.id, title: u.title, lesson: 0 }; })
    .concat(readCustomUnitsRows_().map(function (u) { return { id: u.id, title: u.title, lesson: u.lesson }; }))
    .sort(function (a, b) { return a.lesson - b.lesson || (a.id < b.id ? -1 : 1); });
}

// 成績單缺哪個單元的欄位就補上（不動已經有的欄位與分數）
function ensureGradebookColumns_(sh, units) {
  var base = GRADEBOOK_BASE_HEADER.length;
  var lastCol = Math.max(sh.getLastColumn(), base);
  var have = {};
  if (lastCol > base) {
    sh.getRange(1, base + 1, 1, lastCol - base).getValues()[0].forEach(function (h) { have[String(h).trim()] = true; });
  }
  var added = 0;
  units.forEach(function (u) {
    if (have[u.id]) return;
    lastCol++;
    added++;
    var c = sh.getRange(1, lastCol);
    c.setValue(u.id).setFontWeight('bold');
    if (c.setNote) c.setNote(u.title || u.id);
  });
  return added;
}

// 老師新增／改名單元後：所有已經存在的成績單都補上新單元的欄位
function syncGradebookColumns_() {
  var units = gradebookUnits_();
  SpreadsheetApp.getActiveSpreadsheet().getSheets().forEach(function (sh) {
    if (sh.getName().indexOf(GRADEBOOK_PREFIX) === 0) ensureGradebookColumns_(sh, units);
  });
}

// 把一個班級的學生名單（Firestore 上那份）同步到成績單：建立分頁、補上還沒有的學生、依座號排序。
// 已經有的列與分數不動（名字空白時才補）；名單上被刪掉的學生不會從成績單刪除，避免誤刪成績。
function syncGradebookRoster(cls, rows) {
  assertTeacher_();
  cls = String(cls || '').trim();
  if (!/^\d{3,4}$/.test(cls)) throw new Error('班級請填 3–4 位數字');
  var sh = ensureGradebook_(cls);
  var last = sh.getLastRow();
  var have = {};
  if (last >= 2) {
    sh.getRange(2, 1, last - 1, 3).getValues().forEach(function (r, i) { have[seatKey_(r[1])] = { row: i + 2, name: String(r[2] || '') }; });
  }
  var add = [];
  (rows || []).forEach(function (r) {
    var seat = String(r.seat || '').trim().replace(/^0+(?=\d)/, '');
    var name = String(r.name || '').trim();
    if (!/^\d{1,2}$/.test(seat) || !name) return;
    var cur = have[seat];
    if (cur) { if (!cur.name) sh.getRange(cur.row, 3).setValue(name); return; }
    have[seat] = { row: -1, name: name };
    add.push([cls, padSeat_(seat), name]);
  });
  if (add.length) {
    var start = sh.getLastRow() + 1;
    sh.getRange(start, 2, add.length, 1).setNumberFormat('@');
    sh.getRange(start, 1, add.length, 3).setValues(add);
  }
  // 座號一律整理成兩位數文字（舊的 1、2 也會變成 01、02），再依座號排序（整列一起排，分數跟著走）
  var n = sh.getLastRow() - 1;
  if (n >= 1) {
    var seatRange = sh.getRange(2, 2, n, 1);
    seatRange.setNumberFormat('@');
    seatRange.setValues(seatRange.getValues().map(function (r) { return [padSeat_(r[0])]; }));
    if (n > 1 && sh.getLastColumn() >= 1) sh.getRange(2, 1, n, sh.getLastColumn()).sort({ column: 2, ascending: true });
  }
  ensureGradebookColumns_(sh, gradebookUnits_());
  return { ok: true, cls: cls, added: add.length, total: sh.getLastRow() - 1 };
}

// 一次把 Firestore 上所有班級的名單同步到成績單（第一次使用、或想補齊時按一下）
function syncAllGradebooks() {
  assertTeacher_();
  var byCls = {};
  listRoster().forEach(function (r) { (byCls[r.cls] = byCls[r.cls] || []).push(r); });
  var out = { classes: 0, added: 0 };
  Object.keys(byCls).sort().forEach(function (cls) {
    if (!/^\d{3,4}$/.test(cls)) return;
    var r = syncGradebookRoster(cls, byCls[cls]);
    out.classes++; out.added += r.added;
  });
  return out;
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
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  // 整欄都查（不只最近幾筆）：隔很久才補送的成績也不會重複寫入。
  // TextFinder 在試算表伺服器端搜尋，不用把整欄資料傳回來，幾千列也只要幾十毫秒
  var find = function (sh, col) {
    var last = sh ? sh.getLastRow() : 0;
    return last >= 2 && sh.getRange(2, col, last - 1, 1).createTextFinder(id).matchEntireCell(true).findNext() !== null;
  };
  // 已經收件、還在 inbox 等整理的也算
  return find(ss.getSheetByName(SHEET_SCORES), SCORES_FIELDS.indexOf('attemptId') + 1) || find(ss.getSheetByName(SHEET_INBOX), 2);
}

// 簡單的限頻（Apps Script 拿不到來源 IP，改以「班級-座號-單元」計）。快取不是原子操作，數字是大概值，足夠擋掉亂送。
// 另外全站每分鐘最多收 SUBMIT_PER_MINUTE 筆（全校同時交卷也遠低於這個數字），擋住有人換著座號大量亂送。
var SUBMIT_PER_MINUTE = 400;
function allowSubmit_(d) {
  var cache = CacheService.getScriptCache();
  var gk = 'rlg:' + Math.floor(Date.now() / 60000);
  var g = Number(cache.get(gk) || 0);
  if (g >= SUBMIT_PER_MINUTE) return false;
  cache.put(gk, String(g + 1), 120);
  var key = 'rl:' + String(d.cls).slice(0, 8) + '-' + String(d.seat).slice(0, 4) + '-' + String(d.unit).slice(0, 60);
  var n = Number(cache.get(key) || 0);
  if (n >= 8) return false;
  cache.put(key, String(n + 1), 600);
  return true;
}

// 學生登入時用班級、座號、姓名算出帳本 key（跟 js/firebase.js studentKey 一樣），交卷時一起送來。
// 回傳 ''＝在名單上；'bad'＝key 對不上或名單上沒有這個人；'nokey'＝沒附 key（更新前的舊版網頁），照收但標記。
// 查 Firestore 失敗時放行（不能因為 Firestore 暫時出錯就擋掉學生的成績）。
function rosterCheck_(d) {
  var key = String(d.key || '');
  if (!key) return 'nokey';
  if (!/^[0-9a-f]{64}$/.test(key) || key !== studentKeyServer_(d.cls, d.seat, d.name)) return 'bad';
  var cache = CacheService.getScriptCache();
  var hit = cache.get('vk:' + key);
  if (hit) return hit === '1' ? '' : 'bad';
  try {
    var found = !!firestoreRequest_('get', FIRESTORE_ROOT + '/vault/' + key + '?mask.fieldPaths=cls');
    cache.put('vk:' + key, found ? '1' : '0', found ? 21600 : 300);
    return found ? '' : 'bad';
  } catch (err) {
    console.warn('名單確認失敗，先放行', err);
    return '';
  }
}

// 舊的成績分頁沒有「驗證」欄標題：補上
function ensureScoresHeader_(sh) {
  var cache = CacheService.getScriptCache();
  var key = 'hdr:' + sh.getName();
  if (cache.get(key)) return;
  if (sh.getLastColumn() < SCORES_HEADER.length) sh.getRange(1, 1, 1, SCORES_HEADER.length).setValues([SCORES_HEADER]).setFontWeight('bold');
  cache.put(key, '1', 21600);
}

// 用老師的題庫核對一筆成績（分數、答案、時間是否合理）。回傳空字串＝沒問題，否則是給老師看的原因。
// 只標記、不拒收：核對規則如果誤判，學生的成績仍然照常記錄。
function checkAttempt_(d) {
  try {
    var issues = [];
    var details = Array.isArray(d.details) ? d.details : [];
    var score = Number(d.score), total = Number(d.total), pct = Number(d.pct);
    if (!(total > 0) || score < 0 || score > total + 0.001) issues.push('分數超出範圍');
    else if (Math.abs(Math.round((score / total) * 100) - pct) > 1) issues.push('百分比與得分不符');
    if (!details.length) {
      if (score > 0) issues.push('沒有作答明細');
    } else {
      var sum = details.reduce(function (a, x) { return a + (Number(x.points) || 0); }, 0);
      if (details.length <= 120 && Math.abs(sum - score) > 0.06 + details.length * 0.001) issues.push('明細總分與得分不符');
      if (total > 0 && details.length < Math.min(total, 120) - 0.5) issues.push('明細題數少於總題數');
    }
    var dur = Number(d.durationSec);
    if (total > 0 && dur >= 0 && dur < total * 1.2) issues.push('作答時間過短');
    // 對照題庫
    var content = readContentCached_(String(d.unit || ''));
    var data = content && content.ok ? content.data : null;
    if (data && details.length) {
      var norm = function (t) { return String(t == null ? '' : t).toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]/g, ''); };
      var bad = 0;
      if (d.mode === 'reading' && Array.isArray(data.questions)) {
        var KEYS = 'ABCDE';
        var serverScore = 0;
        details.forEach(function (x) {
          var q = data.questions[Number(x.n) - 1];
          if (!q) { bad++; return; }
          var expect = KEYS[q.answer] + '. ' + q.options[q.answer];
          var yoursOk = String(x.yours || '') === expect;
          if (yoursOk) serverScore++;
          if (String(x.correct) !== expect || !!x.ok !== yoursOk) bad++;
          x.ok = yoursOk; x.points = yoursOk ? 1 : 0; x.correct = expect; // 明細一律以題庫為準
        });
        // 課文理解的分數由伺服器依題庫重算（單題單選，可以完全信任）：學生送來的分數不同時，以重算的為準
        if (details.length === data.questions.length) {
          var srvPct = Math.round((serverScore / data.questions.length) * 100);
          if (Number(d.score) !== serverScore || Number(d.total) !== data.questions.length || Number(d.pct) !== srvPct) {
            issues.push('分數已依題庫重算（學生端送來 ' + d.score + '/' + d.total + '）');
            d.score = serverScore; d.total = data.questions.length; d.pct = srvPct;
          }
        }
      } else if (d.mode === 'vocab' && Array.isArray(data.words)) {
        var byWord = {};
        data.words.forEach(function (w) { byWord[norm(w.word)] = w; });
        details.forEach(function (x) {
          var w = byWord[norm(x.word)];
          if (!w) { bad++; return; }
          var okMatch = norm(x.yours) === norm(x.correct);
          if (x.ok && !okMatch) bad++;              // 標成答對，但答案和正確答案不同
          else if (!x.ok && okMatch && x.yours) bad++; // 標成答錯，但其實一樣
          else if (/^(英→中|中→英|拼字)$/.test(String(x.kind)) && norm(x.correct) !== norm(w.word) && norm(x.correct) !== norm(w.zh)) bad++;
        });
      }
      if ((d.mode === 'pattern' && Array.isArray(data.items)) || (d.mode === 'exam' && Array.isArray(data.blocks))) {
        var flat = d.mode === 'exam' ? flattenExam_(data.blocks) : data.items.map(function (it, i) { return { id: 'i' + i, kind: it.type, options: it.options || [], answer: it.answer }; });
        var byId = {};
        flat.forEach(function (q) { byId[q.id] = q; });
        var KEYS2 = 'ABCDEFGHIJ';
        details.forEach(function (x) {
          var q = byId[String(x.word)];
          if (!q) { bad++; return; }
          if (q.kind === 'open') return; // 翻譯、作文沒有標準答案
          var truth = q.kind === 'mc' ? (KEYS2[q.answer] + '. ' + q.options[q.answer]) : '';
          var yoursOk = q.kind === 'mc' ? String(x.yours || '') === truth : fillOk_(q.answer, x.yours);
          if (!!x.ok !== yoursOk && String(x.yours || '') !== '') bad++;
          if (!!x.ok && !String(x.yours || '')) bad++;
        });
      }
      if (bad) issues.push('有 ' + bad + ' 題答案與題庫不符');
    }
    return issues.join('；');
  } catch (err) {
    return '';
  }
}

/* ------------------------------------------------------------------ */
/* 初始化與試算表選單                                                   */
/* ------------------------------------------------------------------ */

/**
 * 第一次使用時執行一次：建立 settings / teachers / scores / details / content 分頁，
 * 並把目前執行的帳號加入老師名單。之後新增單元時，在 settings 分頁加一列（id 要和 data/lessons/index.json 相同）。
 */
function setup() {
  // 網站沒有內建單元了，所有單元都由老師在後台新增
  // 全新安裝沒有內建單元要轉換；已經在用的（settings 還有資料）留給 migrateBuiltinUnits_ 處理
  if (sheet_(SHEET_SETTINGS, SETTINGS_HEADER).getLastRow() < 2) PropertiesService.getScriptProperties().setProperty('BUILTIN_MIGRATED', 'setup');
  var teachers = sheet_(SHEET_TEACHERS, ['email', 'note']);
  var me = Session.getEffectiveUser().getEmail();
  if (me && teachers.getLastRow() < 2) teachers.appendRow([me, '建立者']);
  sheet_(SHEET_SCORES, SCORES_HEADER);
  sheet_(SHEET_CONTENT, CONTENT_HEADER);
  sheet_(SHEET_DETAILS, DETAILS_HEADER);
  sheet_(SHEET_INBOX, INBOX_HEADER);
  sheet_(SHEET_CUSTOM_UNITS, CUSTOM_UNITS_HEADER);
  sheet_(SHEET_EXTENSIONS, EXTENSIONS_HEADER);
  CacheService.getScriptCache().remove(CONFIG_CACHE_KEY);
  Logger.log('完成。老師名單：' + me);
}

// 試算表上方的「B5 Practice」選單
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('B5 Practice')
    .addItem('初始化（建立分頁）', 'setup')
    .addItem('建立班級成績單', 'createGradebookSheet')
    .addItem('整理排隊中的成績（inbox）', 'drainInbox')
    .addItem('開啟老師後台', 'openAdmin')
    .addToUi();
  // 打開試算表時，把還在 inbox 的成績先整理進各分頁
  try { drainInbox_(0); } catch (err) { /* 沒有權限或忙碌時略過，不影響選單 */ }
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

// 一次性：把網站原本內建的單元（L1）轉成老師自己的單元，之後可以在後台直接刪除。
// 沒匯入過的內建題目，會先從網站抓一份存進 content 分頁；學生紀錄全部保留（建立時間留空＝舊紀錄照算）。
function migrateBuiltinUnits_() {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('BUILTIN_MIGRATED')) return;
  var builtins = readSettingsRows_();
  var have = {};
  readCustomUnitsRows_().forEach(function (u) { have[u.id] = true; });
  var csh = sheet_(SHEET_CUSTOM_UNITS, CUSTOM_UNITS_HEADER);
  builtins.forEach(function (u) {
    if (have[u.id]) return;
    var topic = '';
    var row = findContentMeta_(u.id);
    if (row) {
      topic = row.topic;
    } else {
      try {
        var res = UrlFetchApp.fetch(SITE_URL.replace(/\/?$/, '/') + 'data/lessons/' + encodeURIComponent(u.id) + '.json', { muteHttpExceptions: true });
        if (res.getResponseCode() === 200) {
          var data = JSON.parse(res.getContentText());
          delete data.sample;
          topic = String(data.topic || '');
          sheet_(SHEET_CONTENT, CONTENT_HEADER).appendRow([u.id, JSON.stringify(data), new Date().toISOString(), '內建題目轉入', countOf_(normType_(u.type), data), topic]);
          clearContentCache_(u.id);
        }
      } catch (err) { Logger.log('內建題目轉入失敗 ' + u.id + '：' + err); }
    }
    var m = /^l(\d+)/i.exec(u.id);
    var values = [[u.id, u.title || u.id, normType_(u.type), m ? Number(m[1]) : 1, topic,
      u.visible !== false, (u.disabled || []).join(','), u.questionCount || 10, '', u.openAt || '', u.closeAt || '']];
    csh.getRange(csh.getLastRow() + 1, 1, 1, CUSTOM_UNITS_FIELDS.length).setNumberFormat('@').setValues(values);
  });
  var ssh = sheet_(SHEET_SETTINGS, SETTINGS_HEADER);
  if (ssh.getLastRow() > 1) ssh.getRange(2, 1, ssh.getLastRow() - 1, SETTINGS_HEADER.length).clearContent();
  props.setProperty('BUILTIN_MIGRATED', new Date().toISOString());
  if (builtins.length) publishConfig_();
}

function getAdminData() {
  var email = assertTeacher_();
  migrateBuiltinUnits_();
  return {
    email: email,
    units: readSettingsRows_(),
    customUnits: readCustomUnitsRows_(),
    content: readContentMeta_().map(function (r) { return { id: r.id, updated: r.updated, updatedBy: r.updatedBy, count: r.count }; }),
    extensions: readExtensions_(),
    config: readConfigCached_(), // 目前學生網站上的設定：老師的瀏覽器據此算出新設定，儲存時直接寫給學生
    siteUrl: SITE_URL,
    sheetUrl: SpreadsheetApp.getActiveSpreadsheet().getUrl(),
  };
}

function readExtensions_() {
  var sh = sheet_(SHEET_EXTENSIONS, EXTENSIONS_HEADER);
  var last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, EXTENSIONS_HEADER.length).getValues()
    .map(function (r) {
      return { unit: String(r[0]).trim(), cls: String(r[1]).trim(), seat: String(r[2]).trim().replace(/^0+(?=\d)/, ''), until: timeCell_(r[3]), note: String(r[4] || '') };
    })
    .filter(function (x) { return x.unit && x.cls && x.seat && x.until; });
}

// 學生名單（給補作時間的搜尋選單用）：讀 Firestore 的學生帳本，只取班級、座號、姓名
function listRoster() {
  assertTeacher_();
  var out = [], after = null;
  while (true) {
    var page = firestorePage_('vault', ['cls', 'seat', 'name'], after, 300);
    if (!page.length) break;
    page.forEach(function (d) {
      if (!/\/documents\/vault\/[^/]+$/.test(d.name)) return;
      var f = d.fields || {};
      var v = function (k) { return f[k] ? String(f[k].stringValue || f[k].integerValue || '') : ''; };
      if (v('cls') && v('seat')) out.push({ cls: v('cls'), seat: v('seat').replace(/^0+(?=\d)/, ''), name: v('name') });
    });
    after = page[page.length - 1].name;
    if (page.length < 300) break;
  }
  out.sort(function (a, b) { return a.cls.localeCompare(b.cls) || Number(a.seat) - Number(b.seat); });
  return out;
}

// 整批覆寫補作名單，並同步到學生網站
function saveExtensions(list, fast) {
  assertTeacher_();
  var rows = (list || []).map(function (x) {
    return [String(x.unit || '').trim(), String(x.cls || '').trim(), String(x.seat || '').trim().replace(/^0+(?=\d)/, ''), timeCell_(x.until), String(x.note || '').slice(0, 100)];
  }).filter(function (r) { return r[0] && /^\d{3,4}$/.test(r[1]) && /^\d{1,2}$/.test(r[2]) && r[3]; });
  var sh = sheet_(SHEET_EXTENSIONS, EXTENSIONS_HEADER);
  var last = sh.getLastRow();
  if (last > 1) sh.getRange(2, 1, last - 1, EXTENSIONS_HEADER.length).clearContent();
  if (rows.length) {
    sh.getRange(2, 1, rows.length, EXTENSIONS_HEADER.length).setNumberFormat('@').setValues(rows);
  }
  LAST_SYNC_ERROR = '';
  var cfg = publishConfig_();
  return { ok: true, count: rows.length, updated: cfg.updated, config: cfg, syncError: LAST_SYNC_ERROR };
}

function saveSettings(units, skipPublish) {
  assertTeacher_();
  var sh = sheet_(SHEET_SETTINGS, SETTINGS_HEADER);
  var rows = (units || []).map(function (u) {
    return [
      String(u.id), String(u.title || ''), String(u.type || ''),
      u.visible !== false,
      (u.disabled || []).join(','),
      Math.min(100, Math.max(1, Number(u.questionCount) || 10)),
      timeCell_(u.openAt), timeCell_(u.closeAt),
    ];
  });
  var last = sh.getLastRow();
  sh.getRange(1, 1, 1, SETTINGS_HEADER.length).setValues([SETTINGS_HEADER]).setFontWeight('bold');
  if (last > 1) sh.getRange(2, 1, last - 1, SETTINGS_HEADER.length).clearContent();
  if (rows.length) {
    sh.getRange(2, 7, rows.length, 2).setNumberFormat('@');
    sh.getRange(2, 1, rows.length, SETTINGS_HEADER.length).setValues(rows);
  }
  if (!skipPublish) publishConfig_();
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
        type: normType_(r[2]),
        lesson: Math.max(1, Number(r[3]) || 1),
        topic: String(r[4] || ''),
        visible: bool_(r[5], true),
        disabled: String(r[6] || '').split(',').map(function (s) { return s.trim(); }).filter(String),
        questionCount: Number(r[7]) || 10,
        createdAt: r[8] instanceof Date ? r[8].toISOString() : String(r[8] || ''),
        openAt: timeCell_(r[9]),
        closeAt: timeCell_(r[10]),
        custom: true,
      };
    });
}

// 單元設定一次存好（內建單元＋自訂單元），只同步一次到 Firestore，比分兩次存快一倍。
// fast：老師的瀏覽器已經先直接寫給學生的那一版 { now }，新單元的建立時間跟它用同一個值，兩邊的設定才會一模一樣。
function saveAllSettings(builtIn, custom, fast) {
  assertTeacher_();
  saveSettings(builtIn, true);
  saveCustomUnits(custom, true, pickNow_(fast));
  try { syncGradebookColumns_(); } catch (err) { Logger.log('成績單欄位同步失敗：' + err); } // 新單元在所有成績單上先建好欄位
  LAST_SYNC_ERROR = '';
  var cfg = publishConfig_();
  // 回傳同步結果與伺服器算出的設定，老師的瀏覽器會拿來核對、當作下一次修改的基準
  return { ok: true, savedAt: new Date().toISOString(), updated: cfg.updated, config: cfg, syncError: LAST_SYNC_ERROR };
}

// 瀏覽器傳來的時間只有在和伺服器差不到 10 分鐘時才採用（避免電腦時鐘不準）
function pickNow_(fast) {
  var t = fast && fast.now ? Date.parse(fast.now) : NaN;
  return !isNaN(t) && Math.abs(t - Date.now()) < 600000 ? new Date(t).toISOString() : new Date().toISOString();
}

function saveCustomUnits(units, skipPublish, nowIso) {
  assertTeacher_();
  // 建立時間：已存在的單元沿用，新單元（包括刪掉後用同代號重建的）用現在時間。
  // 學生網站會忽略建立時間之前的作答與檢討紀錄，舊紀錄不會讓新單元跳過「先檢討才能複習」。
  var existing = readCustomUnitsRows_();
  var created = {};
  existing.forEach(function (u) { created[u.id] = u.createdAt; });
  nowIso = nowIso || new Date().toISOString();
  var rows = (units || [])
    .filter(function (u) { return /^[a-z0-9-]+$/i.test(String(u.id || '').trim()); })
    .map(function (u) {
      return [
        String(u.id).trim(), String(u.title || u.id), normType_(u.type),
        Math.max(1, Number(u.lesson) || 1), String(u.topic || ''),
        u.visible !== false, (u.disabled || []).join(','),
        Math.min(100, Math.max(1, Number(u.questionCount) || 10)),
        (String(u.id).trim() in created) ? created[String(u.id).trim()] : nowIso,
        timeCell_(u.openAt), timeCell_(u.closeAt),
      ];
    });
  // 被刪掉的單元：連同代號一起清除（匯入的題目、Firestore 上的題目），代號可以重新使用。
  // 學生成績不在這裡刪，留到學期結算時由老師決定。
  var keep = {};
  rows.forEach(function (r) { keep[r[0]] = true; });
  var removed = existing.map(function (u) { return u.id; }).filter(function (id) { return !keep[id]; });
  var sh = sheet_(SHEET_CUSTOM_UNITS, CUSTOM_UNITS_HEADER);
  var last = sh.getLastRow();
  sh.getRange(1, 1, 1, CUSTOM_UNITS_HEADER.length).setValues([CUSTOM_UNITS_HEADER]).setFontWeight('bold');
  if (last > 1) sh.getRange(2, 1, last - 1, CUSTOM_UNITS_FIELDS.length).clearContent();
  if (rows.length) sh.getRange(2, 1, rows.length, CUSTOM_UNITS_FIELDS.length).setNumberFormat('@').setValues(rows);
  removed.forEach(purgeUnit_);
  if (!skipPublish) publishConfig_();
  return { ok: true, savedAt: new Date().toISOString() };
}

// 老師後台「錯題分析」：從 details 統計全班最常答錯的單字／題目，以及錯誤類型分布
function getWrongStats(filter) {
  assertTeacher_();
  drainInbox_(20000); // 先把排隊中的成績寫進來，老師看到的才是最新的
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
    if (String(r[cOk]) === '—') return; // 翻譯、作文不計對錯
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
  drainInbox_(20000);
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
      wrong: String(r[14]), durationSec: r[15], check: String(r[18] || ''),
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

function saveContent(unitId, data, reset, fast) {
  var email = assertTeacher_();
  unitId = String(unitId || '').trim();
  var type = unitType_(unitId);
  if (!type) throw new Error('找不到單元：' + unitId);
  var err = validateContent_(type, data);
  if (err) throw new Error(err);
  var json = JSON.stringify(data);
  if (json.length > MAX_CONTENT_CHARS) throw new Error('內容太長（' + json.length + ' 字元），請分成兩個單元。');
  var now = pickNow_(fast);
  var count = countOf_(type, data), topic = String(data.topic || '');
  var lock = LockService.getScriptLock();
  lock.waitLock(30000); // 學生交卷整理成績時也用這把鎖（一次最多十幾秒）
  try {
    var sh = sheet_(SHEET_CONTENT, CONTENT_HEADER);
    var row = findContentMeta_(unitId);
    var values = [[unitId, json, now, email, count, topic]];
    if (row) sh.getRange(row.index, 1, 1, values[0].length).setValues(values);
    else sh.appendRow(values[0]);
  } finally {
    lock.releaseLock();
  }
  clearContentCache_(unitId);
  if (reset !== false) markReset_(unitId, now);
  // 題目和設定一次送出（同一個請求、要嘛全成功要嘛全不寫），學生端讀到新設定時題目一定已經在
  LAST_SYNC_ERROR = '';
  var docs = {};
  docs['content_' + unitId] = JSON.stringify({ v: now, data: data });
  var cfg = publishConfig_(docs);
  return { ok: true, count: count, updated: cfg.updated, config: cfg, syncError: LAST_SYNC_ERROR };
}

// 刪除匯入的內容，網站改回使用內建題目
function deleteContent(unitId, reset, fast) {
  assertTeacher_();
  var row = findContentMeta_(unitId);
  if (row) sheet_(SHEET_CONTENT, CONTENT_HEADER).deleteRow(row.index);
  clearContentCache_(unitId);
  if (reset !== false) markReset_(unitId, pickNow_(fast));
  LAST_SYNC_ERROR = '';
  var cfg = publishConfig_();
  return { ok: true, updated: cfg.updated, config: cfg, syncError: LAST_SYNC_ERROR };
}

// 題目內容更新或刪除時記下重製時間：學生網站會忽略這個時間之前的作答與檢討紀錄
function markReset_(unitId, nowIso) {
  var props = PropertiesService.getScriptProperties();
  var map = JSON.parse(props.getProperty('RESET_AT') || '{}');
  map[unitId] = nowIso || new Date().toISOString();
  props.setProperty('RESET_AT', JSON.stringify(map));
}

function purgeUnit_(unitId) {
  var row = findContentMeta_(unitId);
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
    // 跟整理成績用同一把鎖：清除期間不會有成績寫到一半
    var lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try {
      var ss = SpreadsheetApp.getActiveSpreadsheet();
      ss.getSheets().forEach(function (sh) {
        var n = sh.getName();
        if (n === SHEET_SCORES || n === SHEET_DETAILS || n === SHEET_EXTENSIONS || n === SHEET_INBOX) {
          if (sh.getLastRow() > 1) sh.deleteRows(2, sh.getLastRow() - 1);
          out.sheets++;
        } else if (n.indexOf(CLASS_SHEET_PREFIX) === 0 || n.indexOf(GRADEBOOK_PREFIX) === 0) {
          ss.deleteSheet(sh);
          out.sheets++;
        }
      });
    } finally {
      lock.releaseLock();
    }
  }
  if (opts.sheets && !opts.skipSheets) publishConfig_();
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
  // 先把排隊中的成績整理進來再刪（不然刪完之後又會被寫回來）；刪除期間拿著鎖，成績不會寫到一半
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    drainLoop_();
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
  } finally {
    lock.releaseLock();
  }
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

function firestoreListChildren_(relPath) {
  var names = [];
  var pageToken = '';
  do {
    var url = FIRESTORE_ROOT + '/' + relPath + '?pageSize=300' + (pageToken ? '&pageToken=' + encodeURIComponent(pageToken) : '');
    var res = firestoreRequest_('get', url) || {};
    (res.documents || []).forEach(function (d) { names.push(d.name); });
    pageToken = res.nextPageToken || '';
  } while (pageToken);
  return names;
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

// 學生的 Firestore key = SHA-256(班級|座號|姓名)，算法要跟網站 js/firebase.js 的 studentKey() 完全一致
function trimText_(s, max) { return String(s == null ? '' : s).trim().slice(0, max); }
function studentKeyServer_(cls, seat, name) {
  var raw = trimText_(cls, 8) + '|' + trimText_(seat, 4) + '|' + trimText_(name, 40).replace(/\s+/g, '');
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, raw, Utilities.Charset.UTF_8);
  return bytes.map(function (b) { var v = (b < 0 ? b + 256 : b).toString(16); return v.length < 2 ? '0' + v : v; }).join('');
}
function normSeat_(seat) { return trimText_(seat, 4).replace(/^0+(?=\d)/, ''); }

// 查詢一位學生在 Firestore 上有多少紀錄，刪除前先看一眼再決定
function lookupStudent(cls, seat, name) {
  assertTeacher_();
  var clsTrim = trimText_(cls, 8), seatTrim = normSeat_(seat), nameTrim = trimText_(name, 40);
  if (!clsTrim || !seatTrim || !nameTrim) throw new Error('請填寫班級、座號、姓名');
  var key = studentKeyServer_(clsTrim, seatTrim, nameTrim);
  var vaultDoc = firestoreRequest_('get', FIRESTORE_ROOT + '/vault/' + key);
  return {
    found: !!vaultDoc,
    name: vaultDoc && vaultDoc.fields && vaultDoc.fields.name ? vaultDoc.fields.name.stringValue : '',
    attempts: firestoreListChildren_('vault/' + key + '/attempts').length,
    reviews: firestoreListChildren_('vault/' + key + '/reviews').length,
  };
}

// 刪除一位學生在 Firestore 上的所有資料（帳本、作答、檢討紀錄，以及依班級整理的那份複本）。
// 依班級座號整理的那份複本沒有存學生姓名，用班級＋座號比對，跟成績單的記法一致。
function deleteStudent(cls, seat, name) {
  assertTeacher_();
  var clsTrim = trimText_(cls, 8), seatTrim = normSeat_(seat), nameTrim = trimText_(name, 40);
  if (!clsTrim || !seatTrim || !nameTrim) throw new Error('請填寫班級、座號、姓名');
  var key = studentKeyServer_(clsTrim, seatTrim, nameTrim);
  var out = { attempts: 0, reviews: 0, classAttempts: 0, vault: false, classSeat: false, timedOut: false };
  var attempts = firestoreListChildren_('vault/' + key + '/attempts');
  var reviews = firestoreListChildren_('vault/' + key + '/reviews');
  if (attempts.length) { firestoreDelete_(attempts); out.attempts = attempts.length; }
  if (reviews.length) { firestoreDelete_(reviews); out.reviews = reviews.length; }
  var vaultUrl = FIRESTORE_ROOT + '/vault/' + key;
  if (firestoreRequest_('get', vaultUrl)) { firestoreRequest_('delete', vaultUrl); out.vault = true; }
  // 依班級座號整理的那份複本，不知道做過哪些單元，只能掃過整個 attempts 集合比對班級與座號
  var deadline = Date.now() + 240000;
  var after = null;
  while (true) {
    if (Date.now() > deadline) { out.timedOut = true; break; }
    var page = firestorePage_('attempts', ['cls', 'seat'], after, 300);
    if (!page.length) break;
    var hit = page.filter(function (d) {
      return /\/classes\//.test(d.name) && d.fields && d.fields.cls && d.fields.seat
        && d.fields.cls.stringValue === clsTrim && d.fields.seat.stringValue === seatTrim;
    }).map(function (d) { return d.name; });
    if (hit.length) { firestoreDelete_(hit); out.classAttempts += hit.length; }
    after = page[page.length - 1].name;
  }
  var seatUrl = FIRESTORE_ROOT + '/classes/' + encodeURIComponent(clsTrim) + '/seats/' + encodeURIComponent(seatTrim);
  if (firestoreRequest_('get', seatUrl)) { firestoreRequest_('delete', seatUrl); out.classSeat = true; }
  return out;
}

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

// 內容分頁的「單元、更新時間、題數、主題」（不讀那一大欄題目內容，比整個讀進來快很多）。
// 舊資料沒有題數／主題時，這裡一次補齊寫回分頁。
function readContentMeta_() {
  var sh = sheet_(SHEET_CONTENT, CONTENT_HEADER);
  var last = sh.getLastRow();
  if (last < 2) return [];
  var n = last - 1;
  var ids = sh.getRange(2, 1, n, 1).getValues();
  var both = sh.getRange(1, 3, last, 4).getValues(); // 第一列是欄名；其餘：更新時間、更新者、題數、主題
  var meta = both.slice(1);
  if (String(both[0][2]) !== 'count') sh.getRange(1, 5, 1, 2).setValues([['count', 'topic']]).setFontWeight('bold');
  var out = [], missing = [];
  for (var i = 0; i < n; i++) {
    var id = String(ids[i][0]).trim();
    if (!id) continue;
    var cnt = meta[i][2];
    var r = { index: i + 2, id: id, updated: String(meta[i][0]), updatedBy: String(meta[i][1]), count: Number(cnt) || 0, topic: String(meta[i][3] || '') };
    if (cnt === '' || isNaN(Number(cnt))) missing.push(r);
    out.push(r);
  }
  if (missing.length) {
    var types = unitTypes_();
    missing.forEach(function (r) {
      var data = {};
      try { data = JSON.parse(sh.getRange(r.index, 2).getValue()); } catch (err) { return; }
      var type = types[r.id] || (data.words ? 'vocab' : data.items ? 'pattern' : data.blocks ? 'exam' : 'reading');
      r.count = countOf_(type, data);
      r.topic = String(data.topic || '');
      sh.getRange(r.index, 5, 1, 2).setValues([[r.count, r.topic]]);
    });
  }
  return out;
}

function findContentMeta_(unitId) {
  var rows = readContentMeta_();
  for (var i = 0; i < rows.length; i++) if (rows[i].id === unitId) return rows[i];
  return null;
}

// 含題目內容的完整資料（只有真的需要內容時才讀）
function readContentRows_() {
  var sh = sheet_(SHEET_CONTENT, CONTENT_HEADER);
  return readContentMeta_().map(function (m) {
    var json = String(sh.getRange(m.index, 2).getValue());
    return { index: m.index, id: m.id, json: json, updated: m.updated, updatedBy: m.updatedBy, count: m.count, topic: m.topic };
  });
}

function findContentRow_(unitId) {
  var m = findContentMeta_(unitId);
  if (!m) return null;
  m.json = String(sheet_(SHEET_CONTENT, CONTENT_HEADER).getRange(m.index, 2).getValue());
  return m;
}

// 所有單元的類型 { 代號: 'vocab' | 'reading' }，一次讀好
function unitTypes_() {
  var map = {};
  readSettingsRows_().concat(readCustomUnitsRows_()).forEach(function (u) { map[u.id] = u.type; });
  return map;
}

function unitType_(unitId) {
  return unitTypes_()[unitId] || '';
}

// 四種單元類型：單字片語、課文理解、句型練習、段考複習
var UNIT_TYPES = ['vocab', 'reading', 'pattern', 'exam'];
function normType_(t) { return UNIT_TYPES.indexOf(String(t)) >= 0 ? String(t) : 'vocab'; }

function countOf_(type, data) {
  if (type === 'vocab') return (data.words || []).length;
  if (type === 'pattern') return (data.items || []).length;
  if (type === 'exam') return flattenExam_(data.blocks).length;
  return (data.questions || []).length;
}

// 比對答案的規則（和 js/components/items.js 的 normAns 一致）
function normAns_(s) {
  return String(s == null ? '' : s).toLowerCase().replace(/[‘’]/g, "'").replace(/[^a-z0-9' ]/g, ' ').replace(/\s+/g, ' ').trim();
}
// 答案寫法：用 | 列出所有可接受的寫法；用 ( ) 標出可有可無的字（和 js/components/items.js 的 expandAlts 一致）
function expandAlts_(str) {
  var out = [];
  String(str == null ? '' : str).split('|').forEach(function (alt) {
    var list = [alt];
    for (var i = 0; i < 4 && list.some(function (x) { return /\([^()]*\)/.test(x); }); i++) {
      var next = [];
      list.forEach(function (x) { var m = /\(([^()]*)\)/.exec(x); if (m) { next.push(x.replace(m[0], m[1])); next.push(x.replace(m[0], '')); } else next.push(x); });
      list = next;
    }
    list.forEach(function (x) { x = x.replace(/\s+/g, ' ').trim(); if (x && out.indexOf(x) < 0) out.push(x); });
  });
  return out.slice(0, 64);
}
function fillOk_(answer, typed) {
  var t = normAns_(typed);
  return expandAlts_(answer).some(function (a) { return normAns_(a) === t; });
}

// 段考複習：把區塊攤平成單題清單，編號和學生端一致（b{區塊} 或 b{區塊}.{小題}）
function flattenExam_(blocks) {
  var out = [];
  (blocks || []).forEach(function (b, i) {
    if (b.type === 'mc' || b.type === 'spell' || b.type === 'phrase') out.push({ id: 'b' + i, kind: b.type === 'mc' ? 'mc' : 'spell', options: b.options || [], answer: b.answer });
    else if (b.type === 'translate' || b.type === 'essay') out.push({ id: 'b' + i, kind: 'open' });
    else if (b.type === 'bank' || b.type === 'struct') (b.blanks || []).forEach(function (q, j) { out.push({ id: 'b' + i + '.' + j, kind: 'mc', options: b.bank || [], answer: q.answer }); });
    else if (b.type === 'reading') (b.questions || []).forEach(function (q, j) { out.push({ id: 'b' + i + '.' + j, kind: 'mc', options: q.options || [], answer: q.answer }); });
    else if (b.type === 'cloze') (b.blanks || []).forEach(function (q, j) { out.push({ id: 'b' + i + '.' + j, kind: 'mc', options: q.options || [], answer: q.answer }); });
  });
  return out;
}

function validChoice_(q) {
  return q && Array.isArray(q.options) && q.options.length >= 2 && q.options.every(function (o) { return String(o).trim(); })
    && typeof q.answer === 'number' && q.answer >= 0 && q.answer < q.options.length;
}

// 伺服器端的最後把關（詳細檢查在後台頁面上進行）
function validateContent_(type, d) {
  if (!d || typeof d !== 'object') return '資料格式錯誤';
  if (type === 'vocab') {
    if (!Array.isArray(d.words) || d.words.length < 4) return '單字片語至少要 4 個';
    if (d.words.length > 30) return '一個單元最多 30 個單字片語，請拆成兩個單元';
    for (var i = 0; i < d.words.length; i++) {
      var w = d.words[i];
      if (!w.word || !w.zh) return '第 ' + (i + 1) + ' 個缺少英文或中文';
      // 一個字可能存了不只一句例句（examples 陣列），每一句都要各自標出要考的字
      var exs = (Array.isArray(w.examples) && w.examples.length) ? w.examples : [{ ex: w.example }];
      for (var e = 0; e < exs.length; e++) {
        if (!/\[[^\]]+\]/.test(exs[e].ex || '')) return '「' + w.word + '」的例句沒有用 [ ] 標出要考的字';
      }
    }
    return '';
  }
  if (type === 'pattern') {
    if (!Array.isArray(d.items) || !d.items.length) return '句型練習至少要 1 題';
    for (var k = 0; k < d.items.length; k++) {
      var it = d.items[k], no = '第 ' + (k + 1) + ' 題';
      if (it.type === 'mc') { if (!it.q || !validChoice_(it)) return no + '（選擇）不完整或沒有正確答案'; }
      else if (it.type === 'fill') { if (!it.q || !/_{2,}/.test(it.q) || !String(it.answer || '').trim()) return no + '（填空）要有 ____ 空格與答案'; }
      else if (it.type === 'apply') {
        if (!it.zh || !Array.isArray(it.words) || it.words.length < 3 || !String(it.answer || '').trim()) return no + '（應用）要有中文、至少 3 個單字與完整句子';
        if (normAns_(it.words.join(' ')).split(' ').sort().join(' ') !== normAns_(it.answer).split(' ').sort().join(' ')) return no + '（應用）的單字要剛好能排成答案句子';
      } else return no + ' 的題型不明（要是 mc / fill / apply）';
    }
    return '';
  }
  if (type === 'exam') {
    if (!Array.isArray(d.blocks) || !d.blocks.length) return '段考複習至少要 1 題';
    for (var m = 0; m < d.blocks.length; m++) {
      var b = d.blocks[m], bn = '第 ' + (m + 1) + ' 大題';
      if (b.type === 'mc') { if (!b.q || !validChoice_(b)) return bn + '（選擇）不完整或沒有正確答案'; }
      else if (b.type === 'spell' || b.type === 'phrase') { if (!b.q || !String(b.answer || '').trim()) return bn + '（拼寫／片語）要有題目與答案'; }
      else if (b.type === 'translate') { if (!b.zh || !String(b.answer || '').trim()) return bn + '（翻譯）要有中文句子與參考答案'; }
      else if (b.type === 'essay') { if (!b.q || !String(b.sample || '').trim()) return bn + '（作文）要有題目與參考範文'; if (b.minWords != null && !(Number(b.minWords) >= 0 && Number(b.minWords) <= 1000)) return bn + '（作文）字數要在 0–1000'; }
      else if (b.type === 'bank' || b.type === 'struct') {
        var nm = b.type === 'bank' ? '文意選填' : '篇章結構';
        if (!Array.isArray(b.passage) || !b.passage.length) return bn + '（' + nm + '）缺少文章';
        if (!Array.isArray(b.bank) || b.bank.length < 2 || b.bank.length > 10 || b.bank.some(function (o) { return !String(o).trim(); })) return bn + '（' + nm + '）的' + (b.type === 'bank' ? '字庫' : '句子庫') + '要有 2–10 個項目';
        if (!Array.isArray(b.blanks) || !b.blanks.length) return bn + '（' + nm + '）至少要 1 個空格';
        var btext = b.passage.join(' ');
        for (var z = 0; z < b.blanks.length; z++) {
          var ba = b.blanks[z].answer;
          if (!(typeof ba === 'number' && ba >= 0 && ba < b.bank.length)) return bn + '（' + nm + '）第 (' + (z + 1) + ') 格沒有正確答案';
          if (btext.indexOf('(' + (z + 1) + ')') < 0) return bn + '（' + nm + '）文章裡找不到空格 (' + (z + 1) + ')';
        }
      }
      else if (b.type === 'reading' || b.type === 'cloze') {
        if (!Array.isArray(b.passage) || !b.passage.length) return bn + '缺少文章';
        var qs = b.type === 'reading' ? b.questions : b.blanks;
        if (!Array.isArray(qs) || !qs.length) return bn + '至少要 1 小題';
        for (var n = 0; n < qs.length; n++) {
          if (!validChoice_(qs[n]) || (b.type === 'reading' && !qs[n].q)) return bn + '第 ' + (n + 1) + ' 小題不完整或沒有正確答案';
          if (b.type === 'reading') { var ev2 = evidenceError_(qs[n], b.passage); if (ev2) return bn + '第 ' + (n + 1) + ' 小題' + ev2; }
        }
        if (b.type === 'cloze') {
          var text = b.passage.join(' ');
          for (var c = 1; c <= qs.length; c++) if (text.indexOf('(' + c + ')') < 0) return bn + '文章裡找不到空格 (' + c + ')';
        }
      } else return bn + ' 的題型不明（要是 mc / spell / reading / cloze）';
    }
    return '';
  }
  if (!Array.isArray(d.passage) || !d.passage.length) return '缺少文章';
  if (!Array.isArray(d.questions) || !d.questions.length) return '至少要 1 題';
  for (var j = 0; j < d.questions.length; j++) {
    var q = d.questions[j];
    if (!q.q || !Array.isArray(q.options) || q.options.length < 2) return '第 ' + (j + 1) + ' 題不完整';
    if (!(q.answer >= 0 && q.answer < q.options.length)) return '第 ' + (j + 1) + ' 題沒有設定正確答案';
    var ev = evidenceError_(q, d.passage);
    if (ev) return '第 ' + (j + 1) + ' 題' + ev;
  }
  return '';
}

// 閱讀題一定要有原文依據：關鍵字句（要真的出現在文章裡）或原文句子編號（段-句）
function evidenceError_(q, passage) {
  var paras = (passage || []).map(String);
  var key = String(q.key || '').replace(/\s+/g, ' ').trim();
  if (key) {
    var nk = normQ_(key);
    return paras.some(function (p) { return normQ_(p).replace(/\s+/g, ' ').indexOf(nk) >= 0; }) ? '' : '的關鍵字句在文章裡找不到';
  }
  var refs = String(q.ref || '').split(',').map(function (r) { return r.trim(); }).filter(String);
  if (!refs.length) return '缺少原文依據（關鍵字句或原文句子）';
  for (var i = 0; i < refs.length; i++) {
    var m = /^(\d+)-(\d+)$/.exec(refs[i]);
    if (!m || !paras[Number(m[1]) - 1] || !splitSentences_(paras[Number(m[1]) - 1])[Number(m[2]) - 1]) return '的原文句子編號 ' + refs[i] + ' 不存在';
  }
  return '';
}

/* ------------------------------------------------------------------ */
/* AI 出題（Google Gemini）                                              */
/* ------------------------------------------------------------------ */
// API 金鑰存在「指令碼屬性」，只有老師能在後台設定，不會傳到學生網站。

var AI_KEY_PROP = 'GEMINI_API_KEY';
var AI_MODEL_PROP = 'GEMINI_MODEL';
var AI_DEFAULT_MODEL = 'gemini-3.8-flash';
// 用量用完（429）或模型暫時不可用（404）時，自動依序改試這些模型，不用手動改設定。
// 依序從最新的穩定 Flash 版本試到較舊、額度通常比較寬的版本（AI Studio「模型」頁上標示「穩定」的那些）。
var AI_FALLBACK_MODELS = ['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'];
var AI_MAX_COPY = 6; // 和課文連續相同的英文字數上限（與後台、tools/check-content.mjs 一致）
var SKILLS = ['主旨', '細節', '字義', '推論', '態度'];

// 本地模型（Ollama、LM Studio、llama.cpp、vLLM 等「OpenAI 相容」伺服器）
var AI_PROVIDER_PROP = 'AI_PROVIDER';       // 'gemini'（預設）或 'local'
var LOCAL_URL_PROP = 'LOCAL_AI_URL';        // 例：https://xxxx.trycloudflare.com/v1
var LOCAL_MODEL_PROP = 'LOCAL_AI_MODEL';    // 例：qwen2.5:14b
var LOCAL_KEY_PROP = 'LOCAL_AI_KEY';        // 伺服器有設密碼才需要

function getAiStatus() {
  assertTeacher_();
  var props = PropertiesService.getScriptProperties();
  var key = props.getProperty(AI_KEY_PROP) || '';
  var provider = props.getProperty(AI_PROVIDER_PROP) === 'local' ? 'local' : 'gemini';
  var localUrl = props.getProperty(LOCAL_URL_PROP) || '';
  var localModel = props.getProperty(LOCAL_MODEL_PROP) || '';
  var localKey = props.getProperty(LOCAL_KEY_PROP) || '';
  return {
    provider: provider,
    configured: provider === 'local' ? !!(localUrl && localModel) : !!key,
    hint: provider === 'local' ? localModel : (key ? '…' + key.slice(-4) : ''),
    geminiHint: key ? '…' + key.slice(-4) : '',
    model: props.getProperty(AI_MODEL_PROP) || AI_DEFAULT_MODEL,
    localUrl: localUrl, localModel: localModel, localKeyHint: localKey ? '…' + localKey.slice(-4) : '',
  };
}

// opts（可省略）：{ provider, localUrl, localModel, localKey }；空白的欄位保留原本的值
function setAiSettings(key, model, opts) {
  assertTeacher_();
  var props = PropertiesService.getScriptProperties();
  key = String(key || '').trim();
  model = String(model || '').trim();
  if (key) props.setProperty(AI_KEY_PROP, key);
  if (model) props.setProperty(AI_MODEL_PROP, model);
  opts = opts || {};
  if (opts.provider) props.setProperty(AI_PROVIDER_PROP, opts.provider === 'local' ? 'local' : 'gemini');
  var url = String(opts.localUrl || '').trim().replace(/\/+$/, '').replace(/\/chat\/completions$/, '');
  if (url) {
    if (!/^https:\/\//i.test(url)) throw new Error('本地模型網址要是 https:// 開頭的公開網址（Apps Script 在 Google 雲端執行，連不到 localhost，請用 Cloudflare Tunnel 或 ngrok 對外開放）');
    if (!/\/v1$/.test(url)) url += '/v1';
    props.setProperty(LOCAL_URL_PROP, url);
  }
  if (String(opts.localModel || '').trim()) props.setProperty(LOCAL_MODEL_PROP, String(opts.localModel).trim());
  if (String(opts.localKey || '').trim()) props.setProperty(LOCAL_KEY_PROP, String(opts.localKey).trim());
  return getAiStatus();
}

function clearAiKey(which) {
  assertTeacher_();
  var props = PropertiesService.getScriptProperties();
  if (which === 'local') { props.deleteProperty(LOCAL_KEY_PROP); props.deleteProperty(LOCAL_URL_PROP); props.deleteProperty(LOCAL_MODEL_PROP); props.setProperty(AI_PROVIDER_PROP, 'gemini'); }
  else props.deleteProperty(AI_KEY_PROP);
  return getAiStatus();
}

// 測試本地模型連線：請模型回一個很短的 JSON
function testLocalAi() {
  assertTeacher_();
  var t = Date.now();
  var r = aiCallLocal_('Reply with JSON {"ok": true}.', { type: 'OBJECT', properties: { ok: { type: 'BOOLEAN' } }, required: ['ok'] });
  return { ok: !!r, ms: Date.now() - t, model: PropertiesService.getScriptProperties().getProperty(LOCAL_MODEL_PROP) };
}

/* ------------------------------------------------------------------ */
/* 四種題型各自的 AI 出題提示詞（老師可在後台修改，留空＝還原預設）          */
/* ------------------------------------------------------------------ */
var AI_PROMPT_DEFAULTS = {
  vocab: [
    '- "word": exactly as given',
    '- "pos": one of n. / v. / adj. / adv. / prep. / conj. / phr. (use "phr." for multi-word phrases; for words with two common uses write e.g. "n. / v.")',
    '- "zh": the most common meaning in Traditional Chinese (Taiwan usage), short, with ； between senses, at most two senses',
    '- "examples": EXACTLY 3 natural example sentences, each at CEFR B1–B2 level, 8–16 words, each in a clearly different situation/context (e.g. school, family, society). In every sentence the target word or phrase appears once and is wrapped in square brackets, e.g. "The team [bounced back] after the loss." The bracketed text may be an inflected form (past tense, plural, -ing).',
    '- "exampleZh" of each example: a natural Traditional Chinese translation of that sentence (students read it as a hint, so it must match the sentence exactly)',
  ].join('\n'),
  reading: [
    '- Mix these question types and put the type in "skill": 主旨 (main idea), 細節 (detail), 字義 (word meaning in context), 推論 (inference), 態度 (attitude/tone). Use 主旨 at most once.',
    '- Each question has exactly 4 options in English; exactly one is correct. "answer" is the 0-based index of the correct option. Vary the position of the correct answer.',
    '- Wrong options must be plausible and similar in length, but clearly wrong according to the passage. Do not use "All of the above" or "None of the above".',
    '- Paraphrase. Never copy {{copy}} or more consecutive words from the passage into a question or an option. Students must understand the passage, not match words.',
    '- For 字義 questions you may quote the single target word or short phrase in quotation marks.',
    '- "explain" is a short explanation in Traditional Chinese (Taiwan usage), saying which paragraph supports the answer and why.',
    '- Keep the English at a CEFR B1–B2 level.',
  ].join('\n'),
  pattern: [
    '- Mostly mix "mc" (multiple choice) and "fill" (fill in the blank). Add an occasional "apply" item (about 1 in 6) — never more than a quarter of the set.',
    '- Focus on the grammar / sentence patterns of the topic. Put a short pattern name in "tag" (e.g. "not only…but also", "so…that", 倒裝句, 關係代名詞).',
    '- "mc": a sentence with one blank written as ____ in "q"; exactly 4 English options; "answerIndex" is the 0-based index of the correct one. Distractors must be tempting grammar mistakes (wrong tense, word form, word order), not nonsense.',
    '- "fill": a sentence with one blank ____ in "q"; "answerText" lists EVERY wording that is grammatically correct and natural in that exact sentence, separated by | (e.g. "has been|’s been"); use ( ) for words that may be left out (e.g. "look forward to (the)"). Never list a wording that would be wrong in the sentence (tense, agreement, word form, preposition). Put a hint such as the base word or a Chinese cue in "hint", e.g. "(succeed)" or "（完成）".',
    '- "apply": "zh" is a natural Traditional Chinese sentence; "words" is the English sentence split into words/short chunks in SHUFFLED order (6–12 pieces); "answerText" is the complete correct English sentence (capitalise the first word, keep punctuation; pieces must exactly form the sentence). Only use one correct order.',
    '- Every item needs "explain": a short explanation in Traditional Chinese (Taiwan usage) of the rule and why the answer is right.',
    '- Sentences must be natural, CEFR B1–B2, 8–20 words, about school life, daily life or social topics. Do not repeat the same sentence frame.',
  ].join('\n'),
  exam: [
    '- Write a mock exam review modelled on the Taiwan GSAT (學測) English test, in this order: mc (詞彙), spell, phrase, cloze (綜合測驗), bank (文意選填), struct (篇章結構), reading (閱讀測驗) — using only the section counts requested.',
    '- "mc": a vocabulary item, one blank ____, exactly 4 options of the SAME part of speech and similar meaning/form so the answer depends on context; "answerIndex" 0-based; "explain" in Traditional Chinese.',
    '- "spell": a sentence with a blank ____ where the student types ONE word; "hint" = first letter + Chinese meaning (e.g. "c（冷靜的）"); "answerText" is the exact word (| for alternatives).',
    '- "phrase": a sentence with a blank ____ for a whole PHRASE (2–4 words); "hint" = Chinese meaning. The answer is NOT limited to one wording: "answerText" lists EVERY form that is grammatically correct and idiomatic in that exact sentence, separated by | (e.g. different inflections that fit the sentence, or an equally natural synonym phrase with the same meaning); use ( ) for optional words. The sentence must force the grammar (tense, subject agreement, -ing after "to") so that wrong forms really are wrong, and never list a form that would be ungrammatical or unnatural in the sentence.',
    '- "cloze": "title" + "passage" (array of paragraphs, 120–180 words in total, blanks written as (1), (2), (3)… in order, each number once) + "blanks" (one per number, exactly 4 options each, answerIndex, explain). Mix vocabulary, grammar/word forms, connectives and discourse in the blanks.',
    '- "bank": 文意選填. "title" + "passage" (150–200 words, blanks (1), (2)…) + "bank" (an array of 10 words/phrases shared by all blanks, e.g. verbs, nouns, adjectives, adverbs mixed, in random order; there are more words than blanks, so a few are distractors) + "blanks" (one per number: answerIndex = 0-based index into "bank", explain).',
    '- "struct": 篇章結構. "title" + "passage" (a passage of 3–4 paragraphs with blanks (1)–(4) where a whole sentence was removed) + "bank" (5 complete sentences: the 4 removed ones plus 1 distractor, random order) + "blanks" (answerIndex into "bank", explain pointing out the cohesion clue).',
    '- "translate": 中譯英. "zh" = a Traditional Chinese sentence to translate (one idea, 15–30 characters, a grammar point from the scope); "answerText" = the model English translation (use | to list 1–2 equally good alternatives); "explain" = scoring points in Traditional Chinese (key vocabulary and grammar that must be correct).',
    '- "essay": 英文作文. "q" = the writing prompt in Traditional Chinese (a situation, 2–3 guiding points); "minWords" = 120; "sample" = a model essay of 130–160 words, CEFR B1–B2, in 2–3 paragraphs; "explain" = marking points in Traditional Chinese (content, organisation, vocabulary, grammar).',
    '- "reading": "title" + "passage" (an array of 3–4 paragraphs, about 200–260 words in total, CEFR B1–B2, informative or narrative) + "questions" (each with skill 主旨/細節/字義/推論/態度, q, exactly 4 options, answerIndex, explain, and "key": the exact words copied verbatim from the passage (3–25 words, within one paragraph) that prove the correct answer — required for every question). Paraphrase; never copy {{copy}}+ consecutive words from the passage into a question or option.',
    '- All "explain" fields are short explanations in Traditional Chinese (Taiwan usage). Vary the position of the correct answer.',
  ].join('\n'),
};
var AI_PROMPT_LABELS = { vocab: '單字片語', reading: '課文理解', pattern: '句型練習', exam: '段考複習' };

function aiGuidance_(type) {
  var v = PropertiesService.getScriptProperties().getProperty('AI_PROMPT_' + type);
  var text = v && String(v).trim() ? String(v) : AI_PROMPT_DEFAULTS[type];
  return text.replace(/\{\{copy\}\}/g, String(AI_MAX_COPY - 1));
}

function getAiPrompts() {
  assertTeacher_();
  var props = PropertiesService.getScriptProperties();
  var out = {};
  Object.keys(AI_PROMPT_DEFAULTS).forEach(function (t) {
    var v = props.getProperty('AI_PROMPT_' + t);
    out[t] = { label: AI_PROMPT_LABELS[t], text: v && String(v).trim() ? String(v) : AI_PROMPT_DEFAULTS[t], custom: !!(v && String(v).trim()), defaults: AI_PROMPT_DEFAULTS[t] };
  });
  return out;
}

// text 留空或和預設一樣 ＝ 還原預設
function setAiPrompt(type, text) {
  assertTeacher_();
  if (!AI_PROMPT_DEFAULTS[type]) throw new Error('未知的題型');
  text = String(text || '').trim();
  if (text.length > 6000) throw new Error('提示詞太長（上限 6000 字）');
  var props = PropertiesService.getScriptProperties();
  if (!text || text === AI_PROMPT_DEFAULTS[type]) props.deleteProperty('AI_PROMPT_' + type);
  else props.setProperty('AI_PROMPT_' + type, text);
  return getAiPrompts();
}

function strs_(a) { return (a || []).map(function (x) { return String(x == null ? '' : x).trim(); }); }
function cleanChoice_(q) {
  var opts = strs_(q.options).filter(String);
  var ans = Number(q.answerIndex != null ? q.answerIndex : q.answer);
  if (opts.length < 2 || !(ans >= 0 && ans < opts.length)) return null;
  return { options: opts, answer: ans };
}

// 句型練習：選擇＋填空＋偶爾應用
function aiGeneratePattern(topic, count, hint) {
  assertTeacher_();
  topic = String(topic || '').trim();
  if (!topic) throw new Error('請輸入句型或文法主題（例如：not only…but also、關係代名詞）');
  count = Math.max(1, Math.min(20, Number(count) || 10));
  var schema = {
    type: 'OBJECT',
    properties: { items: { type: 'ARRAY', items: { type: 'OBJECT', properties: {
      type: { type: 'STRING', enum: ['mc', 'fill', 'apply'] }, tag: { type: 'STRING' }, q: { type: 'STRING' },
      options: { type: 'ARRAY', items: { type: 'STRING' } }, answerIndex: { type: 'INTEGER' }, answerText: { type: 'STRING' },
      hint: { type: 'STRING' }, zh: { type: 'STRING' }, words: { type: 'ARRAY', items: { type: 'STRING' } }, explain: { type: 'STRING' },
    }, required: ['type', 'tag', 'explain'] } } },
    required: ['items'],
  };
  var prompt = [
    'You are an experienced English teacher at a senior high school in Taiwan, writing a sentence-pattern practice set for 11th-grade students.',
    'Topic: ' + topic + (hint ? ' (' + hint + ')' : ''),
    'Write exactly ' + count + ' items. Rules:',
    aiGuidance_('pattern'),
  ].join('\n');
  var items = [];
  (aiCall_(prompt, schema).items || []).forEach(function (x) {
    var tag = String(x.tag || '').trim(), explain = String(x.explain || '').trim();
    if (x.type === 'mc') {
      var c = cleanChoice_(x);
      if (c && x.q) items.push({ type: 'mc', tag: tag, q: String(x.q).trim(), options: c.options, answer: c.answer, explain: explain });
    } else if (x.type === 'fill') {
      if (x.q && /_{2,}/.test(x.q) && String(x.answerText || '').trim()) items.push({ type: 'fill', tag: tag, q: String(x.q).trim(), answer: String(x.answerText).trim(), hint: String(x.hint || '').trim(), explain: explain });
    } else if (x.type === 'apply') {
      var w = strs_(x.words).filter(String), ans = String(x.answerText || '').trim();
      if (x.zh && ans && w.length >= 3 && normAns_(w.join(' ')).split(' ').sort().join(' ') === normAns_(ans).split(' ').sort().join(' ')) {
        items.push({ type: 'apply', tag: tag, zh: String(x.zh).trim(), words: w, answer: ans, explain: explain });
      }
    }
  });
  if (!items.length) throw new Error('AI 沒有產生可用的題目，請再試一次');
  return { topic: topic, items: items.slice(0, count) };
}

// 段考複習：選擇、拼寫、閱讀、綜合。counts = { mc, spell, reading, cloze }（reading／cloze 是「篇數」）
// 段考複習一次出一種題型（網頁分次呼叫，每次的回覆短、失敗只影響那一部分）；counts 只放一種題型即可
function aiGenerateExamPart(topic, counts, hint) { return aiGenerateExam(topic, counts, hint); }

function aiGenerateExam(topic, counts, hint) {
  assertTeacher_();
  topic = String(topic || '').trim();
  if (!topic) throw new Error('請輸入範圍（例如：Lesson 3–4 段考範圍）');
  counts = counts || {};
  var n = {
    mc: Math.max(0, Math.min(15, Number(counts.mc) || 0)), spell: Math.max(0, Math.min(10, Number(counts.spell) || 0)), phrase: Math.max(0, Math.min(10, Number(counts.phrase) || 0)),
    reading: Math.max(0, Math.min(2, Number(counts.reading) || 0)), cloze: Math.max(0, Math.min(2, Number(counts.cloze) || 0)),
    bank: Math.max(0, Math.min(1, Number(counts.bank) || 0)), struct: Math.max(0, Math.min(1, Number(counts.struct) || 0)),
    translate: Math.max(0, Math.min(4, Number(counts.translate) || 0)), essay: Math.max(0, Math.min(1, Number(counts.essay) || 0)),
  };
  if (!n.mc && !n.spell && !n.phrase && !n.reading && !n.cloze && !n.bank && !n.struct && !n.translate && !n.essay) throw new Error('至少要選一種題型');
  var wanted = Object.keys(n).filter(function (k) { return n[k] > 0; });
  var schema = {
    type: 'OBJECT',
    properties: { blocks: { type: 'ARRAY', items: { type: 'OBJECT', properties: {
      type: { type: 'STRING', enum: wanted }, zh: { type: 'STRING' }, sample: { type: 'STRING' }, minWords: { type: 'INTEGER' }, tag: { type: 'STRING' }, q: { type: 'STRING' }, bank: { type: 'ARRAY', items: { type: 'STRING' } },
      options: { type: 'ARRAY', items: { type: 'STRING' } }, answerIndex: { type: 'INTEGER' }, answerText: { type: 'STRING' },
      hint: { type: 'STRING' }, explain: { type: 'STRING' }, title: { type: 'STRING' }, passage: { type: 'ARRAY', items: { type: 'STRING' } },
      questions: { type: 'ARRAY', items: { type: 'OBJECT', properties: { skill: { type: 'STRING' }, q: { type: 'STRING' }, options: { type: 'ARRAY', items: { type: 'STRING' } }, answerIndex: { type: 'INTEGER' }, explain: { type: 'STRING' }, key: { type: 'STRING' } }, required: ['q', 'options', 'answerIndex', 'explain', 'key'] } },
      blanks: { type: 'ARRAY', items: { type: 'OBJECT', properties: { options: { type: 'ARRAY', items: { type: 'STRING' } }, answerIndex: { type: 'INTEGER' }, explain: { type: 'STRING' } }, required: ['answerIndex', 'explain'] } },
    }, required: ['type'] } } },
    required: ['blocks'],
  };
  var prompt = [
    'You are an experienced English teacher at a senior high school in Taiwan, writing a mock exam review for 11th-grade students.',
    'Scope: ' + topic + (hint ? ' (' + hint + ')' : ''),
    'Requested: ' + n.mc + ' mc, ' + n.spell + ' spell, ' + n.phrase + ' phrase, ' + n.cloze + ' cloze passage(s) with 5 blanks each, ' + n.bank + ' bank passage(s) with 10 blanks, ' + n.struct + ' struct passage(s) with 4 blanks, ' + n.translate + ' translate, ' + n.essay + ' essay, ' + n.reading + ' reading passage(s) with 4 questions each. Rules:',
    // 只附上這次要的題型的規則：提示詞短、回覆短，比較不容易失敗
    aiGuidance_('exam').split('\n').filter(function (l) { var m = /^- "(\w+)":/.exec(l); return !m || wanted.indexOf(m[1]) >= 0; }).join('\n'),
  ].join('\n');
  var blocks = [];
  (aiCall_(prompt, schema).blocks || []).forEach(function (x) {
    var explain = String(x.explain || '').trim();
    if (x.type === 'mc') {
      var c = cleanChoice_(x);
      if (c && x.q) blocks.push({ type: 'mc', q: String(x.q).trim(), options: c.options, answer: c.answer, explain: explain });
    } else if (x.type === 'translate') {
      if (x.zh && String(x.answerText || '').trim()) blocks.push({ type: 'translate', zh: String(x.zh).trim(), answer: String(x.answerText).trim(), explain: explain });
    } else if (x.type === 'essay') {
      if (x.q && String(x.sample || '').trim()) blocks.push({ type: 'essay', q: String(x.q).trim(), minWords: Math.max(0, Math.min(1000, Number(x.minWords) || 120)), sample: String(x.sample).trim(), explain: explain });
    } else if (x.type === 'bank' || x.type === 'struct') {
      var bp = strs_(x.passage).filter(String), bk = strs_(x.bank).filter(String), bb = [];
      (x.blanks || []).forEach(function (q) { var ai = Number(q.answerIndex); if (ai >= 0 && ai < bk.length) bb.push({ answer: ai, explain: String(q.explain || '').trim() }); });
      var bj = bp.join(' '), bok = bb.length > 0 && bk.length >= 2 && bk.length <= 10;
      for (var bi = 1; bi <= bb.length; bi++) if (bj.indexOf('(' + bi + ')') < 0) bok = false;
      if (bp.length && bok) blocks.push({ type: x.type, title: String(x.title || '').trim(), passage: bp, bank: bk, blanks: bb });
    } else if (x.type === 'spell' || x.type === 'phrase') {
      if (x.q && String(x.answerText || '').trim()) blocks.push({ type: x.type, q: String(x.q).trim(), hint: String(x.hint || '').trim(), answer: String(x.answerText).trim(), explain: explain });
    } else if (x.type === 'reading') {
      var passage = strs_(x.passage).filter(String), qs = [];
      (x.questions || []).forEach(function (q) { var c2 = cleanChoice_(q); if (c2 && q.q) qs.push({ skill: String(q.skill || '').trim(), q: String(q.q).trim(), options: c2.options, answer: c2.answer, explain: String(q.explain || '').trim(), key: String(q.key || '').replace(/\s+/g, ' ').trim() }); });
      if (passage.length && qs.length) blocks.push({ type: 'reading', title: String(x.title || '').trim(), passage: passage, questions: qs });
    } else if (x.type === 'cloze') {
      var cp = strs_(x.passage).filter(String), bl = [];
      (x.blanks || []).forEach(function (q) { var c3 = cleanChoice_(q); if (c3) bl.push({ options: c3.options, answer: c3.answer, explain: String(q.explain || '').trim() }); });
      var joined = cp.join(' '), okAll = bl.length > 0;
      for (var i = 1; i <= bl.length; i++) if (joined.indexOf('(' + i + ')') < 0) okAll = false;
      if (cp.length && okAll) blocks.push({ type: 'cloze', title: String(x.title || '').trim(), passage: cp, blanks: bl });
    }
  });
  if (!blocks.length) throw new Error('AI 沒有產生可用的題目，請再試一次');
  return { topic: topic, blocks: blocks };
}

// 老師用：檢查填空／拼寫／片語的答案寫法是否文法、用法都正確，並補上其他同樣正確的寫法
// items: [{ id, sentence, hint, answer }]；回傳 [{ id, ok, answer, note }]（answer 是建議的完整寫法，用 | 與 ( ) 表示）
function aiCheckAnswers(items) {
  assertTeacher_();
  items = (items || []).filter(function (x) { return x && x.sentence && x.answer; }).slice(0, 30);
  if (!items.length) throw new Error('沒有可以檢查的填空、拼寫或片語題');
  var schema = {
    type: 'OBJECT',
    properties: { items: { type: 'ARRAY', items: { type: 'OBJECT', properties: {
      id: { type: 'STRING' }, ok: { type: 'BOOLEAN' }, answer: { type: 'STRING' }, note: { type: 'STRING' },
    }, required: ['id', 'ok', 'answer', 'note'] } } },
    required: ['items'],
  };
  var prompt = [
    'You are a careful English grammar reviewer for a Taiwanese senior-high school exam. Each item is a sentence with one blank ____ and the answer key the teacher wrote.',
    'The answer key lists acceptable wordings separated by "|"; words in ( ) are optional.',
    'For each item:',
    '1. Test every wording in the key by putting it into the blank. It must be grammatical (tense, subject–verb agreement, word form, preposition, article) AND natural/idiomatic in THAT exact sentence. Remove any wording that fails.',
    '2. Add other wordings that are equally correct and natural in that sentence and fit the hint (other valid inflections, an equally natural phrase with the same meaning), but do NOT add anything doubtful, stylistically odd, or that changes the meaning.',
    '3. Return "answer" = the corrected full key (use | between wordings and ( ) for optional words; keep the teacher\'s main answer first when it is correct). If the key was already complete and correct, return it unchanged with ok=true. Otherwise ok=false.',
    '4. "note" = one short sentence in Traditional Chinese (Taiwan usage) saying what you removed or added and why; if nothing changed, say 答案正確。',
    '',
    'Items:',
    items.map(function (x) { return x.id + '. Sentence: ' + x.sentence + (x.hint ? '  (hint: ' + x.hint + ')' : '') + '\n   Answer key: ' + x.answer; }).join('\n'),
  ].join('\n');
  var out = (aiCall_(prompt, schema).items || []).map(function (x) {
    return { id: String(x.id || '').replace(/\.$/, '').trim(), ok: !!x.ok, answer: String(x.answer || '').trim(), note: String(x.note || '').trim() };
  }).filter(function (x) { return x.id && x.answer; });
  return { items: out };
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
    aiGuidance_('reading'),
    '- Every sentence in the passage is labelled [paragraph-sentence], e.g. [2-3] is paragraph 2, sentence 3.',
    '- "ref" is the label (without brackets, e.g. "2-3") of the ONE sentence that best supports the correct answer. EVERY question must have a ref, including 主旨 questions (use the sentence that states the main idea).',
    '- "key" is the exact words copied from the passage (3–25 words, within one paragraph, may cross a sentence boundary, without the [x-y] labels) that directly prove the correct answer — the precise clue a teacher would underline, not the whole sentence if only part of it matters. This is the ONLY field that must be copied verbatim. EVERY question must have a key, including 主旨 questions.',
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
// 幫已經有例句的字，多生一句「內容不同」的例句：讓同一個字、同一種題型，每次考的內容也不一樣。
// items: [{ word, zh, example }]（example 是現有的第一句，給 AI 當參考、避免重複出同樣情境）
function aiAddExamples(items) {
  assertTeacher_();
  // items: [{ word, zh, example, need }]；need = 還缺幾句（1–2），目標是每個字共 3 句
  items = (items || []).filter(function (x) { return x && x.word && x.zh && x.example; }).slice(0, 60);
  if (!items.length) throw new Error('請先填好每個字的英文、中文與至少一句例句');
  var schema = {
    type: 'OBJECT',
    properties: {
      items: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            word: { type: 'STRING' },
            examples: { type: 'ARRAY', items: { type: 'OBJECT', properties: { example: { type: 'STRING' }, exampleZh: { type: 'STRING' } }, required: ['example', 'exampleZh'] } },
          },
          required: ['word', 'examples'],
        },
      },
    },
    required: ['items'],
  };
  var prompt = [
    'You are an English teacher preparing extra practice sentences for 11th-grade students in Taiwan.',
    'For each word or phrase below, its Chinese meaning and an EXISTING example sentence are given.',
    'Write the requested number of NEW example sentences for it. Every new sentence must be in a clearly different context/situation than the existing one and than each other, CEFR B1–B2, 8–16 words,',
    'with the target word or phrase (an inflected form is fine — past tense, plural, -ing, etc.) wrapped exactly once in square brackets,',
    'e.g. "She [adapted] quickly to her new school." Also give a natural Traditional Chinese translation of each sentence (students use the translation as a hint).',
    '',
    'Words:',
    items.map(function (x, i) { return (i + 1) + '. ' + x.word + '（' + x.zh + '）existing example: ' + x.example + ' — write ' + Math.max(1, Math.min(2, Number(x.need) || 1)) + ' new sentence(s)'; }).join('\n'),
  ].join('\n');
  var out = (aiCall_(prompt, schema).items || []).map(function (x) {
    return {
      word: String(x.word || '').trim(),
      examples: (x.examples || []).map(function (e) { return { example: String(e.example || '').trim(), exampleZh: String(e.exampleZh || '').trim() }; }).filter(function (e) { return e.example; }),
    };
  }).filter(function (x) { return x.word && x.examples.length; });
  return { items: out };
}

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
            examples: { type: 'ARRAY', items: { type: 'OBJECT', properties: { example: { type: 'STRING' }, exampleZh: { type: 'STRING' } }, required: ['example', 'exampleZh'] } },
          },
          required: ['word', 'pos', 'zh', 'examples'],
        },
      },
    },
    required: ['words'],
  };
  var prompt = [
    'You are an English teacher at a senior high school in Taiwan preparing a vocabulary list for 11th-grade students.',
    'For each English word or phrase below, return one entry in the same order with the fields word, pos, zh, examples (each with example and exampleZh), following these rules:',
    aiGuidance_('vocab'),
    '',
    'Words:',
    items.map(function (w, i) { return (i + 1) + '. ' + w; }).join('\n'),
  ].join('\n');
  var out = (aiCall_(prompt, schema).words || []).map(function (w) {
    var exs = (w.examples || []).map(function (e) { return { example: String(e.example || '').trim(), exampleZh: String(e.exampleZh || '').trim() }; }).filter(function (e) { return e.example; }).slice(0, 3);
    return {
      word: String(w.word || '').trim(), pos: String(w.pos || '').trim(), zh: String(w.zh || '').trim(),
      examples: exs, example: exs.length ? exs[0].example : '', exampleZh: exs.length ? exs[0].exampleZh : '',
    };
  }).filter(function (w) { return w.word; });
  return { words: out };
}

// 依序試這個模型鏈：目前這次用量用完（429）或這個模型暫時不可用（404）就自動改下一個，
// 直到成功或全部試過；其他種類的錯誤（金鑰錯誤、沒有權限等）不用重試，直接回報。
function aiCall_(prompt, schema) {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty(AI_PROVIDER_PROP) === 'local') return aiCallLocal_(prompt, schema);
  var key = props.getProperty(AI_KEY_PROP);
  if (!key) throw new Error('還沒有設定 Gemini API 金鑰，請先在「AI 設定」填入');
  var chosen = props.getProperty(AI_MODEL_PROP) || AI_DEFAULT_MODEL;
  var chain = [chosen].concat(AI_FALLBACK_MODELS.filter(function (m) { return m !== chosen; }));
  var lastErr = null;
  for (var i = 0; i < chain.length; i++) {
    // 「目前忙碌中」通常過幾秒就好了，同一個模型先重試一次，還是忙才換下一個模型
    for (var attempt = 0; attempt < 2; attempt++) {
      try {
        return aiCallOnce_(chain[i], key, prompt, schema);
      } catch (e) {
        lastErr = e;
        if (!/^RETRY:/.test(e.message)) throw e;
        if (attempt === 0 && /^RETRY:BUSY/.test(e.message)) { Utilities.sleep(1500); continue; }
        break;
      }
    }
  }
  throw new Error(String(lastErr.message).replace(/^RETRY:(BUSY)?/, '') + '（已試過 ' + chain.length + ' 個模型都額滿或忙碌中，請稍後再試）');
}

function aiCallOnce_(model, key, prompt, schema) {
  var res = UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent', {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-goog-api-key': key },
    muteHttpExceptions: true,
    payload: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json', responseSchema: schema, temperature: 0.7, maxOutputTokens: 16384 },
    }),
  });
  var code = res.getResponseCode();
  var body = res.getContentText();
  if (code !== 200) {
    var msg = '';
    try { msg = JSON.parse(body).error.message; } catch (err) { msg = body.slice(0, 200); }
    if (code === 400 && /API key/i.test(msg)) throw new Error('API 金鑰無效，請到「AI 設定」重新填入');
    if (code === 403) throw new Error('這組金鑰沒有權限使用 Gemini（學校帳號可能被管理員關閉，可改用個人 Gmail 申請）：' + msg);
    if (code === 404) throw new Error('RETRY:找不到模型「' + model + '」');
    if (code === 429) throw new Error('RETRY:「' + model + '」用量已達上限');
    if (code === 500 || code === 503) throw new Error('RETRY:BUSY「' + model + '」目前使用的人太多');
    throw new Error('Gemini 錯誤 ' + code + '：' + msg);
  }
  var data = JSON.parse(body);
  var cand = data.candidates && data.candidates[0];
  var text = cand && cand.content && cand.content.parts && cand.content.parts.map(function (p) { return p.text || ''; }).join('');
  // 沒內容、被截斷（回覆太長）或格式壞掉：多半重試一次就好，所以走「重試／換模型」的流程，而不是直接報錯
  if (!text) throw new Error('RETRY:BUSY「' + model + '」沒有回傳內容' + (cand && cand.finishReason ? '（' + cand.finishReason + '）' : ''));
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error('RETRY:BUSY「' + model + '」回傳的格式無法解析' + (cand && cand.finishReason === 'MAX_TOKENS' ? '（回覆太長被截斷）' : ''));
  }
}

/* ---------- 本地模型（OpenAI 相容 API） ---------- */
// Gemini 的 schema（type 大寫）轉成一般 JSON Schema（小寫）
function toJsonSchema_(s) {
  if (!s || typeof s !== 'object') return s;
  var out = {};
  Object.keys(s).forEach(function (k) {
    var v = s[k];
    if (k === 'type') out.type = String(v).toLowerCase();
    else if (k === 'properties') { out.properties = {}; Object.keys(v).forEach(function (p) { out.properties[p] = toJsonSchema_(v[p]); }); }
    else if (k === 'items') out.items = toJsonSchema_(v);
    else out[k] = v;
  });
  if (out.type === 'object') out.additionalProperties = false;
  return out;
}

function aiCallLocal_(prompt, schema) {
  var props = PropertiesService.getScriptProperties();
  var base = props.getProperty(LOCAL_URL_PROP), model = props.getProperty(LOCAL_MODEL_PROP), key = props.getProperty(LOCAL_KEY_PROP);
  if (!base || !model) throw new Error('還沒有設定本地模型的網址與模型名稱，請先在「AI 設定」填入');
  var js = toJsonSchema_(schema);
  var sys = 'You are a helpful assistant that only replies with a single JSON object matching this JSON Schema, with no extra text and no markdown fences:\n' + JSON.stringify(js);
  // Qwen3 系列預設會先長篇「思考」，出題不需要，關掉比較快也比較不會逾時
  if (/qwen3/i.test(model)) sys += '\n/no_think';
  var headers = { 'ngrok-skip-browser-warning': '1' };
  if (key) headers.Authorization = 'Bearer ' + key;
  function send(format) {
    var body = { model: model, temperature: 0.7, stream: false, messages: [{ role: 'system', content: sys }, { role: 'user', content: prompt }] };
    if (format) body.response_format = format;
    try {
      return UrlFetchApp.fetch(base + '/chat/completions', { method: 'post', contentType: 'application/json', headers: headers, muteHttpExceptions: true, payload: JSON.stringify(body) });
    } catch (e) {
      throw new Error('連不到本地模型（' + base + '）：' + e.message + '。請確認電腦開著、模型伺服器與通道（Cloudflare Tunnel / ngrok）都在執行，而且網址沒有改變');
    }
  }
  // 先用 json_schema 格式（Ollama、LM Studio、vLLM 支援）；伺服器不支援就退回 json_object，再不行就只靠提示詞
  var formats = [{ type: 'json_schema', json_schema: { name: 'result', strict: true, schema: js } }, { type: 'json_object' }, null];
  var res, code, text;
  for (var i = 0; i < formats.length; i++) {
    res = send(formats[i]); code = res.getResponseCode(); text = res.getContentText();
    if (code === 200) break;
    if (code !== 400 && code !== 422 && code !== 500) break;
  }
  if (code === 401 || code === 403) throw new Error('本地模型伺服器拒絕連線（' + code + '），請確認「本地模型密碼」');
  if (code === 404) throw new Error('本地模型伺服器找不到（404）：網址要到 /v1 為止，或模型名稱「' + model + '」不存在（Ollama 可用 ollama list 查看）');
  if (code !== 200) throw new Error('本地模型錯誤 ' + code + '：' + String(text).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 200));
  var data;
  try { data = JSON.parse(text); } catch (e) { throw new Error('本地模型網址回傳的不是 API 資料，請確認網址（要到 /v1 為止）'); }
  var content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  if (!content) throw new Error('本地模型沒有回傳內容，請再試一次');
  return parseLooseJson_(content);
}

// 本地模型常在 JSON 外面多包 <think>…</think> 或 ```json，這裡把它剝掉
function parseLooseJson_(t) {
  t = String(t).replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/```(?:json)?/gi, '').trim();
  try { return JSON.parse(t); } catch (e) {}
  var a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch (e) {} }
  throw new Error('本地模型回傳的格式無法解析，請再試一次，或改用比較大的模型');
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

// 一次把幾份文件寫進 Firestore 的 public 集合（單一請求、不可分割）：{ 文件代號: JSON 字串 }
function publishDocs_(docs) {
  var ids = Object.keys(docs);
  if (!ids.length) return;
  try {
    var res = UrlFetchApp.fetch(FIRESTORE_ROOT + ':commit', {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
      payload: JSON.stringify({
        writes: ids.map(function (id) {
          return { update: { name: 'projects/eng-3385e/databases/(default)/documents/public/' + id, fields: { json: { stringValue: docs[id] } } } };
        }),
      }),
      muteHttpExceptions: true,
    });
    if (res.getResponseCode() >= 300) {
      LAST_SYNC_ERROR = 'HTTP ' + res.getResponseCode() + '：' + res.getContentText().slice(0, 200);
      Logger.log('Firestore 同步失敗 ' + ids.join(',') + '：' + res.getContentText());
    }
  } catch (e) {
    LAST_SYNC_ERROR = String(e);
    Logger.log('Firestore 同步失敗 ' + ids.join(',') + '：' + e);
  }
}
var LAST_SYNC_ERROR = '';

// 重新計算設定並同步到 Firestore；extraDocs（例如剛存好的題目）跟設定放在同一個請求裡一起寫
function publishConfig_(extraDocs) {
  CacheService.getScriptCache().remove(CONFIG_CACHE_KEY);
  var cfg = readConfigCached_();
  var docs = extraDocs || {};
  docs.config = JSON.stringify(cfg);
  publishDocs_(docs);
  return cfg;
}

// 手動全部同步一次（第一次設定、或 Firestore 資料不見時）：在編輯器選這個函式按「執行」
function syncToFirestore() {
  publishConfig_();
  var docs = {};
  readContentRows_().forEach(function (r) {
    docs['content_' + r.id] = JSON.stringify({ v: r.updated, data: JSON.parse(r.json) });
  });
  publishDocs_(docs);
}

function readConfigCached_() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get(CONFIG_CACHE_KEY);
  if (hit) return JSON.parse(hit);
  var cfg = { units: {}, updated: new Date().toISOString() };
  readSettingsRows_().forEach(function (u) {
    cfg.units[u.id] = { visible: u.visible, disabled: u.disabled, questionCount: u.questionCount, openAt: u.openAt, closeAt: u.closeAt };
  });
  // 補作時間：{ 單元: { '班級-座號': '補作到' } }（只有班級座號，沒有姓名）
  cfg.ext = {};
  readExtensions_().forEach(function (x) {
    cfg.ext[x.unit] = cfg.ext[x.unit] || {};
    cfg.ext[x.unit][x.cls + '-' + x.seat] = x.until;
  });
  // 老師後台新增的全新單元：網站前端會把這些併進課次清單（見 js/data.js 的 addCustomUnits）
  var customUnits = readCustomUnitsRows_();
  cfg.customUnits = customUnits.map(function (u) {
    return { id: u.id, title: u.title, type: u.type, lesson: u.lesson, topic: u.topic };
  });
  customUnits.forEach(function (u) {
    cfg.units[u.id] = { visible: u.visible, disabled: u.disabled, questionCount: u.questionCount, since: u.createdAt || '', openAt: u.openAt, closeAt: u.closeAt };
  });
  // 題目更新過的單元：重製時間取較晚的一個
  var resets = JSON.parse(PropertiesService.getScriptProperties().getProperty('RESET_AT') || '{}');
  Object.keys(resets).forEach(function (id) {
    if (!cfg.units[id]) cfg.units[id] = {};
    var cur = cfg.units[id].since || '';
    if (resets[id] > cur) cfg.units[id].since = resets[id];
  });
  // 老師匯入過的單元：網站會改讀試算表裡的內容
  cfg.content = {};
  readContentMeta_().forEach(function (r) {
    cfg.content[r.id] = { updated: r.updated, count: r.count, topic: r.topic };
  });
  cache.put(CONFIG_CACHE_KEY, JSON.stringify(cfg), 60);
  return cfg;
}

// 開放時段：存成「2026-10-01T08:00」這種台灣時間字串（空白＝不限制）
function timeCell_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, 'Asia/Taipei', "yyyy-MM-dd'T'HH:mm");
  var t = String(v || '').trim();
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(t) ? t : '';
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
        openAt: timeCell_(r[6]),
        closeAt: timeCell_(r[7]),
      };
    });
}

/* ------------------------------------------------------------------ */
/* Auth                                                                */
/* ------------------------------------------------------------------ */

function currentEmail_() {
  if (API_EMAIL) return API_EMAIL;
  try {
    return String(Session.getActiveUser().getEmail() || '').toLowerCase();
  } catch (err) {
    return '';
  }
}

// 老師名單：試算表 teachers 分頁，或 Firestore 的 admins（網站老師頁用的那份），任一份有就算
function isTeacher_(email) {
  if (!email) return false;
  var cache = CacheService.getScriptCache();
  var ck = 'adm:' + email;
  var hit = cache.get(ck);
  if (hit) return hit === '1';
  var ok = isTeacherUncached_(email);
  cache.put(ck, ok ? '1' : '0', 300);
  return ok;
}
function isTeacherUncached_(email) {
  var sh = sheet_(SHEET_TEACHERS, ['email', 'note']);
  var last = sh.getLastRow();
  if (last >= 2 && sh.getRange(2, 1, last - 1, 1).getValues().some(function (r) {
    return String(r[0]).trim().toLowerCase() === email;
  })) return true;
  try { return !!firestoreRequest_('get', FIRESTORE_ROOT + '/admins/' + encodeURIComponent(email)); } catch (err) { return false; }
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
