// 部署 Apps Script（apps-script/ 資料夾）後，把 Web App 網址貼在這裡（結尾是 /exec）。
// 留空字串時：網站使用 data/config.default.json 的設定，正式測驗只顯示成績單、不回傳。
export const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbw1KgAc6VsJkFM-ADUJY3NHWt4Y4KYDlUjppRlzKB__HRHEwPzgxfK0GXkMKaF9x1Ny/exec';

// 中文網頁字型（Noto Sans TC，Google Fonts）：頁面載完後才在背景載入。想完全不下載中文字型、只用裝置內建字型，改成 false。
export const CJK_WEBFONT = true;

// 即時在線人數與交卷健康度（老師的 monitor.html）用的 Firebase Realtime Database 網址。
// 在 Firebase 主控台建立 Realtime Database 後，把「資料」頁上方的網址貼在這裡；留空字串＝不啟用（網站照常運作）。
export const RTDB_URL = 'https://eng-3385e-default-rtdb.asia-southeast1.firebasedatabase.app';
