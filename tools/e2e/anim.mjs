// 動畫完整性：每個畫面的進場動畫都會播完（停在完全不透明、沒有位移的最終狀態），沒有卡在半路或一直跑的動畫；
// 「減少動態效果」開啟時，畫面一出現就是最終狀態。node tools/e2e/anim.mjs
import assert from 'node:assert';
import { startWorld, sleep } from './harness.mjs';

const world = await startWorld({ scriptLatency: 100 });
const g = world.gas;
g.api('saveAllSettings', [[], [
  { id: 'a-pat', title: 'A 句型練習', type: 'pattern', lesson: 1, topic: '', visible: true, disabled: [], questionCount: 10, custom: true },
  { id: 'b-voc', title: 'B 單字', type: 'vocab', lesson: 2, topic: '', visible: true, disabled: [], questionCount: 4, custom: true },
]]);
g.api('saveContent', ['a-pat', { topic: 't', items: [{ type: 'mc', tag: 'x', q: 'A ____ b', options: ['a', 'b', 'c', 'd'], answer: 0, explain: 'e' }] }, true]);
g.api('saveContent', ['b-voc', { topic: 't', words: ['apple', 'bread', 'candy', 'dance'].map((w) => ({ word: w, pos: 'n.', zh: '字', example: `I [${w}] it.`, exampleZh: '我。' })) }, true]);

// 畫面上主要的區塊：進場動畫播完後要完全不透明、沒有位移或縮放
const KEY = '#app > *, .unit-tile, .card, .gate-card, .q-card, .opt, .result > *, .me-row, .home-prog, h1, #student-chip';
async function settled(p, label, reduced, ms = 2500) {
  await sleep(reduced ? 150 : ms);
  const r = await p.evaluate((sel) => {
    const vis = (el) => { const b = el.getBoundingClientRect(); return b.width > 0 && b.height > 0 && getComputedStyle(el).visibility !== 'hidden'; };
    const stuck = [...document.querySelectorAll(sel)].filter(vis).map((el) => {
      const cs = getComputedStyle(el);
      const m = cs.transform === 'none' ? null : new DOMMatrix(cs.transform);
      const moved = m && (Math.abs(m.m41) > 0.5 || Math.abs(m.m42) > 0.5 || Math.abs(m.a - 1) > 0.01 || Math.abs(m.d - 1) > 0.01);
      return Number(cs.opacity) < 0.99 || moved ? `${el.tagName.toLowerCase()}.${[...el.classList].join('.')} opacity=${cs.opacity} transform=${cs.transform}` : '';
    }).filter(Boolean);
    const running = document.getAnimations().filter((a) => a.playState === 'running').map((a) => {
      const t = a.effect && a.effect.getComputedTiming();
      const el = a.effect && a.effect.target;
      return { name: a.animationName || a.transitionProperty || 'js', infinite: t && t.iterations === Infinity, on: el ? `${el.tagName.toLowerCase()}.${[...el.classList].join('.')}` : '' };
    });
    return { stuck, running };
  }, KEY);
  const finite = r.running.filter((a) => !a.infinite);
  assert.deepEqual(r.stuck, [], `${label}：有區塊停在動畫中途`);
  assert.deepEqual(finite, [], `${label}：動畫還沒播完`);
  // 一直重複的動畫只允許載入中的轉圈與考試計時的提示
  const loops = r.running.filter((a) => a.infinite && !/spin|pulse/.test(a.name));
  assert.deepEqual(loops, [], `${label}：有不該一直重複的動畫`);
  if (reduced) assert.equal(r.running.filter((a) => a.infinite).length, 0, `${label}：減少動態效果時不該有重複播放的動畫`);
  console.log(`✓ ${label}${r.running.length ? `（持續中：${r.running.map((a) => a.name).join(', ')}）` : ''}`);
}

for (const reduced of [false, true]) {
  const tag = reduced ? '［減少動態效果］' : '';
  const ctx = await world.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: reduced ? 'reduce' : 'no-preference' });
  const p = await world.newPage(ctx, { student: true });
  await p.goto(world.base + '/'); await p.waitForSelector('.unit-tile');
  await settled(p, tag + '首頁', reduced);
  await p.click('.unit-tile[data-id="a-pat"]'); await p.waitForSelector('[data-start]');
  await settled(p, tag + '單元頁', reduced);
  await p.click('[data-start]'); await p.waitForSelector('.opt');
  await settled(p, tag + '作答中', reduced);
  await p.locator('.opt').first().click(); await sleep(200);
  await p.locator('[data-next]:not([hidden])').click(); await p.waitForSelector('.result');
  await settled(p, tag + '成績畫面', reduced, 4600); // 滿分的彩帶最長約 4.2 秒
  await p.evaluate(() => { delete document.body.dataset.busy; location.hash = '#/me'; }); await p.waitForSelector('.me-row');
  await settled(p, tag + '我的成績', reduced);
  await p.evaluate(() => { location.hash = '#/'; }); await p.waitForSelector('.unit-tile');
  await settled(p, tag + '回到首頁', reduced);
  const bad = p.errors.filter((e) => !/favicon/.test(e));
  assert.equal(bad.length, 0, bad.join('\n'));
  await ctx.close();
}
await world.close();
console.log('動畫完整性測試通過');
