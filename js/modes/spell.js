// 拼字／克漏字：字母框輸入、提示（每次扣 0.25 分）、答對翻轉動畫
import { store } from '../storage.js';
import { sample, clozeParts } from '../util.js';
import { icon } from '../icons.js';
import { buildSpell, renderSpell, promptText } from '../components/question.js';
import { renderResult } from '../components/result.js';

const VARIANTS = [['spell', '拼字（看中文）'], ['cloze', '克漏字（看例句）']];
const MAX_Q = 10;
const HINT_COST = 0.25;

export function mount(stage, ctx) {
  const unitId = ctx.unit.id;
  let variant = store.pref('spellVariant', 'spell');
  let qs = []; let idx = 0; let points = 0; let wrong = []; let current = null;

  if (!ctx.words.length) {
    stage.innerHTML = '<div class="empty"><div class="big">🎉</div><p>這個範圍沒有單字。</p></div>';
    return;
  }

  const start = (words = ctx.words) => {
    const pool = variant === 'cloze' ? words.filter((w) => clozeParts(w)) : words;
    qs = sample(pool.length ? pool : words, Math.min(MAX_Q, words.length)).map((w) => buildSpell(w, variant));
    idx = 0; points = 0; wrong = [];
    stage.innerHTML = `
      <div class="quiz">
        <div class="quiz-bar">
          <div class="seg" role="group" aria-label="題型">${VARIANTS.map(([k, l]) => `<button type="button" data-v="${k}" class="${k === variant ? 'on' : ''}">${l}</button>`).join('')}</div>
        </div>
        <div class="quiz-bar"><div class="bar"><span></span></div><span class="quiz-stat" data-n></span><span class="quiz-stat" data-pts></span></div>
        <div data-q></div>
        <div class="q-foot"><div class="feedback" data-fb aria-live="polite"></div><button class="btn primary" type="button" data-next hidden>下一題 ${icon.arrowR}</button></div>
      </div>`;
    stage.querySelectorAll('[data-v]').forEach((b) => b.addEventListener('click', () => {
      variant = b.dataset.v; store.setPref('spellVariant', variant); start();
    }));
    stage.querySelector('[data-next]').addEventListener('click', next);
    show();
  };

  const show = () => {
    stage.querySelector('.bar > span').style.width = `${(idx / qs.length) * 100}%`;
    stage.querySelector('[data-n]').textContent = `${idx + 1} / ${qs.length}`;
    stage.querySelector('[data-pts]').textContent = `★ ${fmt(points)}`;
    stage.querySelector('[data-fb]').innerHTML = '';
    const nb = stage.querySelector('[data-next]');
    nb.hidden = true;
    const host = stage.querySelector('[data-q]');
    host.innerHTML = '';
    const q = qs[idx];
    current = renderSpell(host, q, {
      onAnswer: (ok, { hints, typed }) => {
        const fb = stage.querySelector('[data-fb]');
        if (ok) {
          const got = Math.max(0, 1 - hints * HINT_COST);
          points += got;
          fb.className = 'feedback ok';
          fb.innerHTML = `${icon.check} ${hints ? `答對（用了 ${hints} 次提示，+${fmt(got)}）` : '完美！+1'}`;
        } else {
          wrong.push({ q, typed });
          store.addWrong(unitId, q.word.word);
          fb.className = 'feedback no';
          fb.innerHTML = `${icon.x} 再記一下`;
        }
        stage.querySelector('[data-pts]').textContent = `★ ${fmt(points)}`;
        nb.hidden = false;
        nb.innerHTML = idx === qs.length - 1 ? `看結果 ${icon.arrowR}` : `下一題 ${icon.arrowR}`;
        setTimeout(() => nb.focus({ preventScroll: true }), 30);
      },
    });
  };

  function next() {
    idx++;
    if (idx >= qs.length) finish(); else show();
  }

  function finish() {
    current = null;
    const pct = Math.round((points / qs.length) * 100);
    store.setBest(unitId, 'spell', pct);
    stage.innerHTML = '';
    const ww = wrong.map((x) => x.q.word);
    renderResult(stage, {
      pct,
      scoreText: `${fmt(points)} / ${qs.length}`,
      wrong: wrong.map((x) => ({ p: promptText(x.q), a: x.q.answer, y: x.typed })),
      actions: [
        ...(ww.length ? [{ label: '重練拼錯的字', icon: icon.redo, primary: true, onClick: () => start(ww) }] : []),
        { label: '再來一輪', icon: icon.shuffle, primary: !ww.length, onClick: () => start() },
        { label: '玩配對遊戲', icon: icon.puzzle, onClick: () => ctx.go('match') },
      ],
    });
  }

  const onKey = (e) => {
    if (e.key === 'Enter' && current?.checked && !e.target.closest('button')) { e.preventDefault(); next(); }
  };
  document.addEventListener('keydown', onKey);
  start();
  return () => document.removeEventListener('keydown', onKey);
}

const fmt = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0$/, ''));
