// 解析裡標出「錯在哪裡」：把學生的答案和最接近的正確寫法對齊（最長共同子序列），
// 答案裡多出來或排錯位置的字用 <mark class="bit-wrong">（紅底＋刪除線），正確答案裡漏掉的字用 <mark class="bit-miss">（綠底＋底線）標出。
// 不只靠顏色：刪除線與底線形狀也不同。只標示，不計分（計分在 items.js 的 applyScore）。
import { esc } from '../util.js';

const squash = (s) => String(s == null ? '' : s).toLowerCase().replace(/[‘’]/g, "'").replace(/[^a-z0-9']/g, '');

// 回傳兩邊各自「有對上」的位置（Set）
function lcsMatch(a, b) {
  const dp = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
  }
  const ma = new Set(); const mb = new Set();
  let i = a.length; let j = b.length;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) { ma.add(i - 1); mb.add(j - 1); i--; j--; }
    else if (dp[i - 1][j] >= dp[i][j - 1]) i--;
    else j--;
  }
  return { ma, mb, len: dp[a.length][b.length] };
}

// 把字串切成要比的單位：單字模式以空白分詞，拼字模式逐字母（保留原本的樣子顯示）
const pieces = (s, letters) => (letters ? [...String(s)].filter((c) => /\S/.test(c)) : String(s).trim().split(/\s+/).filter(Boolean));
const keyOf = (p, letters) => (letters ? p.toLowerCase() : squash(p));

const wrap = (parts, bad, cls, letters) => parts.map((p, i) => (bad.has(i) ? `<mark class="${cls}">${esc(p)}</mark>` : esc(p))).join(letters ? '' : ' ');

// yours：學生的答案；alts：可接受的正確寫法（可能有好幾種）
// 回傳 { yoursHTML, correctHTML, exact }；correctHTML 最多列 4 種寫法，最接近的那一種有標示漏掉的字
export function diffAnswer(yours, alts) {
  const list = (alts || []).map((a) => String(a)).filter((a) => a.trim());
  const y = String(yours == null ? '' : yours).trim();
  if (!list.length) return { yoursHTML: esc(y), correctHTML: '', exact: false };
  const letters = !/\s/.test(y) && list.every((a) => !/\s/.test(a.trim()));
  const ys = pieces(y, letters);
  let best = null;
  list.forEach((alt, idx) => {
    const as = pieces(alt, letters);
    const m = lcsMatch(ys.map((p) => keyOf(p, letters)), as.map((p) => keyOf(p, letters)));
    const score = as.length || ys.length ? m.len / Math.max(as.length, ys.length) : 0;
    if (!best || score > best.score) best = { alt, as, m, score, idx };
  });
  const bad = new Set(ys.map((_, i) => i).filter((i) => !best.m.ma.has(i)));
  const miss = new Set(best.as.map((_, i) => i).filter((i) => !best.m.mb.has(i)));
  const others = list.filter((_, i) => i !== best.idx).slice(0, 3).map(esc);
  return {
    yoursHTML: ys.length ? wrap(ys, bad, 'bit-wrong', letters) : '',
    correctHTML: [wrap(best.as, miss, 'bit-miss', letters), ...others].join(' / '),
    exact: !bad.size && !miss.size,
  };
}
