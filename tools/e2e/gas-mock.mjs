// 在 Node 裡執行真正的 apps-script/Code.gs（用假的試算表、快取、UrlFetchApp），測試後台的儲存邏輯。
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');

export function createGas({ teachers = ['teacher@example.com'], onFirestoreCommit = () => {}, codePath = path.join(ROOT, 'apps-script', 'Code.gs') } = {}) {
  const sheets = new Map();
  const calls = { commit: [], sheetReads: 0, urlFetch: 0 };

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
  }
  const ss = {
    getSheetByName: (n) => sheets.get(n) || null,
    insertSheet: (n) => { const s = new Sheet(n); sheets.set(n, s); return s; },
    getSheets: () => [...sheets.values()],
    deleteSheet: (s) => sheets.delete(s.name),
    getUrl: () => 'https://docs.google.com/spreadsheets/d/test',
    getName: () => 'test',
  };

  const cacheMap = new Map();
  const propMap = new Map();
  const resp = (code, text) => ({ getResponseCode: () => code, getContentText: () => text });
  const sandbox = {
    console, Date, JSON, Math, String, Number, Array, Object, RegExp, Error, isNaN, parseInt, parseFloat, encodeURIComponent, decodeURIComponent,
    Logger: { log: () => {} },
    SpreadsheetApp: { getActiveSpreadsheet: () => ss, getUi: () => ({}) },
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
    LockService: { getScriptLock: () => ({ waitLock() {}, tryLock: () => true, releaseLock() {} }) },
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
        const body = JSON.parse(opts.payload);
        calls.commit.push(body);
        onFirestoreCommit(body);
        return resp(200, '{}');
      }
      if (url.includes('/documents/admins/')) return resp(404, '{}');
      if (opts.method === 'patch' && url.includes('/documents/public/')) { calls.patch = (calls.patch || 0) + 1; return resp(200, '{}'); }
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
    ctx, ss, sheets, calls, propMap, cacheMap,
    post(body) { return JSON.parse(ctx.doPost({ postData: { contents: typeof body === 'string' ? body : JSON.stringify(body) } }).getContent()); },
    get(parameter) { return JSON.parse(ctx.doGet({ parameter }).getContent()); },
    api(name, args, email = teachers[0]) { return this.post({ api: name, args, idToken: 'tok-' + email }); },
  };
}
