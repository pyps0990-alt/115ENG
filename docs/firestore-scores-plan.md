# 成績改為「先送 Firebase」計畫

狀態：計畫（尚未實作）。寫於 2026-10-06，預計寒假實作。
目標：學生交卷只依賴 Firestore，不再經過 Apps Script；Google 試算表改成從 Firestore 同步過去的副本。
不在範圍內：後台設定與題目的讀寫（另案）、AI 出題（維持 Apps Script）。

---

## 1. 現況（2026-10 上線版本）

學生交卷時同時走兩條路（`js/submit.js` 的 `submitScore`）：

| 路線 | 寫到哪裡 | 可靠度機制 |
|---|---|---|
| A. Apps Script | `doPost` → `receiveScore_` 寫進 `inbox` 分頁 → `drainBatch_` 整批寫進 `scores`、班級分頁、成績單、`details` | 裝置上的待送清單（`b5p:outbox`）、指數退避重送、`?action=check` 確認、attemptId 去重複、拒收紀錄（`b5p:rejected`）、存不了時改用記憶體 |
| B. Firestore | `js/firebase.js` 的 `saveScoreToFirestore`，同一筆寫兩份：`classes/{cls}/seats/{seat}/units/{unit}/attempts/{attemptId}` 與 `vault/{key}/attempts/{attemptId}` | 送出就不管；失敗只在主控台警告；快取在記憶體，關掉分頁就沒了 |

老師看成績：後台「成績」分頁呼叫 Apps Script `getScores`，讀的是試算表。

問題：
- A 每次往返 1～2 秒、閒置會「睡著」、Google 偶爾回錯誤網頁，全班交卷時要排隊（同時執行上限 30）。
- 兩條路互不知道對方的結果，Firestore 有、試算表沒有的成績不會被發現。

## 2. 目標架構

```
學生交卷 ──► Firestore（正本，離線也先存在裝置的 IndexedDB，連上網自動補送）
                │
                ├──► 老師後台「成績」：直接讀 Firestore（約 0.2 秒，即時）
                │
                └──► Apps Script 定時同步（每 5 分鐘＋後台「立即同步」按鈕）
                        └──► inbox → drainBatch_ → scores／班級分頁／成績單／details（沿用現有程式）
```

設計重點：
- **正本只有一份**：成績以 Firestore 為準，試算表晚幾分鐘或同步失敗都不會掉成績，重新同步即可。
- **沿用現有的整理程式**：同步程式把 Firestore 的紀錄轉成跟現在 `receiveScore_` 一樣的格式寫進 `inbox`，後面的 `drainBatch_`、成績單、核分（`checkAttempt_`）完全不用改。`drainBatch_` 已經用 attemptId 去除重複，兩條路並行時同一筆也只會記一次。
- **核分不擋成績**：`checkAttempt_` 在同步時執行，跟現在一樣只在試算表的 check 欄標記，不拒收。所以「伺服器拒收」基本上不會再發生。
- **不需要 Blaze 方案**：不用 Cloud Functions；同步由 Apps Script 的定時觸發器做。

## 3. 要改的地方

### 3.1 學生端（`js/firebase.js`、`js/submit.js`）

1. **Firestore 離線持久化**：`initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }), experimentalAutoDetectLongPolling: true })`。
   - 沒網路時寫入先存進 IndexedDB，重新整理、關掉再開都還在，連上網 SDK 自動補送。
   - IndexedDB 不能用（部分無痕模式）時 SDK 會退回記憶體快取：交卷畫面沿用現在的 `volatile` 提示（請學生等到已送出再離開）。
2. **交卷狀態以 Firestore 確認為準**：
   - `setDoc` 的 Promise 在伺服器確認寫入後才 resolve；等最多 5 秒（沿用 `SCREEN_WAIT_MS`）。
   - 確認了 → 「成績已送出」；還沒 → 「成績已存在這台裝置，網路恢復後自動送出」，背景用 `waitForPendingWrites` 等到送出後右下角通知（沿用 `score-sent` 事件）。
