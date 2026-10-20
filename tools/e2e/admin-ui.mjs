// 新版後台（以單元為中心）的測試操作：等清單載入、打開單元的分頁、改「顯示在學生首頁」、按儲存列、確認對話框
// 舊測試原本操作的是「設定」分頁裡的單元表格（#units），新版把它藏起來，改用這些操作
import { sleep } from './harness.mjs';

export async function adminReady(p, timeout = 15000) {
  await p.waitForSelector('.u-row[data-unit]', { timeout, state: 'attached' }); // 手機版清單收起來時也算
}
export async function openUnit(p, id, tab = '') {
  await p.evaluate((h) => { location.hash = h; }, `#unit/${id}${tab ? '/' + tab : ''}`);
  await p.waitForFunction(([u, t]) => window.SH && SH.view === 'unit' && SH.unit === u && (!t || SH.tab === t), [id, tab], { timeout: 8000 });
  await sleep(150);
}
export async function setVisible(p, id, on) {
  await openUnit(p, id, 'settings');
  const cb = p.locator('#us-form [data-us-k="visible"]');
  // 開關的 input 是透明的，畫面捲動後座標點擊可能點到別的東西：直接觸發它的 click（跟使用者點開關一樣會送出 change）
  try { await cb.waitFor({ state: 'attached', timeout: 4000 }); if ((await cb.isChecked()) !== on) await cb.evaluate((el) => el.click()); if ((await cb.isChecked()) !== on) throw new Error('開關沒有切換'); }
  catch (e) {
    const st = await p.evaluate(() => ({ hash: location.hash, view: SH.view, unit: SH.unit, tab: SH.tab, ask: !!document.querySelector('dialog.ask[open]'), inert: !!document.querySelector('#us-form').closest('[inert]'), msg: document.getElementById('msg').textContent, checked: document.querySelector('#us-form [data-us-k="visible"]')?.checked }));
    throw new Error(e.message.split(/\n/)[0] + ' ' + JSON.stringify(st));
  }
}
export async function save(p) { await p.click('#savebar-save'); }
export async function confirmAsk(p) { await p.click('dialog.ask [data-a="1"]'); }
// 打開單元的「題目」分頁並進入貼上／編輯模式（匯入工具列才會出現）
export async function openImport(p, id) {
  await openUnit(p, id, 'content');
  // 已經有題目：按「編輯題目」；還沒有：按「貼上文字」
  await p.waitForSelector('[data-uc="edit"], [data-uc="paste"]', { timeout: 8000 });
  await p.locator('[data-uc="edit"], [data-uc="paste"]').first().click();
  await p.waitForSelector('.uc-editbar', { timeout: 8000 });
  await sleep(300);
}
