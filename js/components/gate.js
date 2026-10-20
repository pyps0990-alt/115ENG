// 測驗前關卡：確認學生基本資料，顯示規則與開始按鈕
import { mountDeadline } from './status.js';
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
// total：計分的總分（題數）；integer：每題只有 1 分或 0 分（課文理解），過關分數用整數題數表示
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
    // 24 小時內截止：改用跟作答中一樣的醒目方塊（剩不到 1 小時變紅）
    const soon = win.state === 'open' && win.closeAt && win.closeAt - Date.now() <= 86400000;
    if (soon) timeNote = '';
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
      timeNote = `${icon.clock} 已於 ${fmtWhen(win.closeAt)} 截止，不能再做正式測驗。需要補作請跟老師說班級、座號和單元名稱，老師開放後重新整理這頁就能作答`;
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
    // 這個單元走到哪：正式測驗 → 檢討錯題 → 複習（完成的打勾、目前這步框起來）
    const passed = !!isReview;
    const steps = [
      ['正式測驗', passed ? (bestNow != null ? `通過 ${bestNow}%` : '已通過') : bestNow != null ? `最高 ${bestNow}%，還沒通過` : `${PASS}% 通過`, passed ? 'done' : 'now'],
      ...(onReview ? [['檢討錯題', passed && isReviewed ? '完成' : passed ? '還沒檢討' : '通過後開放', passed && isReviewed ? 'done' : needReview ? 'now' : '']] : []),
      ['複習', passed && (isReviewed || !onReview) ? '隨時可以練' : onReview ? '檢討完開放' : '通過後開放', passed && (isReviewed || !onReview) ? 'now' : ''],
    ];
    const stepsHTML = `<ol class="unit-steps" aria-label="這個單元的進度">${steps.map(([t, sub, st]) => `<li class="${st}"${st === 'now' ? ' aria-current="step"' : ''}><b>${t}</b><small>${esc(sub)}</small></li>`).join('')}</ol>`;
    const box = document.createElement('div');
    box.className = 'gate';
    box.innerHTML = `<div class="card gate-card">
        ${stepsHTML}
        ${(() => { const tag = [eyebrow, isReview ? '複習' : needRetake ? '補考' : ''].filter(Boolean).join(' · '); return tag ? `<div class="eyebrow">${esc(tag)}</div>` : ''; })()}
        <p class="gate-lead">${lead}</p>
        ${bestNow != null ? `<div class="best-line">${icon.trophy} 你的最佳成績 <b>${bestNow}%</b></div>` : ''}
        ${timeNote ? `<p class="gate-note">${timeNote}</p>` : ''}
        <div class="btn-row">${buttons}${soon ? '<span class="st-box st-deadline" data-deadline hidden></span>' : ''}</div>
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
    if (soon) mountDeadline(box, win);
  };
  draw();
  return { redraw: draw, stop: () => clearTimeout(wake) };
}

// 成績送出狀態：結果頁最上方的大狀態卡（圖示＋一句結論＋說明＋必要時「立即重送」）
export function submitStateHTML(status) {
  const map = {
    sending: ['sending', '<span class="spinner sm"></span>', '成績送出中', '大約 1 到 3 秒，請先不要關掉這一頁。'],
    sent: ['sent', icon.check, '成績已送到老師那裡', '可以放心離開這一頁。'],
    pending: ['queued', icon.clock, '成績先存在這台裝置', '正在送給老師，可以先離開，送出後右下角會通知。'],
    queued: ['queued', icon.clock, '成績先存在這台裝置', '網路恢復後會自動送給老師，可以先離開。請不要清除瀏覽器資料。'],
    error: ['error', icon.alert, '成績還沒送出', '成績已存在這台裝置。請按「立即重送」，或截圖這個畫面給老師。'],
    disabled: ['disabled', icon.camera, '請截圖這個畫面繳交給老師', ''],
    volatile: ['error', icon.alert, '成績還沒送出', '這台裝置不能暫存成績：請先不要關掉或離開這一頁，等顯示「成績已送到老師那裡」再離開。'],
    rejected: ['error', icon.alert, '老師的伺服器拒收了這份成績', '請截圖這個畫面給老師（「我的成績」頁也會列出來）。'],
  };
  const [cls, ic, title, desc] = map[status] || map.disabled;
  const resend = status !== 'rejected' && (cls === 'queued' || cls === 'error') ? `<button class="btn small${cls === 'error' ? ' primary' : ''}" type="button" data-resend>立即重送</button>` : '';
  return `<div class="submit-state ${cls}"><span class="ss-ic" aria-hidden="true">${ic}</span><span class="ss-t"><b>${title}</b>${desc ? `<small>${desc}</small>` : ''}</span>${resend}</div>`;
}

export function stampHTML(s, title, stamp) {
  return `<div class="stamp-card"><b>${esc(title)} 成績單</b>
    <span>${esc(studentLabel(s))}</span><span class="muted">完成時間：${esc(stamp)}</span></div>`;
}
