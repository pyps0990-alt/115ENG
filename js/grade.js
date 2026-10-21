// 伺服器計分（Cloud Function functions/index.js 用；網站與伺服器共用同一套判斷，不會判得不一樣）。
// 學生送來的是「每題考什麼、作答內容」，這裡依老師的題庫重新判斷對錯、重算分數；學生送來的分數、對錯一律不採用。
// 不能依靠瀏覽器：這個檔案和它用到的模組只能用純 JavaScript（沒有 window、document、localStorage）。
import { clozeParts, lettersOf } from './util.js';
import { levelsFor, quizCount, stageSizes, PER_TEST, hintDeduction } from './levels.js';
import { flattenPattern, correctText, judge, applyScore } from './components/items.js';
import { unitCfg, questionCount } from './remote-config.js';

const KEYS = ['A', 'B', 'C', 'D', 'E'];
const round2 = (n) => Math.round(n * 100) / 100;
const round3 = (n) => Math.round(n * 1000) / 1000;
// 題庫改過（例如老師修正錯字）造成少數幾題對不上時，這幾題暫時採用學生端的判斷，並標記給老師；太多題對不上就不採用
const MAX_UNKNOWN_TRUSTED = 3;

const exampleList = (w) => (Array.isArray(w.examples) && w.examples.length ? w.examples : [{ ex: w.example || '', zh: w.exampleZh || '' }]).filter((e) => e.ex);
// 例句題考的那一句：明細裡的 exampleEn 是「前半[答案]後半」，找出是這個字的哪一句，回傳那句空格的正確答案
function clozeAnswer(w, exampleEn) {
  for (const e of exampleList(w)) {
    const c = clozeParts({ ...w, example: e.ex });
    if (c && `${c.before}[${c.answer}]${c.after}` === exampleEn) return c.answer;
  }
  return null;
}

// 單字測驗的一題：依題型和題庫判斷學生的作答對不對；題庫裡找不到對應的題目回傳 null
function vocabOk(d, w) {
  const yours = String(d.yours || '');
  switch (d.kind) {
    case '英→中': return yours === w.zh;
    case '中→英': return yours === w.word;
    case '拼字': return !!yours && lettersOf(yours) === lettersOf(w.word);
    case '例句選字': { const a = clozeAnswer(w, d.exampleEn); return a == null ? null : yours === a; }
    case '例句拼寫': { const a = clozeAnswer(w, d.exampleEn); return a == null ? null : !!yours && lettersOf(yours) === lettersOf(a); }
    default: return null;
  }
}
const vocabCorrect = (d, w) => {
  if (d.kind === '英→中') return w.zh;
  if (d.kind === '中→英' || d.kind === '拼字') return w.word;
  return clozeAnswer(w, d.exampleEn) || String(d.correct || '');
};

function gradeVocab(sub, data, cfg, flags) {
  const words = Array.isArray(data.words) ? data.words : [];
  const byWord = new Map(words.map((w) => [w.word, w]));
  const levels = levelsFor(cfg);
  const perTest = Math.min(words.length, quizCount(cfg) || PER_TEST);
  const sizes = stageSizes(perTest, levels.length || 1);
  const details = (Array.isArray(sub.details) ? sub.details : []).slice(0, 150).map((d) => ({ ...d }));
  // 段落：依這個單元的出題設定；學生作答途中老師改了設定（段落名稱對不上）就依明細裡的段落
  let names = levels.map((l) => l.name);
  let expect = sizes;
  const seenStages = [...new Set(details.map((d) => String(d.stage || '')))];
  if (!seenStages.every((s) => names.includes(s))) {
    flags.push('出題設定和作答時不同，依作答時的段落計分');
    names = seenStages;
    expect = names.map((s) => details.filter((d) => d.stage === s).length);
  }
  const max = 100 / (names.length || 1);
  const used = new Set();
  let unknown = 0, missing = 0, dup = 0;
  const stageSum = names.map(() => 0);
  const stageCount = names.map(() => 0);
  details.forEach((d) => {
    const si = names.indexOf(String(d.stage || ''));
    const w = byWord.get(String(d.word || ''));
    let ok = null;
    if (si < 0) ok = false;
    else if (used.has(`${si}|${d.word}`) || used.has(String(d.word))) { ok = false; dup++; }
    else if (w) { ok = vocabOk(d, w); if (ok != null) d.correct = vocabCorrect(d, w); }
    used.add(String(d.word));
    if (ok == null) { unknown++; ok = unknown <= MAX_UNKNOWN_TRUSTED ? !!d.ok : false; }
    d.ok = ok;
    if (si < 0) { d.points = 0; return; }
    stageCount[si]++;
    const per = max / (expect[si] || 1);
    const hints = Math.max(0, Math.min(2, Math.floor(Number(d.hints) || 0)));
    d.hints = hints;
    const got = ok ? Math.max(0, per - hintDeduction(hints)) : 0;
    d.points = round3(got);
    stageSum[si] += got;
  });
  names.forEach((_, i) => { if (stageCount[i] < expect[i]) missing += expect[i] - stageCount[i]; });
  if (unknown) flags.push(`有 ${unknown} 題在題庫找不到（題庫可能改過）${unknown <= MAX_UNKNOWN_TRUSTED ? '，暫依作答時的判斷' : '，以答錯計'}`);
  if (missing) flags.push(`少了 ${missing} 題作答紀錄，以答錯計`);
  if (dup) flags.push(`有 ${dup} 題重複作答，不計分`);
  const total = stageSum.reduce((a, b) => a + b, 0);
  const ids = levels.map((l) => l.id);
  const per = {};
  names.forEach((n, i) => { per[ids[levels.findIndex((l) => l.name === n)] || ['basic', 'advanced', 'mastery'][i] || `s${i}`] = `${Math.round(stageSum[i])}/${Math.round(max)}`; });
  return {
    details, score: round2(total), total: 100, pct: Math.round(total),
    basic: per.basic || '', advanced: per.advanced || '', mastery: per.mastery || '',
    wrong: [...new Set(details.filter((d) => !d.ok).map((d) => String(d.word || '')))].filter(Boolean),
  };
}

