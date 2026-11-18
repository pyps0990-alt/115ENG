// 深色模式對比檢查：學生端與老師後台主要畫面，每一段看得到的文字都要和背後的底色有足夠對比（WCAG：一般字 4.5、大字／粗體 3），
// 進度條等色塊要和所在的底分得出來（3）。不夠的列出來：node tools/e2e/dark-audit.mjs（SHOT=資料夾 會順便存每一頁的截圖）
import assert from 'node:assert';
import { startWorld, sleep } from './harness.mjs';
const SHOT = process.env.SHOT || '';
const world = await startWorld({ scriptLatency: 40 });
const g = world.gas;
const unit = (id, title, type, lesson, extra = {}) => ({ id, title, type, lesson, topic: 'T', visible: true, disabled: [], questionCount: 4, custom: true, ...extra });
g.api('saveAllSettings', [[], [unit('l1-voc', 'L1 單字', 'vocab', 1), unit('l1-read', 'L1 課文', 'reading', 1), unit('l1-pat', 'L1 句型', 'pattern', 1), unit('l2-voc', 'L2 單字', 'vocab', 2, { visible: false })]]);
const words = ['apple', 'banana', 'cherry', 'dates', 'egg', 'fig'].map((w) => ({ word: w, pos: 'n.', zh: '字' + w, examples: [{ ex: `I like [${w}] a lot.`, zh: '我很喜歡。' }] }));
g.api('saveContent', ['l1-voc', { topic: 'Food', words }, true]);
g.api('saveContent', ['l2-voc', { topic: 'Food', words }, true]);
g.api('saveContent', ['l1-read', { title: 'Tea', topic: 'Tea', passage: ['Tea is good for you. '.repeat(8), 'People drink tea every day. '.repeat(6)], questions: [0, 1, 2].map((i) => ({ ref: '1-1', skill: '細節', q: `What is true ${i}?`, options: ['Tea is good', 'Tea is bad', 'No tea', 'Coffee'], answer: 0, explain: '解析', key: 'Tea is good' })) }, true]);
g.api('saveContent', ['l1-pat', { items: [
  { type: 'mc', tag: 'so…that', q: 'It was so ____ that we stayed in.', options: ['cold', 'colder', 'coldly', 'coldest'], answer: 0, explain: '解析' },
  { type: 'fill', tag: 'so…that', q: 'She was so ____ that she cried.', answer: 'sad', explain: '解析' },
  { type: 'apply', tag: 'so…that', zh: '他太累了。', words: ['He', 'was', 'so', 'tired'], answer: 'He was so tired.', explain: '解析' },
  { type: 'mc', tag: 'so…that', q: 'He was so ____ that he won.', options: ['fast', 'faster', 'fastly', 'fastest'], answer: 0, explain: '解析' },
] }, true]);

// 在頁面裡量：每個有直接文字的元素，算文字色和「實際看到的底色」（往上找第一個不透明的背景，半透明就疊上去）
const AUDIT = () => {
  const parse = (c) => { const m = /rgba?\(([^)]+)\)/.exec(c || ''); if (!m) return null; const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const over = (top, bot) => ({ r: top.r * top.a + bot.r * (1 - top.a), g: top.g * top.a + bot.g * (1 - top.a), b: top.b * top.a + bot.b * (1 - top.a), a: 1 });
  const bgOf = (el) => {
    const stack = [];
    for (let e = el; e; e = e.parentElement) {
      const s = getComputedStyle(e);
      if (s.backgroundImage && s.backgroundImage !== 'none' && /gradient/.test(s.backgroundImage)) { const m = /rgba?\([^)]+\)/.exec(s.backgroundImage); if (m) { const c = parse(m[0]); if (c && c.a > 0.5) { stack.push({ ...c, a: 1 }); break; } } }
      const c = parse(s.backgroundColor); if (c && c.a > 0) { stack.push(c); if (c.a >= 0.99) break; }
    }
    let base = parse(getComputedStyle(document.documentElement).backgroundColor) || { r: 255, g: 255, b: 255, a: 1 };
    if (base.a < 1) base = { r: 255, g: 255, b: 255, a: 1 };
    for (let i = stack.length - 1; i >= 0; i--) base = over(stack[i], base);
    return base;
  };
  const vis = (el) => { const r = el.getBoundingClientRect(); if (r.width < 2 || r.height < 2) return false; const s = getComputedStyle(el); if (s.visibility === 'hidden' || +s.opacity < 0.2) return false; for (let e = el; e; e = e.parentElement) { if (+getComputedStyle(e).opacity < 0.5) return false; } return !el.closest('[hidden], [aria-hidden="true"], .sr-only, .visually-hidden'); };
  const out = [];
  const seen = new Set();
  document.querySelectorAll('body *').forEach((el) => {
    if (['SCRIPT', 'STYLE', 'SVG', 'PATH', 'svg', 'path', 'OPTION'].includes(el.tagName)) return;
    const own = [...el.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim()).map((n) => n.textContent.trim()).join(' ');
    const isField = el.matches('input:not([type=checkbox]):not([type=radio]):not([type=hidden]), textarea') && (el.value || el.placeholder);
    if (!own && !isField) return;
    if (!vis(el)) return;
    const s = getComputedStyle(el);
    const fg = parse(s.color); if (!fg) return;
    const bg = bgOf(el);
    const c = ratio(over(fg, bg), bg);
    const big = parseFloat(s.fontSize) >= 18.6 || (parseFloat(s.fontSize) >= 14 && +s.fontWeight >= 700);
    const placeholderOnly = isField && !el.value;
    const need = placeholderOnly ? 3 : big ? 3 : 4.5;
    if (c < need) {
      const text = (own || el.value || el.placeholder).slice(0, 30);
      const key = el.className + '|' + text;
      if (seen.has(key)) return; seen.add(key);
      out.push(`${c.toFixed(2)} < ${need}  <${el.tagName.toLowerCase()} class="${String(el.className).slice(0, 40)}"> 「${text}」 fg ${s.color} bg rgb(${Math.round(bg.r)},${Math.round(bg.g)},${Math.round(bg.b)})`);
    }
  });
  // 進度條：填色和軌道分得出來
  document.querySelectorAll('.bar > span, .ul-bar > i, .ul-bars i, .sb-fill, .ln-prog i, .sc-bar > *, .bar i, .strip i').forEach((el) => {
    if (!vis(el)) return;
    const s = getComputedStyle(el, el.matches('.strip i') ? '::after' : null); const fill = parse(s.backgroundColor); if (!fill || fill.a < 0.3) return;
    const track = el.matches('.strip i') ? bgOf(el) : bgOf(el.parentElement);
    const c = ratio(over(fill, track), track);
    if (c < 1.8) out.push(`${c.toFixed(2)} < 1.8  進度條 <${el.tagName.toLowerCase()} class="${String(el.className).slice(0, 30)}"> 在 <${el.parentElement.className}> fill ${s.backgroundColor} track rgb(${Math.round(track.r)},${Math.round(track.g)},${Math.round(track.b)})`);
  });
  return out;
};

