// 偵測網站有沒有部署新版：部署時 tools/stamp-version.mjs 會依所有網站檔案的內容算出版本碼，寫進 version.json。
// 頁面載入時記下版本碼；之後回到畫面、取得焦點、或每 5 分鐘檢查一次，版本碼變了就提示更新。
// 學生端（auto: true）：沒有在考試時，換頁的瞬間自動重新載入成新版；考試中不打斷，考完換頁才更新。
// 老師後台（auto: false）：可能有還沒儲存的編輯，只顯示提示列，由老師按「立即更新」。
let started = false;

export function watchForUpdate({ auto = true, isBusy = () => false } = {}) {
  if (started) return;
  started = true;
  let base = null;
  let found = false;
  let checking = false;
  const get = () => fetch(`version.json?t=${Date.now()}`, { cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : null)).then((j) => (j && j.v) || null).catch(() => null);

  const style = document.createElement('style');
  style.textContent = '.update-bar{position:fixed;left:50%;bottom:calc(16px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);z-index:300;display:flex;align-items:center;gap:12px;max-width:calc(100vw - 24px);padding:10px 12px 10px 16px;border-radius:999px;background:#1E3A8A;color:#fff;font:600 .92rem/1.3 system-ui,-apple-system,"PingFang TC","Noto Sans TC","Microsoft JhengHei",sans-serif;box-shadow:0 12px 32px rgba(15,23,42,.28);animation:update-in .3s ease}.update-bar button{flex:none;min-height:36px;padding:0 16px;border:0;border-radius:999px;background:#F59E0B;color:#1E3A8A;font:inherit;font-weight:800;cursor:pointer}@keyframes update-in{from{opacity:0;transform:translate(-50%,12px)}}@media (prefers-reduced-motion:reduce){.update-bar{animation:none}}';
  const showBar = () => {
    if (document.querySelector('.update-bar')) return;
    document.head.append(style);
    const bar = document.createElement('div');
    bar.className = 'update-bar';
    bar.setAttribute('role', 'status');
    bar.innerHTML = `<span>${auto ? '有新版本了' : '有新版本了（先儲存目前的編輯）'}</span><button type="button">立即更新</button>`;
    bar.querySelector('button').onclick = () => location.reload();
    document.body.append(bar);
  };

  const check = async () => {
    if (checking || document.visibilityState !== 'visible') return;
    checking = true;
    try {
      const v = await get();
      if (!v) return;
      if (base === null) { base = v; return; }
      if (v !== base && !found) { found = true; showBar(); }
    } finally { checking = false; }
  };

  // 學生端：有新版時，下一次換頁（不在考試中）直接載入新版，學生不用做任何事
  if (auto) {
    window.addEventListener('hashchange', () => {
      if (found && !isBusy()) location.reload();
    });
    // 考試結束、回到首頁等閒置時，也順便更新（只在畫面在背景時，使用者看不到重新載入）
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden' && found && !isBusy()) location.reload();
    });
  }
  check();
  document.addEventListener('visibilitychange', check);
  window.addEventListener('focus', check);
  setInterval(check, 5 * 60 * 1000);
}
