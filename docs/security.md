# 網站安全性說明

2026-10-18 全面檢查後整理。改規則、加外部服務之前先看這份。

## 已經做的防護

| 項目 | 在哪裡 |
|---|---|
| Firestore 規則：欄位白名單、型別長度、作答紀錄只能新增、時間用伺服器時間 | `firestore.rules` |
| 老師權限：已驗證的 Google 帳號＋老師名單（名單只由 Apps Script 同步） | `firestore.rules` `isStaff`、`Code.gs` `assertTeacher_` |
| **伺服器計分**：學生交卷只送作答內容，伺服器依題庫重新判斷對錯、重算分數後寫入；學生的瀏覽器不能寫成績 | `functions/index.js`（Cloud Function）、`js/grade.js`（和網站同一套判斷）、`firestore.rules` |
| 交卷限頻：同一位學生 10 分鐘最多 20 筆 | `functions/index.js` |
| 作答誠信：禁止翻譯、複製貼上；默默記錄離開作答畫面 | `js/integrity.js` |
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

## App Check（2026-10-18 啟用，尚未強制執行）

目前狀態：網站金鑰 `6LcJ1fQtAAAAAKLB3e-tO1aRJ2wGkJu9RJaa40oL`（Fraud Defense，分數制）、權杖存留時間 24 小時、分數門檻 0.5；Firestore、Realtime Database、Authentication 都還是「未強制執行」。
預定 2026-11-01 前後看 App Check 指標，已驗證比例很高再強制執行。

踩過的坑：App Check 設定頁要貼「網站金鑰」，不是金鑰的舊版密鑰（legacy secret key）；貼錯時每個請求都回 403。Fraud Defense 金鑰頁的「後端」整合不用設定（由 App Check 代為評分）。
可以用 gcloud 檢查：`gcloud recaptcha keys list --project eng-3385e`，App Check 這邊的設定在 REST API `firebaseappcheck.googleapis.com/v1/projects/eng-3385e/apps/{appId}/recaptchaEnterpriseConfig`。

作用：確認連到 Firestore／Realtime Database 的請求真的來自這個網站，擋掉有人寫程式直接灌資料。
Apps Script 用專案擁有者權限讀寫 Firestore，不受影響。

1. 在 Google Cloud 主控台的 **Fraud Defense**（舊稱 reCAPTCHA Enterprise）建立網站金鑰（類型：網站），網域填 `eng-3385e.web.app` 和 `eng-3385e.firebaseapp.com`。
2. Firebase 主控台 → App Check → 應用程式 → 網頁應用程式 → 選 **reCAPTCHA Enterprise**，貼上網站金鑰（不需要密鑰），權杖存留時間用預設 1 小時。
3. 網站金鑰放在 `js/config.js` 的 `APP_CHECK_SITE_KEY`（程式用 `ReCaptchaEnterpriseProvider`），部署網站。
4. **先不要按「強制執行」**。觀察主控台 App Check 的指標 1～2 週，確認幾乎所有請求都是「已驗證」（學校網路有沒有擋 reCAPTCHA）。
5. 確認沒問題後，Firestore 與 Realtime Database 再各自按「強制執行」。

注意：強制執行後，連不到 reCAPTCHA 的裝置會無法登入（登入要讀 Firestore）；成績仍會送到 Apps Script 試算表。

## 已知、尚未處理的風險

- **冒名**：學生身分只靠班級＋座號＋姓名，同學可以冒充別人（看紀錄、代交卷）。解法：老師發個人密碼。
- **看答案**：題目與答案在公開設定裡，開發者工具看得到（伺服器計分擋得住改分數，擋不住先看答案再作答）。課文理解、句型可以改成交卷後才給答案。
- **即時在線統計可以被灌**：Realtime Database 的 presence／stats 不需登入就能寫，只影響監控頁的數字。

## 2026-10-18 的決定

老師決定**冒名目前選擇相信學生**，先不處理（成績會列入學期成績，所以保留以下做法備用）；偽造分數改用伺服器計分處理（見下一節）。

- 學生都有學校 Google 帳號：之後要防冒名，首選「用學校 Google 帳號登入」（Firebase Auth 的 Google 登入，規則比對帳號 email 與名單），不用另發代碼。
  搬家時 L1-2 等既有成績只能原樣複製，不能改分數。

## 伺服器計分（2026-10-18 上線）

- 交卷路線：網站 → Cloud Function `submit`（asia-east1）→ Firestore（班級路徑、學生帳本兩份）→ 轉送 Apps Script 試算表（帶 Firestore `private/fn` 的通關密語）。
- 伺服器連續 3 次連不上（例如學校網路擋掉）才改送 Apps Script 備援；試算表會標記「未經伺服器計分（學生端直接送出）」，Firestore 不會有這筆。
- 改判斷規則（題型、拼字比對、計分）時，`js/grade.js` 跟網站用同一套程式；先跑 `node tools/e2e/grade.mjs`。
- 部署：`npx firebase deploy --only functions`（predeploy 會把 `js/` 複製到 `functions/site/`）。改了 `js/` 裡的出題或判斷程式，網站和 functions 都要重新部署。
- 測試：`node tools/e2e/grade.mjs`（計分和網站一致、竄改無效）、`tools/e2e/submit-fn.mjs`（模擬器整合測試，檔頭有執行方式）、`node tools/e2e/submit-route.mjs`（交卷路線）。
