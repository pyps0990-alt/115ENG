#!/usr/bin/env node
// 部署前自動執行（firebase.json 的 predeploy）：依所有會上線的網站檔案內容算出版本碼，寫進 version.json。
// 網頁用它判斷「有沒有部署過新版」。內容沒變，版本碼就不變。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILES = ['index.html', 'admin.html', 'robots.txt', 'favicon-32.png', 'icon-180.png', 'icon.png'];
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
fs.writeFileSync(path.join(ROOT, 'version.json'), JSON.stringify({ v, t: new Date().toISOString() }) + '\n');
console.log('version.json →', v, `(${list.length} 個檔案)`);
