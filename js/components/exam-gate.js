// 正式測驗前的關卡：檢查老師是否開放 → 確認學生基本資料 → 顯示規則與開始按鈕。
import { store } from '../storage.js';
import { esc } from '../util.js';
import { icon } from '../icons.js';
import { mountInlineForm, openStudentDialog, studentLabel } from '../student.js';
import { SCRIPT_URL } from '../config.js';

export function examGate(stage, ctx, { count, rules, onStart }) {
  const st = ctx.exam;
  if (!st.open) {
    stage.innerHTML = `<div class="gate"><div class="card lock-card"><div class="big">🔒</div>
      <h2>正式測驗尚未開放</h2><p class="muted">${esc(st.reason)}</p>
      <div class="btn-row center"><button class="btn" type="button" data-practice>先去練習</button></div></div></div>`;
    stage.querySelector('[data-practice]').onclick = () => ctx.go(ctx.unit.type === 'vocab' ? 'flashcards' : 'practice');
    return;
  }
  const draw = () => {
    stage.innerHTML = '';
    const s = store.student();
    if (!s) {
      const wrap = document.createElement('div');
      wrap.className = 'gate';
      stage.append(wrap);
      mountInlineForm(wrap, { title: '正式測驗前，請先填寫基本資料', desc: '成績會依這些資料送給老師，請確認正確。', button: '下一步', onSave: draw });
      return;
    }
    const box = document.createElement('div');
    box.className = 'gate';
    box.innerHTML = `<div class="card">
        <div><div class="eyebrow">Official Test</div><h2>${esc(ctx.unit.title)} 正式測驗</h2></div>
        <div class="who">${icon.user}<span>${esc(studentLabel(s))}</span><button class="btn small ghost edit" type="button">修改</button></div>
        <ul class="rules">
          <li>共 <b>${count}</b> 題${rules ? `，${esc(rules)}` : ''}</li>
          <li>作答過程不會顯示對錯，交卷後才公布成績與解答</li>
          <li>${SCRIPT_URL ? '交卷後成績會自動傳送給老師' : '交卷後請截圖成績單繳交給老師'}</li>
          ${st.until ? `<li>開放至 ${esc(st.until)}</li>` : ''}
        </ul>
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
    sent: ['sent', '✓ 成績已送出給老師'],
    error: ['error', '⚠ 傳送失敗，請截圖這個畫面繳交'],
    disabled: ['disabled', '📸 請截圖這個畫面繳交給老師'],
  };
  const [cls, text] = map[status] || map.disabled;
  return `<div class="submit-state ${cls}" role="status">${text}</div>`;
}

export function stampHTML(s, unitTitle, stamp) {
  return `<div class="stamp-card"><b>${esc(unitTitle)} 正式測驗成績單</b>
    <span>${esc(studentLabel(s))}</span><span class="muted">交卷時間：${esc(stamp)}</span></div>`;
}
