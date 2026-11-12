// WebKit（和 Safari 同一個排版引擎）跑 B5：用 Ubuntu 的 WebKitGTK MiniBrowser + WebKitWebDriver，接同一套假後端（harness.mjs 的 routes）。
// 需要：sudo apt-get install -y webkit2gtk-driver xvfb；執行：xvfb-run -a node tools/e2e/webkit-flow.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createGas, keyOf } from './gas-mock.mjs';
import { routes } from './harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const glob = (s) => new RegExp('^' + s.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\u0000/g, '.*') + '$');

const INJECT = (seed) => `
<script type="importmap">{"imports":{
 "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js":"/tools/e2e/stubs/firebase-app.js",
 "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js":"/tools/e2e/stubs/firebase-firestore.js",
 "https://www.gstatic.com/firebasejs/10.13.2/firebase-app-check.js":"/tools/e2e/stubs/firebase-app-check.js",
 "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js":"/tools/e2e/stubs/firebase-auth.js",
 "https://www.gstatic.com/firebasejs/10.13.2/firebase-database.js":"/tools/e2e/stubs/firebase-database.js"}}</script>
<script>(function(){
 window.__errs=[];addEventListener('error',function(e){__errs.push(String(e.message)+' @'+(e.filename||'')+':'+(e.lineno||''));});
 addEventListener('unhandledrejection',function(e){var r=e.reason;__errs.push('rej '+String(r&&r.stack||r));});
 var H=/^https:\\/\\/(firestore\\.googleapis\\.com|[^/]*cloudfunctions\\.net|script\\.google\\.com|fonts\\.(googleapis|gstatic)\\.com)\\//;
 var of=window.fetch;
 window.fetch=function(input,init){init=init||{};var url=typeof input==='string'?input:(input&&input.url)||String(input);
  if(!H.test(url))return of.call(window,input,init);
  var headers={};new Headers(init.headers||{}).forEach(function(v,k){headers[k]=v;});
  return of('/__mock',{method:'POST',body:JSON.stringify({url:url,method:(init.method||'GET').toUpperCase(),headers:headers,body:typeof init.body==='string'?init.body:null}),signal:init.signal})
   .then(function(r){if(r.status===599)throw new TypeError('Failed to fetch');return r;});};
 window.__fb=window.__fb||{};
 ${seed ? `if(!localStorage.getItem('b5p:student'))localStorage.setItem('b5p:student',${JSON.stringify(JSON.stringify(seed))});sessionStorage.setItem('b5p:who-ok','1');` : ''}
})();</script>`;

export async function startWorld({ scriptLatency = 60 } = {}) {
  const world = { docs: {}, pages: new Set(), teachers: ['teacher@example.com'], scriptLatency, rulesAllowStaffWrite: true, log: [], directWrites: 0 };
  const publish = (id, json) => { world.docs[id] = json; };
  world.gas = createGas({ teachers: world.teachers, onFirestoreCommit: (body) => body.writes.forEach((w) => publish(w.update.name.split('/public/')[1], w.update.fields.json.stringValue)) });
  const table = [];
  await routes({ route: async (pat, fn) => { table.push([pat instanceof RegExp ? pat : glob(pat), fn]); } }, world);
  const seed = { cls: '306', seat: '20', name: '陳奕嘉', key: keyOf('306', '20', '陳奕嘉') };
  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/__mock') {
      let raw = ''; for await (const c of req) raw += c;
      const d = JSON.parse(raw);
      const hit = table.find(([re]) => re.test(d.url));
      const r = {
        request: () => ({ url: () => d.url, method: () => d.method, headers: () => d.headers, postData: () => d.body }),
        fulfill: ({ status = 200, headers = {}, contentType, body = '' }) => { res.writeHead(status, { ...headers, ...(contentType ? { 'content-type': contentType } : {}) }); res.end(body); },
        abort: () => { res.writeHead(599); res.end(); },
      };
      if (!hit) return r.fulfill({ status: 404 });
      try { await hit[1](r); } catch (e) { console.error('mock err', e); r.fulfill({ status: 500 }); }
      return;
    }
    let p = decodeURIComponent(u.pathname); if (p.endsWith('/')) p += 'index.html';
    const file = path.join(ROOT, p);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
    let body = fs.readFileSync(file);
    if (p === '/index.html') body = String(body).replace('<head>', '<head>' + INJECT(u.searchParams.has('nologin') ? null : seed));
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(body);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  world.base = `http://127.0.0.1:${server.address().port}`;
  world.close = () => server.close();
  return world;
}

