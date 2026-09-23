// 測驗前關卡：確認學生基本資料，顯示規則與開始按鈕
import { store } from '../storage.js';
import { esc } from '../util.js';
import { icon } from '../icons.js';
import { mountInlineForm, openStudentDialog, studentLabel } from '../student.js';
import { SCRIPT_URL } from '../config.js';

export function testGate(stage, { eyebrow, title, rules = [], best, onStart }) {
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
    const box = document.createElement('div');
    box.className = 'gate';
    box.innerHTML = `<div class="card gate-card">
        <div><div class="eyebrow">${esc(eyebrow)}</div><h2>${esc(title)}</h2></div>
        <ul class="rules">${rules.map((r) => `<li>${r}</li>`).join('')}
          <li>${SCRIPT_URL ? '完成後成績會自動傳送給老師' : '完成後請截圖成績單繳交給老師'}</li></ul>
        ${best != null ? `<div class="best-line">${icon.trophy} 你的最佳成績 <b>${best}%</b></div>` : ''}
        <div class="who">${icon.user}<span>${esc(studentLabel(s))}</span><button class="btn small ghost edit" type="button">修改</button></div>
        <div class="btn-row"><button class="btn primary" type="button" data-start>${icon.play} 開始測驗</button></div>
      </div>`;
    box.querySelector('.edit').onclick = () => openStudentDialog(draw);
    box.querySelector('[data-start]').onclick = () => onStart(s);
    stage.append(box);
  };
  draw();
}

export function submitStateHTML(status) {
  const map = {
    sending: ['sending', '成績傳送中…'],
    sent: ['sent', `${icon.check} 成績已送出給老師`],
    queued: ['queued', `${icon.clock} 目前沒有網路，成績已暫存在這台裝置，恢復連線後會自動補送`],
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
