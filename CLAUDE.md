# B5 Practice 專案指令

產品背景、使用者與設計原則見 `PRODUCT.md`。

## 介面文字

- Avoid unnecessary secondary labels and descriptions. Let the layout do the explaining.
- 不加眉標（eyebrow）、副標、說明小字、圖例或規則清單來解釋畫面；用版面、位置、圖示、顏色與狀態本身讓人看懂。
- 同一個資訊在同一個畫面只出現一次（例如名稱、狀態、截止時間、題號不要重複寫）。
- 拿掉的是「解釋」，不是「資訊」：題數、字數、分段、截止時間、身分、班級座號這類真實資訊要保留，用數字卡、分段卡、標籤等版面呈現，不寫成說明句或規則清單；畫面不能因此變空。
- 文字只用在會影響下一步的地方：按鈕、目前狀態、錯誤訊息與怎麼修。
- 例外：老師後台的新手導覽（tour）與錯誤提示可以用文字一步步說明。

## 開發與部署

- 回覆與介面文字一律用繁體中文。
- 推上 `main` 會自動部署 Firebase Hosting 與 Firestore 規則（`.github/workflows/deploy.yml`）。
- 推之前先跑 `node tools/module-graph.mjs --check`（`index.html` 的 modulepreload 清單不對，部署會失敗）。
- 改了 `apps-script/Admin.html` 要跑 `python3 tools/build-admin.py` 產生 `admin.html`。
- 測試在 `tools/e2e/`（例如 `node tools/e2e/nav.mjs`），用假的 Firebase 與 Apps Script。
- 版本號：根目錄 `VERSION` 是 vX.Y，部署次數自動接成 vX.Y.Z。
