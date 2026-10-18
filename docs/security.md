# 網站安全性說明

2026-10-18 全面檢查後整理。改規則、加外部服務之前先看這份。

## 已經做的防護

| 項目 | 在哪裡 |
|---|---|
| Firestore 規則：欄位白名單、型別長度、作答紀錄只能新增、時間用伺服器時間 | `firestore.rules` |
| 老師權限：已驗證的 Google 帳號＋老師名單（名單只由 Apps Script 同步） | `firestore.rules` `isStaff`、`Code.gs` `assertTeacher_` |
| 交卷次數計數器：每筆成績同一批加 1，整學期上限 3000 | `firestore.rules` `bumpsQuota`、`js/firebase.js` |
| 成績核對：同步到試算表時用題庫核對，課文理解以伺服器重算為準；後台成績頁顯示核對結果 | `Code.gs` `checkAttempt_`、`getChecks` |
| 試算表公式注入防護 | `Code.gs` `cell_` |
| 內容安全政策（CSP，強制執行） | `firebase.json` |
| HSTS、nosniff、Referrer-Policy、Permissions-Policy | `firebase.json`（HSTS 由 Firebase Hosting 自動加上） |
| 錯誤分析引擎：金鑰驗證（常數時間比對）；本機版只聽 127.0.0.1 | `tools/brain/cloudrun/main.py` |

規則測試：`tools/e2e/rules.mjs`（檔頭有執行方式；模擬器需要 Java 11 以上）。改 `firestore.rules` 一定要先跑。

## 內容安全政策（CSP）

網站只能從下列來源載入程式、連線、嵌入：

- 程式：自己、`www.gstatic.com`（Firebase）、`apis.google.com`（Google 登入）、`*.firebasedatabase.app`（即時在線統計的備用連線）、reCAPTCHA
- 連線：`*.googleapis.com`、reCAPTCHA（`www.google.com/recaptcha/`）、Apps Script、`*.firebasedatabase.app`（含 wss）、`*.run.app`（錯誤分析引擎）、`http://127.0.0.1:8765`（本機錯誤分析引擎）
- 嵌入框：Google 登入、`*.firebaseapp.com`、reCAPTCHA
- 本網站只能被自己和 Google Sites 嵌入

**加新的外部服務（字型、圖表程式庫、API）時，要同時改 `firebase.json` 的 `Content-Security-Policy`，否則會被瀏覽器擋掉。**
不要加 `upgrade-insecure-requests`：會讓本機錯誤分析引擎（http://127.0.0.1）連不到。

## App Check（程式已經寫好，等金鑰）

作用：確認連到 Firestore／Realtime Database 的請求真的來自這個網站，擋掉有人寫程式直接灌資料。
Apps Script 用專案擁有者權限讀寫 Firestore，不受影響。

1. 到 https://www.google.com/recaptcha/admin/create 建立 **reCAPTCHA v3** 金鑰，網域填 `eng-3385e.web.app` 和 `eng-3385e.firebaseapp.com`。
2. Firebase 主控台 → App Check → 應用程式 → 網頁應用程式 → 選 reCAPTCHA v3，貼上「密鑰（secret key）」。
3. 把「網站金鑰（site key）」貼到 `js/config.js` 的 `APP_CHECK_SITE_KEY`，部署網站。
4. **先不要按「強制執行」**。觀察主控台 App Check 的指標 1～2 週，確認幾乎所有請求都是「已驗證」（學校網路有沒有擋 reCAPTCHA）。
5. 確認沒問題後，Firestore 與 Realtime Database 再各自按「強制執行」。

注意：強制執行後，連不到 reCAPTCHA 的裝置會無法登入（登入要讀 Firestore）；成績仍會送到 Apps Script 試算表。

## 已知、尚未處理的風險

- **冒名**：學生身分只靠班級＋座號＋姓名，同學可以冒充別人（看紀錄、代交卷）。解法：老師發個人密碼。
- **偽造分數**：分數由瀏覽器計算。試算表那份有核對與標記，但 Firestore 那份照存學生送來的分數。根本解法：伺服器計分。
- **答案公開**：題目與答案在公開設定裡，開發者工具看得到。根本解法：伺服器計分、答案不送到學生端。
- **即時在線統計可以被灌**：Realtime Database 的 presence／stats 不需登入就能寫，只影響監控頁的數字。
