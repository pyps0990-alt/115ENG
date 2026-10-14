// 在 Node 裡執行真正的 apps-script/Code.gs（用假的試算表、快取、UrlFetchApp），測試後台的儲存邏輯。
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// 學生帳本 key（跟 js/firebase.js studentKey 一樣）
export const keyOf = (cls, seat, name) => crypto.createHash('sha256').update(`${String(cls).trim()}|${String(seat).trim()}|${String(name).trim().replace(/\s+/g, '')}`).digest('hex');

export function createGas({ teachers = ['teacher@example.com'], onFirestoreCommit = () => {}, codePath = path.join(ROOT, 'apps-script', 'Code.gs'), rosterKeys = null, fsAdmins = [], rtdbStaff = null } = {}) {
  const sheets = new Map();
  const calls = { commit: [], sheetReads: 0, urlFetch: 0 };
  const admins = new Set(fsAdmins); // Firestore admins/{email}
  const rtdb = { staff: rtdbStaff }; // Realtime Database；rtdb.down = true 模擬資料庫還沒建立
  const publicDocs = new Map(); // Firestore 的 public/ 文件（題目只存在這裡）；global.__commitFail = true 模擬寫入失敗

  class Range {
    constructor(sh, r, c, nr, nc) { Object.assign(this, { sh, r, c, nr, nc }); }
    getValues() {
      calls.sheetReads++;
      const out = [];
      for (let i = 0; i < this.nr; i++) {
        const row = [];
        for (let j = 0; j < this.nc; j++) row.push(this.sh.rows[this.r - 1 + i]?.[this.c - 1 + j] ?? '');
        out.push(row);
      }
      return out;
    }
    getValue() { return this.getValues()[0][0]; }
    setValues(v) {
      v.forEach((row, i) => row.forEach((val, j) => {
        const R = this.r - 1 + i;
        while (this.sh.rows.length <= R) this.sh.rows.push([]);
        const line = this.sh.rows[R];
        while (line.length < this.c - 1 + j) line.push('');
        line[this.c - 1 + j] = val;
      }));
      return this;
    }
    setValue(v) { return this.setValues([[v]]); }
    clearContent() {
      for (let i = 0; i < this.nr; i++) for (let j = 0; j < this.nc; j++) {
        const line = this.sh.rows[this.r - 1 + i]; if (line) line[this.c - 1 + j] = '';
      }
      return this;
    }
    createTextFinder(t) {
      const vals = this.getValues().flat();
      return { matchEntireCell() { return this; }, findNext: () => (vals.some((v) => String(v) === t) ? {} : null) };
    }
    setNote() { return this; }
    sort({ column, ascending = true }) {
      const rows = [];
      for (let i = 0; i < this.nr; i++) rows.push(this.getValues()[i]);
      const k = column - this.c;
      rows.sort((a, b) => (ascending ? 1 : -1) * (Number(a[k]) - Number(b[k]) || String(a[k]).localeCompare(String(b[k]))));
      this.setValues(rows);
      return this;
    }
    setNumberFormat() { return this; }
    setFontWeight() { return this; }
  }
  class Sheet {
    constructor(name) { this.name = name; this.rows = []; }
    getName() { return this.name; }
    getLastRow() {
      let n = this.rows.length;
      while (n > 0 && this.rows[n - 1].every((x) => x === '' || x == null)) n--;
      return n;
    }
    getLastColumn() { return this.rows.reduce((m, r) => Math.max(m, r.length), 0); }
    getRange(r, c, nr = 1, nc = 1) { return new Range(this, r, c, nr, nc); }
    appendRow(arr) { const at = this.getLastRow(); this.rows[at] = arr.slice(); }
    deleteRow(i) { this.rows.splice(i - 1, 1); }
    deleteRows(i, n) { this.rows.splice(i - 1, n); }
    setFrozenRows() {}
    setFrozenColumns() {}
  }
  const ss = {
    getSheetByName: (n) => sheets.get(n) || null,
    insertSheet: (n) => { const s = new Sheet(n); sheets.set(n, s); return s; },
    getSheets: () => [...sheets.values()],
    deleteSheet: (s) => sheets.delete(s.name),
    getUrl: () => 'https://docs.google.com/spreadsheets/d/test',
    getName: () => 'test',
    // 備份：複製出一份獨立的試算表（ss.copies 留著給測試檢查）
    copy: (name) => {
      const m = new Map([...sheets].map(([k, v]) => { const c = new Sheet(k); c.rows = v.rows.map((r) => [...r]); return [k, c]; }));
      const c = { name, getSheetByName: (n) => m.get(n) || null, getUrl: () => 'https://docs.google.com/spreadsheets/d/copy', sheets: m };
      (ss.copies ||= []).push(c);
      return c;
    },
  };

  const cacheMap = new Map();
  const lock = { busy: false };
  const propMap = new Map();
  const resp = (code, text) => ({ getResponseCode: () => code, getContentText: () => text });
  const sandbox = {
    console, Date, JSON, Math, String, Number, Array, Object, RegExp, Error, isNaN, parseInt, parseFloat, encodeURIComponent, decodeURIComponent,
    Logger: { log: () => {} },
    SpreadsheetApp: { getActiveSpreadsheet: () => ss, getUi: () => ({}), flush() {} },
    CacheService: { getScriptCache: () => ({
      get: (k) => (cacheMap.has(k) ? cacheMap.get(k) : null),
      put: (k, v) => { cacheMap.set(k, v); },
      remove: (k) => { cacheMap.delete(k); },
    }) },
    PropertiesService: { getScriptProperties: () => ({
      getProperty: (k) => (propMap.has(k) ? propMap.get(k) : null),
      setProperty: (k, v) => { propMap.set(k, String(v)); },
      deleteProperty: (k) => { propMap.delete(k); },
    }) },
    // lock.busy = true：模擬別的執行正在整理成績（拿不到鎖）
    LockService: { getScriptLock: () => ({
      waitLock() { if (lock.busy) throw new Error('Lock timeout'); },
      tryLock: () => !lock.busy,
      releaseLock() {},
    }) },
    ScriptApp: { getOAuthToken: () => 'oauth-token' },
    Session: {
      getScriptTimeZone: () => 'Asia/Taipei',
      getActiveUser: () => ({ getEmail: () => '' }),
      getEffectiveUser: () => ({ getEmail: () => 'owner@example.com' }),
    },
    ContentService: {
      MimeType: { JSON: 'json' },
      createTextOutput: (t) => ({ t, setMimeType() { return this; }, getContent() { return this.t; } }),
    },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
      computeDigest: (_a, s) => [...crypto.createHash('sha256').update(String(s)).digest()].map((b) => (b > 127 ? b - 256 : b)),
      base64EncodeWebSafe: (bytes) => Buffer.from(bytes.map((b) => b & 255)).toString('base64url'),
      sleep: () => {},
      formatDate: (d, tz, fmt) => {
        const p = new Intl.DateTimeFormat('en-CA', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(d)
          .reduce((o, x) => ({ ...o, [x.type]: x.value }), {});
        return fmt.replace(/'([^']*)'|yyyy|MM|dd|HH|mm|ss/g, (m, lit) => (lit !== undefined ? lit : ({ yyyy: p.year, MM: p.month, dd: p.day, HH: p.hour, mm: p.minute, ss: p.second }[m])));
      },
    },
    UrlFetchApp: { fetch: (url, opts = {}) => {
      calls.urlFetch++;
      if (url.startsWith('https://identitytoolkit.googleapis.com')) {
        const { idToken } = JSON.parse(opts.payload);
        if (!idToken.startsWith('tok-')) return resp(400, '{}');
        return resp(200, JSON.stringify({ users: [{ email: idToken.slice(4), emailVerified: true }] }));
      }
      if (url.endsWith(':commit')) {
        if (global.__commitFail) return resp(503, '{"error":{"message":"unavailable"}}');
        const body = JSON.parse(opts.payload);
        calls.commit.push(body);
        body.writes.forEach((w) => {
          if (w.update && w.update.name.includes('/documents/public/')) publicDocs.set(w.update.name.split('/documents/public/')[1], w.update.fields);
          if (w.update && w.update.name.includes('/documents/admins/')) admins.add(w.update.name.split('/documents/admins/')[1]);
          if (w.delete && w.delete.includes('/documents/admins/')) admins.delete(w.delete.split('/documents/admins/')[1]);
        });
        onFirestoreCommit(body);
        return resp(200, '{}');
      }
      if (url.endsWith(':runQuery')) {
        const q = JSON.parse(opts.payload).structuredQuery;
        // 成績同步：global.__attempts = [{ path, fields(一般物件), createdAt }]，依 createdAt、文件路徑排序後分頁
        if (q.from[0].collectionId === 'attempts' && q.where) {
          const since = q.where.fieldFilter.value.timestampValue;
          const enc = (v) => (typeof v === 'number' ? (Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v }) : typeof v === 'boolean' ? { booleanValue: v }
            : Array.isArray(v) ? { arrayValue: { values: v.map(enc) } } : v && typeof v === 'object' ? { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, enc(x)])) } } : { stringValue: String(v ?? '') });
          let list = (global.__attempts || []).map((a) => ({ name: `projects/x/databases/(default)/documents/${a.path}`, t: a.createdAt, a }))
            .filter((x) => x.t >= since).sort((x, y) => (x.t < y.t ? -1 : x.t > y.t ? 1 : x.name < y.name ? -1 : 1));
          if (q.startAt) { const [tv, nv] = q.startAt.values; list = list.filter((x) => x.t > tv.timestampValue || (x.t === tv.timestampValue && x.name > nv.referenceValue)); }
          list = list.slice(0, q.limit);
          return resp(200, JSON.stringify(list.map((x) => ({ document: { name: x.name, fields: { ...Object.fromEntries(Object.entries(x.a.fields).map(([k, v]) => [k, enc(v)])), createdAt: { timestampValue: x.t } } } }))));
        }
        if (q.startAt) return resp(200, '[]');
        const list = (global.__vault || []).map((r, i) => ({ document: { name: `projects/x/databases/(default)/documents/vault/k${i}`, fields: { cls: { stringValue: r.cls }, seat: { stringValue: r.seat }, name: { stringValue: r.name } } } }));
        return resp(200, JSON.stringify(list));
      }
      // 錯誤分析引擎（Hugging Face Space 的 Gradio API）：global.__space = (name, data) => 回傳的 JSON 字串（要模擬失敗就丟錯誤或回非 200）
      if (/^https:\/\/[a-z0-9.-]+\.hf\.space\/gradio_api\/call\//.test(url)) {
        const m = /\/gradio_api\/call\/([a-z]+)(?:\/([a-z0-9-]+))?$/.exec(url);
        if (global.__spaceDown) return resp(503, '{}');
        if (!m[2]) {
          const id = 'evt-' + (calls.space = (calls.space || 0) + 1);
          (global.__spaceEvents ||= {})[id] = global.__space(m[1], JSON.parse(opts.payload).data);
          return resp(200, JSON.stringify({ event_id: id }));
        }
        return resp(200, ['event: complete', 'data: ' + JSON.stringify([global.__spaceEvents[m[2]]]), '', ''].join(String.fromCharCode(10)));
      }
      if (url.startsWith('https://eng-3385e-default-rtdb')) {
        if (rtdb.down) return resp(404, '{"error":"not found"}');
        if ((opts.method || 'get') === 'get') return resp(200, JSON.stringify(rtdb.staff));
        rtdb.staff = JSON.parse(opts.payload); calls.rtdbPut = (calls.rtdbPut || 0) + 1;
        return resp(200, opts.payload);
      }
      if (/\/documents\/admins\?/.test(url)) return resp(200, JSON.stringify({ documents: [...admins].map((e) => ({ name: 'projects/x/databases/(default)/documents/admins/' + e })) }));
      if (url.includes('/documents/admins/')) return admins.has(decodeURIComponent(url.split('/documents/admins/')[1])) ? resp(200, '{"name":"x"}') : resp(404, '{}');
      if (url.includes('/documents/vault/') && (opts.method || 'get') === 'get') {
        // 學生帳本：rosterKeys 沒給＝每個人都在名單上；rosterKeys === 'down'＝Firestore 暫時出錯
        const k = url.split('/documents/vault/')[1].split(/[?/]/)[0];
        if (rosterKeys === 'down') return resp(503, '{}');
        return !rosterKeys || rosterKeys.has(k) ? resp(200, JSON.stringify({ name: 'x', fields: { cls: { stringValue: '306' } } })) : resp(404, '{}');
      }
      if (opts.method === 'patch' && url.includes('/documents/public/')) { calls.patch = (calls.patch || 0) + 1; return resp(200, '{}'); }
      if (url.includes('/documents/public/') && (opts.method || 'get') === 'get') {
        const id = decodeURIComponent(url.split('/documents/public/')[1].split('?')[0]);
        return publicDocs.has(id) ? resp(200, JSON.stringify({ name: id, fields: publicDocs.get(id) })) : resp(404, '{}');
      }
      if (opts.method === 'delete' && url.includes('/documents/public/')) publicDocs.delete(decodeURIComponent(url.split('/documents/public/')[1]));
      if (opts.method === 'delete') { calls.deleted = (calls.deleted || []).concat(url); return resp(200, '{}'); }
      return resp(500, '{"error":{"message":"unmocked ' + url + '"}}');
    } },
    HtmlService: {},
  };
  const ctx = vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(codePath, 'utf8'), ctx, { filename: 'Code.gs' });
  // 老師名單
  const t = ctx.sheet_(ctx.SHEET_TEACHERS, ['email', 'note']);
  teachers.forEach((e) => t.appendRow([e, '']));

  return {
    ctx, ss, sheets, calls, propMap, cacheMap, lock, publicDocs, admins, rtdb,
    setRoster(v) { rosterKeys = v; },
    post(body) { return JSON.parse(ctx.doPost({ postData: { contents: typeof body === 'string' ? body : JSON.stringify(body) } }).getContent()); },
    get(parameter) { return JSON.parse(ctx.doGet({ parameter }).getContent()); },
    // 學生交卷：自動附上帳本 key（跟網站一樣）；key: null 模擬舊版網頁沒附 key
    postScore(o) {
      const b = { ...o };
      if (b.key === undefined) b.key = keyOf(b.cls, b.seat, b.name);
      if (b.key === null) delete b.key;
      return this.post(b);
    },
    api(name, args, email = teachers[0]) { return this.post({ api: name, args, idToken: 'tok-' + email }); },
  };
}
