// 單字作答：每一題的題目卡都完整落在導覽列（含黏在上方的進度卡）與下方固定橫幅之間，不被蓋住（大手機與 iPhone SE 尺寸）：node tools/e2e/quiz-view.mjs
import { startWorld, sleep } from './harness.mjs';
const world = await startWorld({ scriptLatency: 40 });
const g = world.gas;
g.api('saveAllSettings', [[], [{ id: 'u1', title: 'L1 單字', type: 'vocab', lesson: 1, topic: '', visible: true, disabled: [], questionCount: 4, custom: true }]]);
const words = ['apple', 'banana', 'cherry', 'dates', 'egg', 'fig'].map((w) => ({ word: w, pos: 'n.', zh: '字' + w, example: `I eat [${w}] every day at school.`, exampleZh: '我。' }));
g.api('saveContent', ['u1', { topic: 'Topic', words }, true]);
let fail = 0;
for (const [w, h] of [[390, 844], [375, 667]]) {
  const ctx = await world.newContext({ viewport: { width: w, height: h }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const p = await world.newPage(ctx, { student: true });
  await p.goto(world.base + '/#/u/u1'); await p.waitForSelector('[data-start]'); await p.click('[data-start]');
  for (let i = 0; i < 4; i++) {
    await p.waitForSelector('.q-card'); await sleep(900);
    const r = await p.evaluate(() => {
      const c = document.querySelector('.q-card').getBoundingClientRect();
      const top = document.querySelector('.topbar').getBoundingClientRect().bottom;
      const d = document.querySelector('.q-dock').getBoundingClientRect().top;
      const st = document.querySelector('.st-bar').getBoundingClientRect();
      return { stBot: Math.round(st.bottom), cTop: Math.round(c.top), cBot: Math.round(c.bottom), bar: Math.round(top), dock: Math.round(d), y: Math.round(scrollY) };
    });
    const ok = r.cTop >= r.bar && r.cBot <= r.dock && r.stBot <= r.cTop;
    if (!ok) fail++;
    console.log(w + 'x' + h, 'Q' + (i + 1), ok ? '✓' : '✗', JSON.stringify(r));
    // answer: spell or mc
    if (await p.$('.spell-input')) { await p.fill('.spell-input', 'zzz'); await p.keyboard.press('Enter'); }
    else await p.locator('.opt').first().click();
    await sleep(300);
    const n = p.locator('[data-next]:not([hidden])'); if (await n.count()) await n.click();
    await sleep(300);
    if (await p.$('[data-continue]')) { await p.click('[data-continue]'); }
  }
  await ctx.close();
}
await world.close?.();
console.log(fail ? `${fail} 題被蓋住` : "題目卡不被蓋住測試通過");
process.exit(fail ? 1 : 0);
