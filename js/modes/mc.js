// 選擇題：英→中／中→英／混合，連對 🔥、即時回饋
import { store } from '../storage.js';
import { sample, wait } from '../util.js';
import { icon } from '../icons.js';
import { buildMC, promptText, answerText, renderMC as renderMCImpl } from '../components/question.js';
import { renderResult } from '../components/result.js';

const DIRS = [['en2zh', '英 → 中'], ['zh2en', '中 → 英'], ['mix', '混合']];
const MAX_Q = 10;

export function mount(stage, ctx) {
  const unitId = ctx.unit.id;
  let dir = store.pref('mcDir', 'en2zh');
  let qs = []; let idx = 0; let score = 0; let streak = 0; let best = 0; let wrong = [];
  let current = null; let advanceTimer = null; let alive = true;

  if (!ctx.words.length) {
    stage.innerHTML = '<div class="empty"><div class="big">🎉</div><p>這個範圍沒有單字。</p></div>';
    return;
  }

  const start = (words = ctx.words) => {
    qs = sample(words, Math.min(MAX_Q, words.length)).map((w) => buildMC(w, ctx.allWords, dir));
    idx = 0; score = 0; streak = 0; best = 0; wrong = [];
    stage.innerHTML = `
      <div class="quiz">
        <div class="quiz-bar">
          <div class="seg" role="group" aria-label="出題方向">${DIRS.map(([k, l]) => `<button type="button" data-dir="${k}" class="${k === dir ? 'on' : ''}">${l}</button>`).join('')}</div>
        </div>
        <div class="quiz-bar">
          <div class="bar"><span></span></div>
          <span class="quiz-stat" data-n></span>
          <span class="quiz-stat streak" data-streak title="連續答對">${icon.flame}<b>0</b></span>
        </div>
        <div data-q></div>
        <div class="q-foot"><div class="feedback" data-fb aria-live="polite"></div><button class="btn primary" type="button" data-next hidden>下一題 ${icon.arrowR}</button></div>
      </div>`;
    stage.querySelectorAll('[data-dir]').forEach((b) => b.addEventListener('click', () => {
      dir = b.dataset.dir; store.setPref('mcDir', dir); start();
    }));
    stage.querySelector('[data-next]').addEventListener('click', next);
    show();
  };

  const hud = () => {
    stage.querySelector('.bar > span').style.width = `${(idx / qs.length) * 100}%`;
    stage.querySelector('[data-n]').textContent = `${idx + 1} / ${qs.length}`;
    const s = stage.querySelector('[data-streak]');
    s.querySelector('b').textContent = streak;
  };

  const show = () => {
    hud();
    const host = stage.querySelector('[data-q]');
    host.innerHTML = '';
    stage.querySelector('[data-fb]').innerHTML = '';
    stage.querySelector('[data-next]').hidden = true;
    const q = qs[idx];
    current = renderMC(host, q);
  };

  function renderMC(host, q) {
    return renderMCImpl(host, q, {
      onAnswer: async (ok, chosen) => {
        const fb = stage.querySelector('[data-fb]');
        const s = stage.querySelector('[data-streak]');
        if (ok) {
          score++; streak++; best = Math.max(best, streak);
          fb.className = 'feedback ok';
          fb.innerHTML = `${icon.check} ${streak >= 3 ? `連對 ${streak} 題！` : '答對了！'}`;
          s.classList.remove('bump'); void s.offsetWidth; s.classList.add('bump');
        } else {
          streak = 0;
          wrong.push({ q, chosen });
          store.addWrong(unitId, q.word.word);
          fb.className = 'feedback no';
          fb.innerHTML = `${icon.x} 正確答案已標示`;
        }
        s.querySelector('b').textContent = streak;
        const nb = stage.querySelector('[data-next]');
        nb.hidden = false;
        nb.innerHTML = idx === qs.length - 1 ? `看結果 ${icon.arrowR}` : `下一題 ${icon.arrowR}`;
        nb.focus({ preventScroll: true });
        if (ok) { clearTimeout(advanceTimer); advanceTimer = setTimeout(() => alive && next(), 1100); }
      },
    });
  }

  async function next() {
    clearTimeout(advanceTimer);
    if (!alive) return;
    idx++;
    if (idx >= qs.length) { finish(); return; }
    await wait(10);
    show();
  }

  function finish() {
    current = null;
    const pct = Math.round((score / qs.length) * 100);
    store.setBest(unitId, 'mc', pct);
    stage.innerHTML = '';
    const wrongWords = wrong.map((x) => x.q.word);
    renderResult(stage, {
      pct,
      scoreText: `${score} / ${qs.length}`,
      pills: [`${icon.flame} 最長連對 ${best}`],
      wrong: wrong.map((x) => ({ p: promptText(x.q), a: answerText(x.q), y: x.q.options[x.chosen] })),
      actions: [
        ...(wrongWords.length ? [{ label: '重練錯的題目', icon: icon.redo, primary: true, onClick: () => start(wrongWords) }] : []),
        { label: '再來一輪', icon: icon.shuffle, primary: !wrongWords.length, onClick: () => start() },
        { label: '挑戰拼字', icon: icon.pencil, onClick: () => ctx.go('spell') },
      ],
    });
  }

  const onKey = (e) => {
    if (e.target.closest('input, textarea, dialog') || !current) return;
    const k = e.key.toLowerCase();
    const map = { 1: 0, 2: 1, 3: 2, 4: 3, a: 0, b: 1, c: 2, d: 3 };
    if (k in map) current.choose(map[k]);
    else if (k === 'enter' && !e.target.closest('button') && !stage.querySelector('[data-next]')?.hidden) { e.preventDefault(); next(); }
  };
  document.addEventListener('keydown', onKey);
  start();
  return () => { alive = false; clearTimeout(advanceTimer); document.removeEventListener('keydown', onKey); };
}

