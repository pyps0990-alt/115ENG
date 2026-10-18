// 部署 Apps Script（apps-script/ 資料夾）後，把 Web App 網址貼在這裡（結尾是 /exec）。
// 留空字串時：網站使用 data/config.default.json 的設定，正式測驗只顯示成績單、不回傳。
// 成績怎麼送：交卷送到伺服器計分（Cloud Function functions/index.js）：伺服器依題庫重算分數、寫進 Firestore、轉送 Apps Script 試算表。
// 學生的瀏覽器不能直接寫成績（firestore.rules）。伺服器連不到時（重試 3 次）才改送 Apps Script 當備援，試算表會標記「未經伺服器計分」。
export const SUBMIT_URL = 'https://asia-east1-eng-3385e.cloudfunctions.net/submit';

export const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbw1KgAc6VsJkFM-ADUJY3NHWt4Y4KYDlUjppRlzKB__HRHEwPzgxfK0GXkMKaF9x1Ny/exec';

// 中文網頁字型（Noto Sans TC，Google Fonts）：頁面載完後才在背景載入。想完全不下載中文字型、只用裝置內建字型，改成 false。
export const CJK_WEBFONT = true;

// 即時在線人數與交卷健康度（老師的 monitor.html）用的 Firebase Realtime Database 網址。
// 在 Firebase 主控台建立 Realtime Database 後，把「資料」頁上方的網址貼在這裡；留空字串＝不啟用（網站照常運作）。
// Firebase App Check（Fraud Defense／reCAPTCHA Enterprise 網站金鑰，公開的、可以放在這裡）：確認連到 Firebase 的請求真的來自這個網站，
// 擋掉有人寫程式直接灌資料。留空字串＝不啟用。啟用步驟見 docs/security.md
export const APP_CHECK_SITE_KEY = '6LcJ1fQtAAAAAKLB3e-tO1aRJ2wGkJu9RJaa40oL';

export const RTDB_URL = 'https://eng-3385e-default-rtdb.asia-southeast1.firebasedatabase.app';
