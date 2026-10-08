// 部署 Apps Script（apps-script/ 資料夾）後，把 Web App 網址貼在這裡（結尾是 /exec）。
// 留空字串時：網站使用 data/config.default.json 的設定，正式測驗只顯示成績單、不回傳。
// 成績怎麼送：
//   'both'      Firestore 與 Apps Script 同時送（試算表即時更新；Apps Script 另外每 10 分鐘從 Firestore 補同步）
//   'firestore' 先送 Firestore（正本，離線也先存在裝置上）；5 秒內沒確認或被拒才改走 Apps Script 當備援。
//               試算表由 Apps Script 每 10 分鐘從 Firestore 同步（要先在 Apps Script 執行一次 installSyncTrigger）
export const SCORE_TRANSPORT = 'both';

export const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbw1KgAc6VsJkFM-ADUJY3NHWt4Y4KYDlUjppRlzKB__HRHEwPzgxfK0GXkMKaF9x1Ny/exec';

// 中文網頁字型（Noto Sans TC，Google Fonts）：頁面載完後才在背景載入。想完全不下載中文字型、只用裝置內建字型，改成 false。
export const CJK_WEBFONT = true;

// 即時在線人數與交卷健康度（老師的 monitor.html）用的 Firebase Realtime Database 網址。
// 在 Firebase 主控台建立 Realtime Database 後，把「資料」頁上方的網址貼在這裡；留空字串＝不啟用（網站照常運作）。
export const RTDB_URL = 'https://eng-3385e-default-rtdb.asia-southeast1.firebasedatabase.app';
