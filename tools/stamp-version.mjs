#!/usr/bin/env node
// 部署前自動執行（firebase.json 的 predeploy）：依所有會上線的網站檔案內容算出版本碼，寫進 version.json。
// 網頁用它判斷「有沒有部署過新版」。內容沒變，版本碼就不變。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILES = ['VERSION', 'index.html', 'admin.html', 'robots.txt', 'favicon-32.png', 'icon-180.png', 'icon.png', 'manifest.webmanifest', 'admin.webmanifest', 'admin-icon.png', 'admin-icon-180.png', 'admin-favicon-32.png'];
const DIRS = ['css', 'js', 'fonts', 'data'];

const list = [...FILES];
const walk = (d) => fs.readdirSync(path.join(ROOT, d), { withFileTypes: true }).forEach((e) => {
  const rel = `${d}/${e.name}`;
  if (e.isDirectory()) walk(rel); else list.push(rel);
});
DIRS.forEach(walk);

const h = crypto.createHash('sha1');
list.filter((f) => fs.existsSync(path.join(ROOT, f))).sort().forEach((f) => { h.update(f); h.update(fs.readFileSync(path.join(ROOT, f))); });
const v = h.digest('hex').slice(0, 12);
// 給人看的版本號 vX.Y.Z：X.Y 寫在專案根目錄的 VERSION（大改版時手動改），Z 是 GitHub Actions 的部署次數（每次部署自動加 1）
// 在自己電腦部署（沒有部署次數）時是 X.Y.0-dev。網站判斷有沒有新版仍然用上面的 v（依檔案內容算），兩者互不影響
let base = '1.0';
try { base = fs.readFileSync(path.join(ROOT, 'VERSION'), 'utf8').trim() || base; } catch { /* 沒有檔案就用 1.0 */ }
const run = process.env.GITHUB_RUN_NUMBER;
const n = run ? `${base}.${run}` : `${base}.0-dev`;
fs.writeFileSync(path.join(ROOT, 'version.json'), JSON.stringify({ v, n, t: new Date().toISOString() }) + '\n');
console.log('version.json →', `v${n}`, v, `(${list.length} 個檔案)`);
