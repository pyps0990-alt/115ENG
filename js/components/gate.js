// 測驗前關卡：確認學生基本資料，顯示規則與開始按鈕
import { store } from '../storage.js';
import { esc, confirmDialog } from '../util.js';
import { icon } from '../icons.js';
import { fmtWhen } from '../remote-config.js';
import { mountInlineForm, openStudentDialog, studentLabel } from '../student.js';
import { SCRIPT_URL } from '../config.js';
import { PASS } from '../types.js';

// review()：做過正式測驗了嗎；reviewed()：檢討完了嗎。
// 做過但還沒檢討：只能先檢討，「開始複習」鎖住；檢討完才能複習。
// resume()：回傳 { label, onResume(student), discard() } 代表有做到一半的測驗，沒有就回傳 null
// total：計分的總分（題數）；integer：每題只有 1 分或 0 分（課文理解、段考），過關分數用整數題數表示
export function testGate(stage, { eyebrow = '', rules = [], best, review = false, reviewed = true, retake = false, timeWindow, onStart, onReview, resume }) {
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
    // 做過正式測驗但還沒通過：需要補考（重新做正式測驗，直到總分達標）
    const needRetake = !isReview && (typeof retake === 'function' ? retake() : retake);
    // 開放時段：還沒開放不能做；截止後不能做正式測驗，做過的人仍可檢討、複習
    const win = timeWindow ? timeWindow() : { state: 'open' };
    clearTimeout(wake);
    if (win.state === 'before' && win.openAt - Date.now() < 86400000) wake = setTimeout(draw, win.openAt - Date.now() + 500);
    let timeNote = '';
    if (win.state === 'open' && win.closeAt) timeNote = `${icon.clock} ${win.extended ? '老師開放你補作到' : '開放到'} ${fmtWhen(win.closeAt)}`;
    let buttons = needRetake
      ? `<button class="btn primary" type="button" data-start>${icon.play} 開始補考</button>${onReview ? `<button class="btn ghost" type="button" data-review>${icon.bulb} 看上次的檢討</button>` : ''}`
      : `<button class="btn primary" type="button" data-start>${icon.play} 開始測驗</button>`;
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
    const rs = typeof resume === 'function' && win.state === 'open' && !needReview ? resume() : null;
    // 一句話說明這次要做什麼；詳細規則收在下面，第一次進來的人預設展開
    // 及格線是老師設定的（PASS 在 js/types.js）：只講百分比；部分給分的題型換算成題數會出現小數，反而看不懂
    const passText = `老師設定的及格線是 <b>${PASS}%</b>`;
    const lead = rs ? `你有一份做到一半的測驗（${rs.label}），可以接著做，也可以重新開始。`
      : needReview ? '先逐題檢討完第一次測驗，才能開始複習。'
      : isReview ? '你已經通過這個單元，這次是複習，成績會標記為複習送給老師。'
      : needRetake ? `上次${bestNow != null ? ` <b>${bestNow}%</b>，還差 <b>${Math.max(0, PASS - bestNow)}%</b>` : ' 還沒通過'}。這次重新做一次：${passText}，達到就通過，沒有次數限制。`
      : `${passText}，達到就通過；沒通過可以一直補考。`;
    const firstTime = bestNow == null && !isReview && !needRetake;
    if (rs) {
      buttons = `<button class="btn primary" type="button" data-resume>${icon.play} 繼續上次 · ${esc(rs.label)}</button><button class="btn" type="button" data-start>重新開始</button>`;
    }
    const box = document.createElement('div');
    box.className = 'gate';
    box.innerHTML = `<div class="card gate-card">
        ${(() => { const tag = [eyebrow, isReview ? '複習' : needRetake ? '補考' : ''].filter(Boolean).join(' · '); return tag ? `<div class="eyebrow">${esc(tag)}</div>` : ''; })()}
        <p class="gate-lead">${lead}</p>
        ${bestNow != null ? `<div class="best-line">${icon.trophy} 你的最佳成績 <b>${bestNow}%</b></div>` : ''}
        ${timeNote ? `<p class="gate-note">${timeNote}</p>` : ''}
        <div class="btn-row">${buttons}</div>
        <p class="who-line">以 <b>${esc(s.name)}</b>（${esc(s.cls)} 班 ${esc(s.seat)} 號）的身分作答 <button class="link-btn edit" type="button">不是我？切換</button></p>
        <details class="gate-rules"${firstTime ? ' open' : ''}><summary>測驗規則</summary>
          <ul class="rules">${rules.map((r) => `<li>${r}</li>`).join('')}
            <li>${SCRIPT_URL ? '完成後成績會自動傳送給老師' : '完成後請截圖成績單繳交給老師'}</li></ul></details>
      </div>`;
    box.querySelector('.edit').onclick = () => openStudentDialog(draw);
    const start = box.querySelector('[data-start]');
    if (!start.disabled) {
      start.onclick = async () => {
        // 有做到一半的進度時，重新開始會捨棄它：先確認
        if (rs && !(await confirmDialog({ title: '重新開始？', body: '做到一半的進度會被捨棄，這次要重新做一份新的。', ok: '重新開始', cancel: '繼續上次', danger: true }))) return;
        if (rs) rs.discard();
        onStart(s, isReview);
      };
    }
    box.querySelector('[data-resume]')?.addEventListener('click', () => rs.onResume(s));
    box.querySelector('[data-review]')?.addEventListener('click', () => onReview(s));
    stage.append(box);
  };
  draw();
  return { redraw: draw, stop: () => clearTimeout(wake) };
}

export function submitStateHTML(status) {
  const map = {
    sending: ['sending', '<span class="spinner sm"></span>成績傳送中…'],
    sent: ['sent', `${icon.check} 成績已送出給老師`],
    pending: ['queued', `${icon.clock} 成績已存在這台裝置，正在送給老師。可以先離開，送出後右下角會通知`],
    queued: ['queued', `${icon.clock} 成績已存在這台裝置，網路恢復後自動送出。可以先離開`],
    error: ['error', `${icon.alert} 還沒送出：成績已存在這台裝置，可以按「立即重送」，或截圖這個畫面給老師`],
    disabled: ['disabled', `${icon.camera} 請截圖這個畫面繳交給老師`],
  };
  const [cls, text] = map[status] || map.disabled;
  const resend = cls === 'queued' || cls === 'error' ? `<button class="btn small${cls === 'error' ? ' primary' : ''}" type="button" data-resend>立即重送</button>` : '';
  return `<div class="submit-state ${cls}"><span>${text}</span>${resend}</div>`;
}

export function stampHTML(s, title, stamp) {
  return `<div class="stamp-card"><b>${esc(title)} 成績單</b>
    <span>${esc(studentLabel(s))}</span><span class="muted">完成時間：${esc(stamp)}</span></div>`;
}
