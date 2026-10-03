# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **學生（高三，Book 5）**：不登入，只填班級、座號、姓名；做單字片語、課文理解、句型練習。裝置包含手機、平板、電腦，三者都要能順利使用。
- **老師**：用 Google 帳號登入後台（`admin.html`），新增單元、匯入題目、控制學生看得到哪些單元、查看成績與作答明細。主要使用平板與電腦（後台需兼顧觸控操作）。

## Product Purpose

B5 Practice 是高三英文 Book 5 的線上測驗網站。學生做完整份測驗後成績自動送到老師的 Google 試算表；正式測驗達 65% 才算通過，未通過可無限補考，通過後才進入檢討與複習。

## Positioning

- 網站沒有內建題庫，所有單元與題目由老師自己在後台匯入（含各題型格式說明與 AI 出題提示詞）。
- 單字片語三段（基礎、進階、精熟）按一次連續做完，最後一張總成績單。
- 成績免登入、離線補送，自動進 Google 試算表（總表、班級分頁、逐題明細）。

## Operating Context

- 學生不登入；成績經 Apps Script 寫入 Google 試算表，內容同步到 Firestore。
- 部署在 Firebase；部署時 `tools/stamp-version.mjs` 產生 `version.json`，開著的頁面自動更新（學生考試中不打斷）。
- 靜態網頁，以 `fetch` 讀 JSON；本機需用網頁伺服器預覽。

## Capabilities and Constraints

- 三種內容：單字片語測驗、課文理解、句型練習。
- 及格線 `PASS = 65%`（`js/types.js`）；補考成績在試算表標「補考 ·」，成績單記最高分。
- 答錯不只靠顏色（紅色加 ✗）。
- 中文字型延後載入，英文字型自行託管（`fonts/`）。
- 介面語言為繁體中文，題目內容為英文。

## Brand Commitments

名稱：B5 Practice。現有配色（白底、深藍 `#1E3A8A`、琥珀 `#F59E0B`、錯誤紅 `#DC2626`）僅是目前實作，使用者確認可調整，不是綁定規範。

## Evidence on Hand

無內建題庫、無學生見證或使用數據；未來工作不得捏造。

## Product Principles

1. 學生零摩擦：不登入、少步驟、考試中不被打斷。
2. 老師掌控內容：題目、單元可見性、測驗段數都由老師決定。
3. 成績可信：自動記錄、可補送、可逐題檢視。
4. 練習導向：未通過可補考，通過後才進入檢討，不靠顏色單獨傳達對錯。

## Accessibility & Inclusion

答對／答錯需有顏色以外的提示；英文閱讀使用可讀性高的字型（Atkinson Hyperlegible）。