function gradeReading(sub, data, flags) {
  const qs = Array.isArray(data.questions) ? data.questions : [];
  const got = new Map();
  (Array.isArray(sub.details) ? sub.details : []).forEach((d) => { const n = Math.floor(Number(d.n)); if (n >= 1 && n <= qs.length && !got.has(n)) got.set(n, d); });
  if (got.size < qs.length) flags.push(`少了 ${qs.length - got.size} 題作答紀錄，以答錯計`);
  let score = 0;
  const details = qs.map((q, i) => {
    const d = got.get(i + 1) || {};
    const correct = `${KEYS[q.answer]}. ${q.options[q.answer]}`;
    const yours = String(d.yours || '');
    const ok = yours === correct;
    if (ok) score++;
    return { stage: '課文理解', n: i + 1, kind: q.skill || '', q: q.q || '', word: `Q${i + 1} ${String(q.q || '').slice(0, 50)}`, correct, yours, ok, points: ok ? 1 : 0, hints: 0 };
  });
  return {
    details, score, total: qs.length, pct: qs.length ? Math.round((score / qs.length) * 100) : 0,
    wrong: details.filter((d) => !d.ok).map((d) => `Q${d.n}`),
  };
}

function gradePattern(sub, data, config, unit, flags) {
  const all = flattenPattern(data.items);
  const byId = new Map(all.map((q) => [q.id, q]));
  const n = Math.min(questionCount(config, unit), all.length);
  const used = new Set();
  let unknown = 0, dup = 0, points = 0;
  const details = (Array.isArray(sub.details) ? sub.details : []).slice(0, 150).map((d0) => {
    const d = { ...d0 };
    const q = byId.get(String(d.word || ''));
    if (!q) { unknown++; d.ok = false; d.points = 0; return d; }
    if (used.has(q.id)) { dup++; d.ok = false; d.points = 0; return d; }
    used.add(q.id);
    const yours = String(d.yours || '');
    const got = q.kind === 'apply' ? applyScore(q, yours) : (judge(q, yours) ? 1 : 0);
    d.ok = got === 1; d.points = got; d.correct = correctText(q);
    points += got;
    return d;
  });
  if (unknown) flags.push(`有 ${unknown} 題在題庫找不到（題庫可能改過），以答錯計`);
  if (dup) flags.push(`有 ${dup} 題重複作答，不計分`);
  if (sub.flow === 'learn') {
    // 循序漸進版：每個句型一段、每段抽 2～3 題，各句型平均配分，總分 100；沒作答到的句型算 0 分
    const tags = [...new Set(all.map((q) => q.tag).filter(Boolean))];
    const per = new Map(tags.map((t) => [t, { got: 0, n: 0 }]));
    details.forEach((d) => { const q = byId.get(String(d.word || '')); const t = q && per.get(q.tag); if (t && used.has(q.id)) { t.n++; t.got += Number(d.points) || 0; } });
    const missing = tags.filter((t) => !per.get(t).n).length;
    if (missing) flags.push(`少了 ${missing} 個句型的作答紀錄，以 0 分計`);
    const pct = tags.length ? tags.reduce((m, t) => { const x = per.get(t); return m + (x.n ? x.got / x.n : 0); }, 0) / tags.length * 100 : 0;
    return { details, score: round2(pct), total: 100, pct: Math.round(pct), wrong: details.filter((d) => !d.ok).map((d) => String(d.word || '')) };
  }
  if (used.size < n) flags.push(`少了 ${n - used.size} 題作答紀錄，以答錯計`);
  points = round2(points);
  return {
    details, score: points, total: n, pct: n ? Math.round((points / n) * 100) : 0,
    wrong: details.filter((d) => !d.ok).map((d) => String(d.word || '')),
  };
}

// sub：學生送來的成績；data：這個單元的題庫（public/content_<單元> 的 data）；config：網站設定（public/config）
// 回傳 { details, score, total, pct, wrong, basic?, advanced?, mastery?, flags: [給老師看的說明] }；題庫和題型對不上時回傳 null
export function gradeSubmission(sub, data, config) {
  const flags = [];
  const unit = String(sub.unit || '');
  const cfg = unitCfg(config, unit);
  let out = null;
  if (sub.mode === 'vocab' && Array.isArray(data.words)) out = gradeVocab(sub, data, cfg, flags);
  else if (sub.mode === 'reading' && Array.isArray(data.questions)) out = gradeReading(sub, data, flags);
  else if (sub.mode === 'pattern' && Array.isArray(data.items)) out = gradePattern(sub, data, config, unit, flags);
  if (!out) return null;
  const claimed = Number(sub.pct);
  if (sub.pct != null && sub.pct !== '' && Number.isFinite(claimed) && Math.abs(claimed - out.pct) >= 1) flags.unshift(`分數以伺服器重算為準（學生端送來 ${claimed}%）`);
  return { ...out, flags };
}
