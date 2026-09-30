// 端對端測試的共用環境：本機網頁伺服器 + 假的 Firebase SDK + 真的 Code.gs（假試算表）+ 可調延遲的假 Apps Script。
// 需要 Playwright（本機或全域安裝皆可）。不會連到真的 Firebase / Google 服務。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createGas } from './gas-mock.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const require = createRequire(import.meta.url);
function loadPlaywright() {
  for (const p of ['playwright', '/opt/node22/lib/node_modules/playwright', '/tmp/node_modules/playwright']) {
    try { return require(p); } catch { /* try next */ }
  }
  throw new Error('找不到 playwright，請先安裝：npm i -g playwright');
}
export const { chromium } = loadPlaywright();

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

export async function startWorld({ scriptLatency = 1200, teachers = ['teacher@example.com'], rulesAllowStaffWrite = true } = {}) {
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    const file = path.join(ROOT, p);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(fs.readFileSync(file));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;

  const world = {
    base, docs: {}, pages: new Set(), teachers,
    scriptLatency, scriptFail: false, rulesAllowStaffWrite,
    log: [], directWrites: 0,
    onPublish: null,
  };
  const publish = (id, json, from) => {
    world.docs[id] = json;
    world.log.push({ t: Date.now(), from, id });
    world.pages.forEach((pg) => { pg.evaluate(([i, j]) => window.__fb && window.__fb.push('public/' + i, { json: j }), [id, json]).catch(() => {}); });
    if (world.onPublish) world.onPublish(id, json, from);
  };
  world.gas = createGas({
    teachers,
    onFirestoreCommit: (body) => body.writes.forEach((w) => publish(w.update.name.split('/public/')[1], w.update.fields.json.stringValue, 'server')),
  });

  const browser = await chromium.launch();
  world.browser = browser;
  world.newContext = async (opts = {}) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, ...opts });
    await routes(ctx, world);
    return ctx;
  };
  world.newPage = async (ctx, { student = false, staff = null } = {}) => {
    const page = await ctx.newPage();
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`console.error: ${m.text()}`); });
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('requestfailed', (r) => errors.push(`requestfailed: ${r.url()} ${r.failure() && r.failure().errorText}`));
    page.errors = errors;
    page.setDefaultTimeout(8000);
    await page.addInitScript(([st, sf]) => {
      window.__fb = window.__fb || {};
      if (sf) { window.__fb.staff = [sf]; window.__fb.popupEmail = sf; }
      if (st) localStorage.setItem('b5p:student', JSON.stringify({ cls: '306', seat: '20', name: '陳奕嘉', key: 'k' }));
    }, [student, staff]);
    world.pages.add(page);
    page.on('close', () => world.pages.delete(page));
    return page;
  };
  world.close = async () => { await browser.close(); server.close(); };
  return world;
}

async function routes(ctx, world) {
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
  await ctx.route('https://www.gstatic.com/firebasejs/10.13.2/*.js', (route) => {
    const name = route.request().url().split('/').pop();
    const f = path.join(ROOT, 'tools', 'e2e', 'stubs', name);
    if (!fs.existsSync(f)) return route.fulfill({ status: 404, body: '' });
    return route.fulfill({ status: 200, contentType: 'text/javascript', headers: cors, body: fs.readFileSync(f, 'utf8') });
  });
  await ctx.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/, (route) => route.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await ctx.route('https://firestore.googleapis.com/**', async (route) => {
    const req = route.request();
    const url = req.url();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const m = /\/documents\/public\/([^/?]+)$/.exec(url);
    if (req.method() === 'GET' && m) {
      const json = world.docs[m[1]];
      if (json === undefined) return route.fulfill({ status: 404, headers: cors, contentType: 'application/json', body: '{"error":{"status":"NOT_FOUND"}}' });
      return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify({ fields: { json: { stringValue: json } } }) });
    }
    if (req.method() === 'POST' && url.endsWith(':commit')) {
      // 模擬 Firestore 規則：登入的老師（admins 名單內）才能寫 public
      const auth = req.headers().authorization || '';
      const email = auth.startsWith('Bearer tok-') ? auth.slice(11) : '';
      await new Promise((r) => setTimeout(r, 120)); // 網路來回
      if (!world.rulesAllowStaffWrite || !world.teachers.includes(email)) {
        return route.fulfill({ status: 403, headers: cors, contentType: 'application/json', body: '{"error":{"code":403,"status":"PERMISSION_DENIED"}}' });
      }
      world.directWrites++;
      JSON.parse(req.postData()).writes.forEach((w) => {
        const json = w.update.fields.json.stringValue;
        if (json.length >= 900000) throw new Error('rules: too large');
        world.log.push({ t: Date.now(), from: 'teacher-browser', id: w.update.name.split('/public/')[1] });
        world.docs[w.update.name.split('/public/')[1]] = json;
        world.pages.forEach((pg) => { pg.evaluate(([i, j]) => window.__fb && window.__fb.push('public/' + i, { json: j }), [w.update.name.split('/public/')[1], json]).catch(() => {}); });
        if (world.onPublish) world.onPublish(w.update.name.split('/public/')[1], json, 'teacher-browser');
      });
      return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: '{"writeResults":[{}],"commitTime":"2026-01-01T00:00:00Z"}' });
    }
    return route.fulfill({ status: 404, headers: cors, body: '{}' });
  });
  await ctx.route(/https:\/\/script\.google\.com\/macros\/.*/, async (route) => {
    const req = route.request();
    await new Promise((r) => setTimeout(r, world.scriptLatency));
    if (world.scriptFail && req.method() === 'POST' && /"api":"(saveAllSettings|saveContent|saveExtensions|deleteContent)"/.test(req.postData() || '')) {
      return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify({ ok: false, error: '（測試）試算表暫時無法寫入' }) });
    }
    let out;
    if (req.method() === 'POST') out = world.gas.post(req.postData() || '{}');
    else out = world.gas.get(Object.fromEntries(new URL(req.url()).searchParams));
    return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify(out) });
  });
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
