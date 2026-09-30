// 列出 js/app.js 啟動時會載入的所有模組（靜態 import），用來維護 index.html 的 modulepreload 清單。
// 用法：node tools/module-graph.mjs          → 印出清單
//       node tools/module-graph.mjs --check  → 清單和 index.html 不一致時結束碼為 1
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const seen = [];
function walk(rel) {
  if (seen.includes(rel)) return;
  seen.push(rel);
  const src = fs.readFileSync(path.join(root, rel), 'utf8');
  for (const m of src.matchAll(/^\s*(?:import|export)\s[^'"]*?from\s+['"](\.[^'"]+)['"]/gm)) {
    walk(path.posix.normalize(path.posix.join(path.posix.dirname(rel), m[1])));
  }
  for (const m of src.matchAll(/^\s*import\s+['"](\.[^'"]+)['"]/gm)) {
    walk(path.posix.normalize(path.posix.join(path.posix.dirname(rel), m[1])));
  }
}
walk('js/app.js');
if (process.argv.includes('--check')) {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const listed = [...html.matchAll(/<link rel="modulepreload" href="([^"]+)"/g)].map((m) => m[1]);
  const missing = seen.filter((x) => !listed.includes(x));
  const extra = listed.filter((x) => !seen.includes(x));
  if (missing.length || extra.length) {
    console.error('index.html 的 modulepreload 清單需要更新：', { 缺少: missing, 多餘: extra });
    process.exit(1);
  }
  console.log('modulepreload 清單正確（' + seen.length + ' 個模組）');
} else {
  console.log(seen.map((x) => `  <link rel="modulepreload" href="${x}">`).join('\n'));
}