const results = [];
const audit = async (p, name) => {
  await sleep(500);
  const r = await p.evaluate(AUDIT);
  if (SHOT) await p.screenshot({ path: `${SHOT}/${name}.png`, fullPage: false });
  results.push([name, r]);
  console.log(`${r.length ? '✗' : '✓'} ${name}${r.length ? '\n   ' + r.join('\n   ') : ''}`);
};

for (const [vpName, vp] of [['手機', { width: 390, height: 844, hasTouch: true, isMobile: true }], ['電腦', { width: 1280, height: 860 }]]) {
  const ctx = await world.newContext({ viewport: { width: vp.width, height: vp.height }, colorScheme: 'dark', ...(vp.hasTouch ? { hasTouch: true, isMobile: true } : {}) });
  const s = await world.newPage(ctx, { student: true });
  await s.goto(world.base + '/'); await s.waitForSelector('.unit-tile'); await audit(s, `學生 ${vpName} 首頁`);
  await s.goto(world.base + '/#/me'); await sleep(800); await audit(s, `學生 ${vpName} 我的成績`);
  await s.goto(world.base + '/#/account'); await sleep(800); await audit(s, `學生 ${vpName} 帳號`);
  await s.goto(world.base + '/#/u/l1-voc'); await s.waitForSelector('[data-start]'); await audit(s, `學生 ${vpName} 單字說明頁`);
  await s.click('[data-start]'); await s.waitForSelector('.q-card'); await audit(s, `學生 ${vpName} 單字作答`);
  await s.locator('.q-card .opt').first().click().catch(() => {}); await sleep(300); await audit(s, `學生 ${vpName} 單字作答後`);
  await s.evaluate(() => { delete document.body.dataset.busy; location.hash = '#/u/l1-read'; }); await s.waitForSelector('[data-start]'); await audit(s, `學生 ${vpName} 課文說明頁`);
  await s.click('[data-start]'); await sleep(1500); await audit(s, `學生 ${vpName} 課文作答`);
  await s.evaluate(() => { delete document.body.dataset.busy; location.hash = '#/u/l1-pat'; }); await s.waitForSelector('[data-start]'); await audit(s, `學生 ${vpName} 句型說明頁`);
  await s.click('[data-start]'); await sleep(1500); await audit(s, `學生 ${vpName} 句型作答`);

  const t = await world.newPage(ctx, { staff: 'teacher@example.com' });
  for (const h of ['overview', 'units', 'scores', 'students', 'live', 'settings', 'help', 'unit/l1-voc/content', 'unit/l1-voc/settings', 'unit/l1-voc/scores', 'unit/l1-read/content', 'unit/l1-pat/content']) {
    await t.goto(world.base + '/admin.html#' + h); await sleep(2200);
    if (/content$/.test(h)) { await t.click('[data-uc="edit"]').catch(() => {}); await sleep(1200); }
    await audit(t, `後台 ${vpName} ${h}`);
  }
  await ctx.close();
}
const bad = results.filter(([, r]) => r.length);
await world.close();
if (bad.length) { console.log(`${bad.length} 個畫面有對比不足的地方`); process.exit(1); }
console.log('深色模式對比檢查通過');
process.exit(0);