3. **只寫一份**：保留 `classes/.../attempts/{attemptId}`（同步與老師後台讀這份）；`vault/{key}/attempts/{attemptId}` 是學生登入時讀回自己紀錄用的，也要保留。兩份用 `writeBatch` 一起寫，要嘛都成功、要嘛都失敗（現在是兩次獨立的 `setDoc`）。
4. **重複送出**：文件 ID 是 attemptId，規則只允許 create。同一筆再寫一次會被規則拒絕（`permission-denied`），這時先 `getDoc` 確認已存在就當成功。
5. **傳送方式開關**：在 `js/config.js` 加 `SCORE_TRANSPORT = 'both' | 'firestore'`。
   - `both`：跟現在一樣兩條路都送（並行期）。
   - `firestore`：只送 Firestore；Firestore 回非暫時性錯誤（規則拒絕且確認不存在、帳本不存在）時，退回送 Apps Script 當備援。
6. **之後可刪除**：切換到 `firestore` 穩定一段時間後，刪掉 `b5p:outbox` 的待送清單與 `?action=check` 的確認邏輯（Firestore SDK 已經做了同樣的事）。拒收紀錄的畫面保留給備援路線用。

### 3.2 安全規則（`firestore.rules`）

現有 `validAttempt` 已檢查欄位、型別、長度、`createdAt == request.time`，班級路徑也已確認帳本的班級座號。補強：

- `d.score >= 0 && d.score <= d.total && d.total > 0 && d.total <= 200`。
- `d.unit` 必須是存在的單元：`exists(/databases/$(database)/documents/public/config)` 無法逐單元檢查，改在同步時由 `checkAttempt_` 標記，不在規則擋。
- 老師後台用 collection group 查詢讀成績，要加：
  ```
  match /{path=**}/attempts/{attemptId} {
    allow read: if isStaff();
  }
  ```
  （只開放讀，寫入規則維持在原本的路徑底下。）
- 限頻：規則無法計數，靠 `attemptId` 唯一＋帳本存在擋大部分濫用；異常大量寫入在同步報表裡看得到。

### 3.3 Apps Script 同步（`apps-script/Code.gs`）

新增 `syncFromFirestore()`：

1. 讀 Script Property `FS_SYNC_CURSOR`（上次同步到的 `createdAt`，ISO 字串；沒有就從部署當天開始）。
2. 用 Firestore REST `runQuery`，parent 設 `.../documents/classes`，`from: [{ collectionId: 'attempts', allDescendants: true }]`，條件 `createdAt > cursor − 2 分鐘`，依 `createdAt` 排序，每頁 300 筆。
   - 往回多抓 2 分鐘，避免時間差漏抓；重複的由 `drainBatch_` 用 attemptId 去除。
   - 需要在 Firebase 主控台為 `attempts` 的 `createdAt` 開啟 collection group 單一欄位索引（或寫進 `firestore.indexes.json` 的 `fieldOverrides`）。
3. 每筆轉成 `receiveScore_` 的輸入格式（欄位名稱相同：cls、seat、name、unit、unitTitle、level、mode、score、total、pct、basic、advanced、mastery、wrong、durationSec、clientTs、attemptId、details），呼叫抽出來的共用函式 `toInboxRow_(d)` 寫進 `inbox`。
   - 從 `receiveScore_` 把「組成一列＋寫進 inbox」那段抽成 `toInboxRow_`，`receiveScore_` 改成「限頻＋去重＋名單確認＋`toInboxRow_`」，兩邊共用，不會寫出兩套格式。
   - 名單確認：Firestore 的紀錄已經過規則確認帳本存在，同步時不用再查名單。
