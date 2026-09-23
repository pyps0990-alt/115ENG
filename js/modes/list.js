// 單字表：搜尋、發音、熟悉度標記（未標記 → 熟悉 → 不熟 → 未標記）
import { store } from '../storage.js';
import { esc, exampleHTML, toast } from '../util.js';
import { icon } from '../icons.js';
import { speak } from '../tts.js';

const STATUS = {
  none: { cls: '', label: '標記熟悉度' },
  1: { cls: 's-1', label: '熟悉' },
  0: { cls: 's-0', label: '不熟' },
};

export function mount(stage, ctx) {
  const unitId = ctx.unit.id;
  stage.innerHTML = `
    <div class="list-tools">
      <label class="search">${icon.search}<input type="search" placeholder="搜尋單字或中文…" aria-label="搜尋單字"></label>
      <button class="btn" type="button" data-go="flashcards">${icon.cards} 用單字卡練習</button>
    </div>
    <div class="word-grid"></div>`;
  const grid = stage.querySelector('.word-grid');
  const input = stage.querySelector('input');
  stage.querySelector('[data-go]').onclick = () => ctx.go('flashcards');

  const draw = () => {
    const q = input.value.trim().toLowerCase();
    const known = store.known(unitId);
    const words = ctx.words.filter((w) => !q || w.word.toLowerCase().includes(q) || w.zh.includes(q));
    if (!words.length) {
      grid.innerHTML = `<div class="empty" style="grid-column:1/-1"><div class="big">🔍</div><p>${ctx.words.length ? '找不到符合的單字' : '這個範圍目前沒有單字'}</p></div>`;
      return;
    }
    grid.innerHTML = words.map((w, i) => {
      const s = w.word in known ? known[w.word] : 'none';
      return `<article class="wcard ${STATUS[s].cls}" style="animation-delay:${Math.min(i, 12) * 30}ms">
        <div class="wcard-top"><h3 class="w">${esc(w.word)}</h3><span class="pos">${esc(w.pos || '')}</span>
          <button class="speak" type="button" data-say="${esc(w.word)}" aria-label="發音 ${esc(w.word)}">${icon.speaker}</button></div>
        <p class="zh">${esc(w.zh)}</p>
        ${w.example ? `<p class="ex">${exampleHTML(w.example)}</p>` : ''}
        ${w.exampleZh ? `<p class="ex-zh">${esc(w.exampleZh)}</p>` : ''}
        <button class="status-btn ${STATUS[s].cls}" type="button" data-word="${esc(w.word)}"><span class="dot"></span>${STATUS[s].label}</button>
      </article>`;
    }).join('');
  };

  grid.addEventListener('click', (e) => {
    const say = e.target.closest('[data-say]');
    if (say) { speak(say.dataset.say); return; }
    const st = e.target.closest('.status-btn');
    if (!st) return;
    const word = st.dataset.word;
    const cur = store.known(unitId)[word];
    const next = cur === undefined ? 1 : cur === 1 ? 0 : null;
    store.setKnown(unitId, word, next);
    const s = next == null ? 'none' : next;
    const card = st.closest('.wcard');
    card.className = `wcard ${STATUS[s].cls}`;
    card.style.animation = 'none';
    st.className = `status-btn ${STATUS[s].cls}`;
    st.innerHTML = `<span class="dot"></span>${STATUS[s].label}`;
    toast(next === 1 ? `✓ ${word} 標記為熟悉` : next === 0 ? `${word} 加入待加強` : `${word} 取消標記`);
  });
  input.addEventListener('input', draw);
  draw();
}
