// 部署 Cloud Functions 前：把網站的 js/ 複製到 functions/site/，伺服器計分（functions/index.js）直接用網站同一套判斷程式
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dst = path.join(root, 'functions', 'site');
fs.rmSync(dst, { recursive: true, force: true });
fs.cpSync(path.join(root, 'js'), dst, { recursive: true });
console.log('已複製 js/ → functions/site/');
