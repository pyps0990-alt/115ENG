// 配對遊戲：英文 ↔ 中文，每回合 6 組，計時與錯誤次數
import { store } from '../storage.js';
import { esc, shuffle, fmtTime, wait } from '../util.js';
import { icon } from '../icons.js';
import { speak } from '../tts.js';
import { renderResult } from '../components/result.js';

const PER_ROUND = 6;
const MAX_WORDS = 18;

function chunk(words) {
  const out = [];
  for (let i = 0; i < words.length; i += PER_ROUND) out.push(words.slice(i, i + PER_ROUND));
  if (out.length > 1 && out[out.length - 1].length < 3) out[out.length - 2].push(...out.pop());
  return out;
}

export function mount(stage, ctx) {
  const unitId = ctx.unit.id;
  let rounds = []; let r = 0; let misses = 0; let t0 = 0; let elapsed = 0; let timer = null; let sel = null; let left = 0;
  let missed = new Set();
  let alive = true;

  if (ctx.words.length < 2) {
    stage.innerHTML = '<div class="empty"><div class="big">🧩</div><p>配對至少需要 2 個單字，請換個範圍。</p></div>';
    return;
  }

  const tick = () => {
    elapsed = Date.now() - t0;
    const el = stage.querySelector('[data-time]');
    if (el) el.textContent = fmtTime(elapsed);
  };

  const start = () => {
    rounds = chunk(shuffle(ctx.words).slice(0, MAX_WORDS));
    r = 0; misses = 0; elapsed = 0; t0 = 0; missed = new Set();
    clearInterval(timer); timer = null;
    stage.innerHTML = `
      <div class="match">
        <div class="match-hud">
          <span class="hud-pill time">${icon.clock}<span data-time>0:00.0</span></span>
          <span class="hud-pill miss">${icon.x}<span data-miss>0</span></span>
          <span class="hud-pill" data-round></span>
          ${store.bestTime(unitId) ? `<span class="hud-pill">${icon.trophy} 最佳 ${fmtTime(store.bestTime(unitId))}</span>` : ''}
        </div>
        <div data-board></div>
        <p class="kbd-hint">點一個英文，再點對應的中文。第一次點擊開始計時。</p>
      </div>`;
    drawRound();
  };

  const drawRound = () => {
    const words = rounds[r];
    left = words.length;
    sel = null;
    stage.querySelector('[data-round]').textContent = `第 ${r + 1} / ${rounds.length} 回合`;
    const en = shuffle(words.map((w, i) => ({ i, w })));
    const zh = shuffle(words.map((w, i) => ({ i, w })));
    const board = stage.querySelector('[data-board]');
    board.innerHTML = `<div class="match-board">
      <div class="match-col">${en.map(({ i, w }) => `<button class="tile en" type="button" data-side="en" data-i="${i}">${esc(w.word)}</button>`).join('')}</div>
      <div class="match-col">${zh.map(({ i, w }) => `<button class="tile" type="button" data-side="zh" data-i="${i}">${esc(w.zh)}</button>`).join('')}</div>
    </div>`;
    board.querySelector('.match-board').classList.add('stage-enter');
    board.querySelectorAll('.tile').forEach((t) => t.addEventListener('click', () => pick(t)));
  };

  const pick = async (tile) => {
    if (!alive || tile.classList.contains('hit')) return;
    if (!timer) { t0 = Date.now() - elapsed; timer = setInterval(tick, 100); }
    if (tile.dataset.side === 'en') speak(tile.textContent);
    if (!sel || sel.dataset.side === tile.dataset.side) {
      sel?.classList.remove('sel');
      sel = tile === sel ? null : tile;
      sel?.classList.add('sel');
      return;
    }
    const a = sel; sel = null;
    a.classList.remove('sel');
    if (a.dataset.i === tile.dataset.i) {
      a.classList.add('hit'); tile.classList.add('hit');
      left--;
      setTimeout(() => { a.classList.add('gone'); tile.classList.add('gone'); }, 480);
      if (left === 0) await roundDone();
    } else {
      misses++;
      const enTile = a.dataset.side === 'en' ? a : tile;
      missed.add(rounds[r][Number(enTile.dataset.i)].word);
      stage.querySelector('[data-miss]').textContent = misses;
      [a, tile].forEach((t) => { t.classList.remove('miss'); void t.offsetWidth; t.classList.add('miss'); });
      setTimeout(() => [a, tile].forEach((t) => t.classList.remove('miss')), 450);
    }
  };

  const roundDone = async () => {
    await wait(520);
    if (!alive) return;
    r++;
    if (r < rounds.length) {
      stage.querySelector('[data-board]').innerHTML = `<div class="round-banner">Round ${r} clear! ✨</div>`;
      await wait(800);
      if (alive) drawRound();
      return;
    }
    clearInterval(timer); timer = null; tick();
    finish();
  };

  function finish() {
    const total = rounds.flat().length;
    const pct = Math.max(0, Math.round((total / (total + misses)) * 100));
    const newBest = store.setBestTime(unitId, elapsed);
    store.setBest(unitId, 'match', pct);
    missed.forEach((w) => store.addWrong(unitId, w));
    stage.innerHTML = '';
    const mw = ctx.words.filter((w) => missed.has(w.word));
    renderResult(stage, {
      title: newBest ? '新紀錄！🏆' : '配對完成！',
      pct,
      scoreText: `正確率`,
      pills: [`${icon.clock} ${fmtTime(elapsed)}`, `${icon.x} 配錯 ${misses} 次`, `${total} 組`],
      wrong: mw.map((w) => ({ p: w.zh, a: w.word })),
      actions: [
        { label: '再玩一次', icon: icon.redo, primary: true, onClick: start },
        { label: '看單字表', icon: icon.list, onClick: () => ctx.go('list') },
      ],
    });
  }

  start();
  return () => { alive = false; clearInterval(timer); };
}
