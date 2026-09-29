// 測驗前關卡：確認學生基本資料，顯示規則與開始按鈕
import { store } from '../storage.js';
import { esc } from '../util.js';
import { icon } from '../icons.js';
import { fmtWhen } from '../remote-config.js';
import { mountInlineForm, openStudentDialog, studentLabel } from '../student.js';
import { SCRIPT_URL } from '../config.js';

// review()：做過正式測驗了嗎；reviewed()：檢討完了嗎。
// 做過但還沒檢討：只能先檢討，「開始複習」鎖住；檢討完才能複習。
export function testGate(stage, { eyebrow, title, rules = [], best, review = false, reviewed = true, timeWindow, onStart, onReview }) {
  let wake = null;
  const draw = () => {
    stage.innerHTML = '';
    const s = store.student();
    if (!s) {
      const wrap = document.createElement('div');
      wrap.className = 'gate';
      stage.append(wrap);
      mountInlineForm(wrap, { title: '開始測驗前，請先填寫基本資料', desc: '測驗成績會依這些資料送給老師，請確認正確。', button: '下一步', onSave: draw });
      return;
    }
    const isReview = typeof review === 'function' ? review() : review;
    const isReviewed = typeof reviewed === 'function' ? reviewed() : reviewed;
    const bestNow = typeof best === 'function' ? best() : best;
    const needReview = isReview && !isReviewed && !!onReview;
    // 開放時段：還沒開放不能做；截止後不能做正式測驗，做過的人仍可檢討、複習
    const win = timeWindow ? timeWindow() : { state: 'open' };
    clearTimeout(wake);
    if (win.state === 'before' && win.openAt - Date.now() < 86400000) wake = setTimeout(draw, win.openAt - Date.now() + 500);
    let timeNote = '';
    if (win.state === 'open' && win.closeAt) timeNote = `${icon.clock} ${win.extended ? '老師開放你補作到' : '開放到'} ${fmtWhen(win.closeAt)}`;
    let buttons = `<button class="btn primary" type="button" data-start>${icon.play} 開始測驗</button>`;
    if (isReview && needReview) {
      buttons = `<button class="btn primary" type="button" data-review>${icon.bulb} 開始檢討</button>
        <button class="btn" type="button" data-start disabled title="完成檢討後才能複習">${icon.lock} 開始複習</button>`;
    } else if (isReview) {
      buttons = `<button class="btn primary" type="button" data-start>${icon.play} 開始複習</button>
        ${onReview ? `<button class="btn ghost" type="button" data-review>${icon.bulb} 再看一次檢討</button>` : ''}`;
    }
    if (win.state === 'before') {
      buttons = `<button class="btn" type="button" data-start disabled>${icon.lock} 尚未開放</button>`;
      timeNote = `${icon.clock} ${fmtWhen(win.openAt)} 開放`;
    } else if (win.state === 'after' && !isReview) {
      buttons = `<button class="btn" type="button" data-start disabled>${icon.lock} 已截止</button>`;
      timeNote = `${icon.clock} 已於 ${fmtWhen(win.closeAt)} 截止，不能再做正式測驗`;
    }
    const box = document.createElement('div');
    box.className = 'gate';
    box.innerHTML = `<div class="card gate-card">
        <div><div class="eyebrow">${esc(eyebrow)}${isReview ? ' · 複習' : ''}</div><h2>${esc(title)}</h2></div>
        <ul class="rules">${rules.map((r) => `<li>${r}</li>`).join('')}
          ${isReview ? '<li>你已經完成這個單元的正式測驗，這次是<b>複習</b>，成績會標記為複習送給老師</li>' : ''}
          <li>${SCRIPT_URL ? '完成後成績會自動傳送給老師' : '完成後請截圖成績單繳交給老師'}</li></ul>
        ${bestNow != null ? `<div class="best-line">${icon.trophy} 你的最佳成績 <b>${bestNow}%</b></div>` : ''}
        <div class="who">${icon.user}<span>${esc(studentLabel(s))}</span><button class="btn small ghost edit" type="button">切換</button></div>
        ${timeNote ? `<p class="gate-note">${timeNote}</p>` : ''}
        ${needReview ? `<p class="gate-note">${icon.lock} 先逐題檢討完第一次測驗，才能開始複習</p>` : ''}
        <div class="btn-row">${buttons}</div>
      </div>`;
    box.querySelector('.edit').onclick = () => openStudentDialog(draw);
    const start = box.querySelector('[data-start]');
    if (!start.disabled) start.onclick = () => onStart(s, isReview);
    box.querySelector('[data-review]')?.addEventListener('click', () => onReview(s));
    stage.append(box);
  };
  draw();
  return { redraw: draw, stop: () => clearTimeout(wake) };
}

export function submitStateHTML(status) {
  const map = {
    sending: ['sending', '成績傳送中…'],
    sent: ['sent', `${icon.check} 成績已送出給老師`],
    queued: ['queued', `${icon.clock} 已加入排隊：目前送出的人較多或網路不穩，成績已存在這台裝置，會自動送出，送出時右下角會通知。可以先離開這個畫面`],
    error: ['error', `${icon.alert} 傳送失敗，請截圖這個畫面繳交`],
    disabled: ['disabled', `${icon.camera} 請截圖這個畫面繳交給老師`],
  };
  const [cls, text] = map[status] || map.disabled;
  return `<div class="submit-state ${cls}" role="status">${text}</div>`;
}

export function stampHTML(s, title, stamp) {
  return `<div class="stamp-card"><b>${esc(title)} 成績單</b>
    <span>${esc(studentLabel(s))}</span><span class="muted">完成時間：${esc(stamp)}</span></div>`;
}