4. 處理完更新 `FS_SYNC_CURSOR` 為這批最後一筆的 `createdAt`，然後呼叫 `drainInbox_`。
5. 每次最多跑 4 分鐘（6 分鐘上限內），沒做完下次觸發器接著做。
6. 定時觸發器：每 5 分鐘一次（一天 288 次，每次通常幾秒，在一般帳號每天 90 分鐘的觸發器額度內）。
7. 後台 API 加 `syncNow`（老師按「立即同步」）與 `syncReport`：列出 Firestore 有、`scores` 沒有的 attemptId（反之亦然），並行期用來比對。

### 3.4 老師後台（`apps-script/Admin.html`）

- 「成績」分頁改成直接讀 Firestore（collection group 查詢，依班級、單元、時間篩選），即時顯示；保留「在試算表開啟」連結。
- 加「立即同步到試算表」按鈕與上次同步時間。
- 讀取量：每次查詢只讀篩選後的範圍，分頁讀取，避免一次讀全部（免費額度每天 5 萬次讀取）。

## 4. 上線步驟（每一步都可以單獨退回）

| 步驟 | 內容 | 退回方式 |
|---|---|---|
| 1 | 學生端：Firestore 持久化、`writeBatch`、交卷狀態以 Firestore 確認為準；`SCORE_TRANSPORT = 'both'` | 部署前一版網站 |
| 2 | Apps Script：抽出 `toInboxRow_`、加 `syncFromFirestore`、觸發器、`syncReport`；兩條路並行，資料自然去重 | 停用觸發器 |
| 3 | 並行至少 1～2 週，每天看 `syncReport`：Firestore 與 `scores` 的差異應為 0 | — |
| 4 | `SCORE_TRANSPORT = 'firestore'`；`doPost` 收件保留給舊版網頁與備援 | 改回 `'both'` 重新部署 |
| 5 | 老師後台「成績」改讀 Firestore、加立即同步 | 部署前一版 `admin.html` |
| 6 | 穩定後刪除待送清單與確認查詢的舊程式 | — |

## 5. 測試

- `tools/e2e/submit.mjs` 改寫：模擬 Firestore 線上確認、離線排隊後補送、規則拒絕且已存在（重複）、規則拒絕且不存在（退回 Apps Script）。
- `tools/e2e/gas-selftest.mjs` 加：假的 `runQuery` 回應 → `syncFromFirestore` 寫進 inbox → `drainBatch_` 後 `scores` 正確、重複的只記一次、cursor 往前推進、超過時間會停在中途下次接著做。
- 安全規則：用 Firebase 模擬器（`firebase emulators:start --only firestore`，需要 Java）寫規則測試：學生只能寫自己班級座號、不能改舊紀錄、分數超出範圍被拒、老師能用 collection group 讀、學生不能。
- 實機：iPhone Safari（含無痕）、Android Chrome、學校電腦；交卷途中切飛航模式、關掉分頁再開、兩個分頁同時開。

## 6. 風險與對策

| 風險 | 對策 |
|---|---|
| 無痕模式 IndexedDB 不能用 | SDK 退回記憶體；交卷畫面顯示 `volatile` 提示，離開前提醒（現有機制） |
| 學生開著舊版網頁（還在只送 Apps Script） | `doPost` 收件保留；網站已有自動更新提示 |
| 同步漏抓 | cursor 往回重疊 2 分鐘＋attemptId 去重；`syncReport` 每天比對 |
| 規則寫錯被濫寫或擋掉正常學生 | 先在模擬器測；並行期兩條路都送，擋掉的照樣進試算表 |
| 老師看試算表晚 5 分鐘 | 後台「成績」即時讀 Firestore；需要時按「立即同步」 |
| Firestore 免費額度 | 每次交卷寫 2 份文件；同步只讀新紀錄；後台分頁讀取。一所學校的用量遠低於每天 5 萬讀、2 萬寫 |

## 7. 待決定

1. 同步間隔：5 分鐘是否可以接受（或 10 分鐘）。
2. 步驟 4 之後，Apps Script 收件要保留多久（建議至少一學期，當作備援）。
3. 老師後台「成績」要哪些篩選與匯出（班級、單元、日期、只看需補考、匯出 CSV）。
