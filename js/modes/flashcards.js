// 單字卡：3D 翻面、左右滑動分類（右＝熟悉、左＝不熟）、鍵盤 ← → 空白鍵
import { store } from '../storage.js';
import { esc, exampleHTML, shuffle, wait } from '../util.js';
import { icon } from '../icons.js';
import { speak } from '../tts.js';
import { renderResult } from '../components/result.js';

const SWIPE = 90;

export function mount(stage, ctx) {
  const unitId = ctx.unit.id;
  let deck = [...ctx.words];
  let i = 0;
  let known = [];
  let unknown = [];
  let busy = false;
  let cardEl = null;

  if (!deck.length) {
    stage.innerHTML = '<div class="empty"><div class="big">🎉</div><p>這個範圍沒有單字。「待加強」是空的代表你都會了！</p></div>';
    return;
  }

  const layout = () => {
    stage.innerHTML = `
      <div class="fc-wrap">
        <div class="fc-top"><div class="bar"><span></span></div><div class="fc-count"></div></div>
        <div class="fc-tally"><span class="u">✗ 不熟 <b data-u>0</b></span><span class="k">熟悉 <b data-k>0</b> ✓</span></div>
        <div class="fc-stage"><div class="fc-ghost g2"></div><div class="fc-ghost g1"></div></div>
        <div class="fc-controls">
          <button class="round-btn bad" type="button" data-act="unknown" aria-label="不熟">${icon.x}</button>
          <button class="round-btn sm" type="button" data-act="flip" aria-label="翻面">${icon.flip}</button>
          <button class="round-btn good" type="button" data-act="known" aria-label="熟悉">${icon.check}</button>
        </div>
        <div class="fc-tools">
          <button class="btn small ghost" type="button" data-act="shuffle">${icon.shuffle} 洗牌</button>
          <button class="btn small ghost speak-btn" type="button" data-act="say">${icon.speaker} 發音</button>
        </div>
        <div class="kbd-hint">點卡片翻面 · 往右滑＝熟悉、往左滑＝不熟 · 鍵盤 <kbd>←</kbd> <kbd>→</kbd> <kbd>Space</kbd></div>
      </div>`;
    stage.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => act(b.dataset.act)));
  };

  const updateHud = () => {
    const pct = (i / deck.length) * 100;
    stage.querySelector('.bar > span').style.width = `${pct}%`;
    stage.querySelector('.fc-count').textContent = `${Math.min(i + 1, deck.length)} / ${deck.length}`;
    stage.querySelector('[data-k]').textContent = known.length;
    stage.querySelector('[data-u]').textContent = unknown.length;
    const left = deck.length - i;
    stage.querySelector('.g1').style.visibility = left > 1 ? '' : 'hidden';
    stage.querySelector('.g2').style.visibility = left > 2 ? '' : 'hidden';
  };

  const showCard = () => {
    updateHud();
    const w = deck[i];
    const host = stage.querySelector('.fc-stage');
    cardEl?.remove();
    cardEl = document.createElement('div');
    cardEl.className = 'fc-card enter';
    cardEl.tabIndex = 0;
    cardEl.setAttribute('role', 'button');
    cardEl.setAttribute('aria-label', `${w.word}，點擊翻面`);
    cardEl.innerHTML = `
      <div class="fc-stamp known">熟悉 ✓</div><div class="fc-stamp unknown">✗ 不熟</div>
      <div class="fc-inner">
        <div class="fc-face fc-front">
          <div class="fc-word">${esc(w.word)}</div>
          <span class="pos">${esc(w.pos || '')}</span>
          <button class="speak lg" type="button" aria-label="發音">${icon.speaker}</button>
          <div class="fc-tap">${icon.flip} 點一下翻面</div>
        </div>
        <div class="fc-face fc-back">
          <span class="pos">${esc(w.pos || '')}</span>
          <div class="fc-zh">${esc(w.zh)}</div>
          ${w.example ? `<div class="fc-ex">${exampleHTML(w.example)}</div>` : ''}
          ${w.exampleZh ? `<div class="fc-exzh">${esc(w.exampleZh)}</div>` : ''}
        </div>
      </div>`;
    host.append(cardEl);
    cardEl.querySelector('.speak').addEventListener('pointerdown', (e) => e.stopPropagation());
    cardEl.querySelector('.speak').addEventListener('click', (e) => { e.stopPropagation(); speak(w.word); });
    bindDrag(cardEl);
  };

  const flip = () => cardEl?.classList.toggle('flipped');

  const decide = async (kind) => {
    if (busy || !cardEl) return;
    busy = true;
    const w = deck[i];
    (kind === 'known' ? known : unknown).push(w);
    store.setKnown(unitId, w.word, kind === 'known' ? 1 : 0);
    cardEl.classList.remove('enter', 'dragging');
    cardEl.classList.add(kind === 'known' ? 'out-right' : 'out-left');
    await wait(300);
    i++;
    busy = false;
    if (i >= deck.length) finish(); else showCard();
  };

  const act = (a) => {
    if (a === 'flip') flip();
    else if (a === 'known' || a === 'unknown') decide(a);
    else if (a === 'say') speak(deck[i]?.word);
    else if (a === 'shuffle') { deck = shuffle(deck.slice(i)); i = 0; known = []; unknown = []; showCard(); }
  };

  function bindDrag(card) {
    let x0 = 0; let y0 = 0; let dx = 0; let dragging = false; let id = null;
    const stamps = { k: card.querySelector('.fc-stamp.known'), u: card.querySelector('.fc-stamp.unknown') };
    card.addEventListener('pointerdown', (e) => {
      if (busy) return;
      id = e.pointerId; x0 = e.clientX; y0 = e.clientY; dx = 0; dragging = true;
      card.setPointerCapture(id);
    });
    card.addEventListener('pointermove', (e) => {
      if (!dragging || e.pointerId !== id) return;
      dx = e.clientX - x0;
      const dy = e.clientY - y0;
      if (Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
      card.classList.add('dragging');
      card.classList.remove('enter');
      card.style.transform = `translateX(${dx}px) rotate(${dx / 18}deg)`;
      stamps.k.style.opacity = Math.max(0, Math.min(1, dx / SWIPE));
      stamps.u.style.opacity = Math.max(0, Math.min(1, -dx / SWIPE));
    });
    const end = (e) => {
      if (!dragging || e.pointerId !== id) return;
      dragging = false;
      card.classList.remove('dragging');
      if (Math.abs(dx) >= SWIPE) {
        card.style.transform = '';
        decide(dx > 0 ? 'known' : 'unknown');
      } else {
        card.style.transform = '';
        stamps.k.style.opacity = 0; stamps.u.style.opacity = 0;
        if (Math.abs(dx) < 6 && e.type === 'pointerup') flip();
      }
    };
    card.addEventListener('pointerup', end);
    card.addEventListener('pointercancel', end);
    card.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); flip(); } });
  }

  const onKey = (e) => {
    if (e.target.closest('input, textarea, dialog') || !cardEl) return;
    if (e.key === 'ArrowRight') { e.preventDefault(); decide('known'); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); decide('unknown'); }
    else if (e.key === ' ') { e.preventDefault(); flip(); }
  };

  function finish() {
    cardEl = null;
    const pct = Math.round((known.length / deck.length) * 100);
    store.setBest(unitId, 'flashcards', pct);
    stage.innerHTML = '';
    const actions = [];
    if (unknown.length) {
      actions.push({ label: `只練不熟的 ${unknown.length} 個`, icon: icon.redo, primary: true, onClick: () => start(unknown) });
    }
    actions.push({ label: '全部重來', icon: icon.shuffle, primary: !unknown.length, onClick: () => start(shuffle(ctx.words)) });
    actions.push({ label: '去做選擇題', icon: icon.target, onClick: () => ctx.go('mc') });
    renderResult(stage, {
      title: '單字卡完成！',
      pct,
      scoreText: `熟悉 ${known.length} / ${deck.length}`,
      wrong: unknown.map((w) => ({ p: w.zh, a: w.word })),
      actions,
    });
  }

  function start(words) {
    deck = [...words]; i = 0; known = []; unknown = [];
    layout();
    showCard();
  }

  document.addEventListener('keydown', onKey);
  start(deck);
  return () => document.removeEventListener('keydown', onKey);
}
