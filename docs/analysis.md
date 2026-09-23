# B5 Practice 網站分析與改造說明

## 1. 分析範圍

- 目標網站：`https://sites.google.com/nhsh.tp.edu.tw/b5practice/`（L1 VOC 等頁面）
- 開發環境的網路政策擋住了 `sites.google.com`（代理伺服器回傳 HTTP 403），所以沒辦法直接讀取頁面內容。分析依據的是使用者貼上的**首頁 HTML 原始碼**。
- 新網站的單字和文章目前都是**範例資料**，要等拿到課本內容後再替換。

## 2. 原網站現況

| 項目 | 觀察 |
| --- | --- |
| 導覽列 | 10 頁：Home、L2 Reading Comprehension、L2 Grammar in reading、L2 Cloze Test、L2 Cloze Test 2、L1 VOC、L1 Reading、L3 VOC、L3 VOC Part2、L4 Reading |
| 首頁 | 只有一個標題「B5 Practice」，沒有入口、說明或進度 |
| 排序 | L2 排在 L1 前面，課次順序混亂 |
| 拆頁 | 同一課被拆成好幾頁（VOC / VOC Part2、Cloze Test 1 / 2） |
| 內容形式 | 靠嵌入的檔案或表單，頁面本身不能互動、不能記錄成績 |

## 3. 改造需求（使用者指定）

1. **只保留兩種功能**：
   - **單字片語測驗**：基礎、進階、精熟三段**接續**，一次連續做完
   - **課文理解**：先讀文章，再做閱讀測驗
2. **閱讀測驗不可照抄文章**：題目和選項都要改寫，考的是理解，不是找字。
3. **配色**：`#FFFFFF` 背景、`#F4F6F9` 區塊、`#1E3A8A` 導覽列與標題、`#64748B` 內文、`#F59E0B` 答對與重要按鈕。
4. **老師用帳號控管、學生只填基本資料**（沿用前一版的需求）。

## 4. 新網站架構

### 4.1 單元對應

每一課固定有兩個單元，原本的網址也都有對應：

| 課次 | 單字片語 | 課文理解 | 原頁面 |
| --- | --- | --- | --- |
| L1 | `l1-voc` | `l1-reading` | L1 VOC、L1 Reading |
| L2 | `l2-voc` | `l2-reading`（舊網址 `l2-reading-comprehension` 會自動轉過去） | L2 Reading Comprehension；原本的 Grammar／Cloze 頁面依需求移除 |
| L3 | `l3-voc`（合併原本的 Part2，舊網址 `l3-voc-part2` 會自動轉過去） | `l3-reading` | L3 VOC、L3 VOC Part2 |
| L4 | `l4-voc` | `l4-reading` | L4 Reading |

### 4.2 單字片語：三段連續測驗

三個等級是**接續的**：學生按一次「開始測驗」，系統抽出 N 個單字片語（預設 10 個），**同一組字**依序連續考完三段，中間只有一張過場卡，不會回到選單。

| 段落 | 題型 | 考的能力 |
| --- | --- | --- |
| 1 基礎 | 英 → 中，四選一（可以聽發音） | 看到字認得意思 |
| 2 進階 | 中 → 英，四選一；例句填空，四選一（選項是其他字在例句中的形式，例如 *bounced back* / *stumbled*） | 從意思找到正確的字，並在句子中辨認詞形 |
| 3 精熟 | 看中文拼出英文；例句填空拼寫（沒有選項，提示每次扣 0.25 分） | 能正確拼寫出來 |

- 上方有三段進度條（基礎 → 進階 → 精熟），加上整體題號（例如 12 / 30）。
- 每段結束時，過場卡會顯示這段的分數，以及下一段的題型說明，按「繼續」就接著做。
- 最後一張**總成績單**：總分（三段加總）、三段各自的分數條、依段落分組的錯題；總分達 **80%** 算通過。
- 成績只在全部完成後**送出一筆**，內含三段各自的分數。中途離開時會跳出提醒，也不會送出半套成績。
- 「練習錯的題目」會用原本那一段的題型再練一次，不送出成績。

### 4.3 課文理解

- 桌機是左右兩欄：左邊是固定的文章，右邊是題目；手機則是先文章、後題目。
- 每題標示題型（主旨、細節、字義、推論、態度），交卷後才公布答案和中文解析。
- **防止照抄**：`tools/check-content.mjs` 會比對每個題目和選項跟文章的重疊。只要有連續 6 個英文字以上相同，就列為錯誤；連續 5 個字列為警告。目前 4 篇範例文章、20 題都通過檢查。改寫示範：

| 文章原句 | 選項改寫 |
| --- | --- |
| Her hands had shaken so badly that she forgot the second half of the piece. | Nerves made her lose track of the music halfway through. |
| This time, she did not practice to win. She practiced to enjoy the music. | She focused on having fun with music rather than on beating others. |
| the water is collected and reused | The same water is gathered and used again. |

### 4.4 老師控管與成績

- 學生：不用登入，第一次進站時填班級、座號、姓名（只存在自己的裝置）。每完成一份測驗，成績就會送出。
- 老師：用 Google 試算表加 Apps Script 做後台，只有 `teachers` 名單上的 Google 帳號能進入。後台可以：
  - 決定每個單元要不要顯示
  - 決定單字片語連續測驗包含哪幾段（基礎、進階、精熟），以及課文理解是否開放
  - 設定每一段的題數
  - 依班級或單元查詢成績，並看平均分數
- 學生網站讀不到老師的設定時，會改用預設值（全部開放、每次 10 題），網站仍然可以使用。

## 5. 待辦

1. 提供 L1–L4 真正的單字片語與課文（貼文字或截圖都可以），替換 `data/lessons/` 裡的範例資料，並執行 `node tools/check-content.mjs`。
2. 部署 Apps Script，把網址填進 `js/config.js`。
3. 開啟 GitHub Pages，再嵌入或連結到原本的 Google Sites。