// ---- 精簡 W3C WebDriver 用戶端 ----
export async function startBrowser({ width = 390, height = 844 } = {}) {
  const port = 4444 + Math.floor(Math.random() * 500);
  const drv = spawn('WebKitWebDriver', [`--port=${port}`], { stdio: 'ignore' });
  const B = `http://127.0.0.1:${port}`;
  const call = async (method, p, body) => {
    const r = await fetch(B + p, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json(); if (j.value && j.value.error) throw new Error(j.value.error + ': ' + j.value.message);
    return j.value;
  };
  for (let i = 0; i < 50; i++) { try { await fetch(B + '/status'); break; } catch { await sleep(100); } }
  const s = await call('POST', '/session', { capabilities: { alwaysMatch: { 'webkitgtk:browserOptions': { binary: '/usr/lib/x86_64-linux-gnu/webkit2gtk-4.1/MiniBrowser', args: ['--automation'] } } } });
  const S = `/session/${s.sessionId}`;
  const b = {
    caps: s.capabilities,
    async size(w, h) { await call('POST', S + '/window/rect', { width: w, height: h }); },
    go: (url) => call('POST', S + '/url', { url }),
    js: (fn, ...args) => call('POST', S + '/execute/sync', { script: `return (${fn}).apply(null, arguments)`, args }),
    jsAsync: (fn, ...args) => call('POST', S + '/execute/async', { script: `var done=arguments[arguments.length-1]; Promise.resolve((${fn}).apply(null, Array.prototype.slice.call(arguments,0,-1))).then(done, function(e){done('ERR '+e)})`, args }),
    async $(css) { try {  return (await call('POST', S + '/element', { using: 'css selector', value: css }))['element-6066-11e4-a52e-4f735466cecf']; } catch { return null; } },
    async click(css) { const id = await b.$(css); if (!id) throw new Error('no element ' + css); await call('POST', `${S}/element/${id}/click`, {}); },
    async type(css, text) { const id = await b.$(css); await call('POST', `${S}/element/${id}/value`, { text }); },
    async clickAt(x, y) {
      await call('POST', S + '/actions', { actions: [{ type: 'pointer', id: 'm', parameters: { pointerType: 'mouse' }, actions: [{ type: 'pointerMove', x: Math.round(x), y: Math.round(y), duration: 0 }, { type: 'pointerDown', button: 0 }, { type: 'pointerUp', button: 0 }] }] });
    },
    async wheel(dy, x = 195, y = 400) { await call('POST', S + '/actions', { actions: [{ type: 'wheel', id: 'w', actions: [{ type: 'scroll', x, y, deltaX: 0, deltaY: dy, duration: 100 }] }] }); },
    async wait(fn, timeout = 8000, ...args) { const t = Date.now(); for (;;) { const v = await b.js(fn, ...args); if (v) return v; if (Date.now() - t > timeout) throw new Error('timeout: ' + String(fn).slice(0, 80)); await sleep(60); } },
    async shot(file) { const d = await call('GET', S + '/screenshot'); fs.writeFileSync(file, Buffer.from(d, 'base64')); },
    async quit() { try { await call('DELETE', S); } catch { /* */ } drv.kill(); },
  };
  await b.size(width, height);
  return b;
}
