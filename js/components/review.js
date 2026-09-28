// 逐題檢討：一次只顯示一題，可以前後翻，最後一題按「完成檢討」
import { esc } from '../util.js';
import { icon } from '../icons.js';
import { store } from '../storage.js';
import { markReviewed } from '../firebase.js';

// items: [{ html, mount?(el) }]；emptyText：沒有題目要檢討時顯示的文字
export function mountReview(host, { title, items, emptyText = '這次全部答對，沒有需要檢討的題目。', onDone, onExit }) {
  let i = 0;
  const box = document.createElement('div');
  box.className = 'review';
  host.replaceChildren(box);

  const draw = () => {
    const n = items.length;
    const last = i >= n - 1;
    box.innerHTML = `
      <div class="review-head">
        <button class="btn small ghost" type="button" data-exit>${icon.back} 離開檢討</button>
        <div><div class="eyebrow">Review</div><h2>${esc(title)}</h2></div>
        ${n ? `<span class="review-count">${i + 1} / ${n}</span>` : ''}
      </div>
      ${n ? `<div class="review-bar"><span style="width:${((i + 1) / n) * 100}%"></span></div>` : ''}
      <div class="review-body" data-body>${n ? items[i].html : `<div class="empty"><div class="big">${icon.check}</div><p>${esc(emptyText)}</p></div>`}</div>
      <div class="review-nav">
        ${n ? `<button class="btn ghost" type="button" data-prev ${i === 0 ? 'disabled' : ''}>${icon.back} 上一題</button>` : '<span></span>'}
        <button class="btn primary" type="button" data-next>${last ? `${icon.check} 完成檢討` : `下一題 ${icon.arrowR}`}</button>
      </div>`;
    if (n && items[i].mount) items[i].mount(box.querySelector('[data-body]'));
    box.querySelector('[data-exit]').onclick = () => onExit?.();
    box.querySelector('[data-prev]')?.addEventListener('click', () => { i--; draw(); box.scrollIntoView({ block: 'nearest' }); });
    box.querySelector('[data-next]').onclick = () => {
      if (last) { onDone?.(); return; }
      i++; draw(); box.scrollIntoView({ block: 'nearest' });
    };
  };
  draw();
}

// 第一次正式測驗檢討完：記在裝置上，也寫回 Firestore（換裝置也記得）
export function completeReview(unit) {
  store.setReviewed(unit);
  markReviewed((store.student() || {}).key, unit).catch((e) => console.warn('Firestore 檢討紀錄寫入失敗', e));
}
