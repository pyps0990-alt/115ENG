# B5 Practice

高二英文 Book 5 線上測驗網站，只有兩種功能：

- **單字片語測驗**：分成三個等級
  - **基礎**：看英文，選出中文意思
  - **進階**：看中文選英文，加上例句填空四選一（含詞形變化）
  - **精熟**：沒有選項，看中文拼出英文，加上例句填空拼寫
- **課文理解**：先讀文章，再做閱讀測驗。題目與選項都是改寫過的，不會照抄文章。

學生不用登入，只要填班級、座號和姓名。每次完成測驗，成績都會送到老師的 Google 試算表。老師可以用 Google 帳號登入後台，控制學生看得到哪些單元和等級。

- 分析與設計說明：[`docs/analysis.md`](docs/analysis.md)
- 目前的單字與文章都是**範例資料**，替換方法請見下方「更換內容」。

## 配色

| 色碼 | 用途 |
| --- | --- |
| `#FFFFFF` | 背景主色 |
| `#F4F6F9` | 卡片、區塊底色 |
| `#1E3A8A` | 導覽列、大標題 |
| `#64748B` | 內文、副標題 |
| `#F59E0B` | 答對提示、重要按鈕 |

答錯時用紅色 `#DC2626` 表示，並加上 ✗ 符號，所以不會只靠顏色判斷對錯。

## 本機預覽

```bash
python3 -m http.server 8000
# 開啟 http://localhost:8000
```

網站用 `fetch` 讀取 JSON，所以要透過網頁伺服器開啟，不能直接雙擊 `index.html`。

## 更換內容

每課有兩個檔案，放在 `data/lessons/`：`lN-voc.json`（單字片語）和 `lN-reading.json`（課文理解）。

**單字片語**

```json
{ "type": "word", "word": "adversity", "pos": "n.", "zh": "逆境；困境",
  "example": "She stayed calm in the face of [adversity].", "exampleZh": "她在逆境中仍保持冷靜。" }
{ "type": "phrase", "word": "bounce back", "pos": "phr.", "zh": "（挫折後）很快恢復",
  "example": "The team [bounced back] after losing the first game.", "exampleZh": "球隊在輸掉第一場比賽後很快重新振作。" }
```

- `type`：單字填 `word`，片語填 `phrase`。出選擇題時，片語的干擾選項也會盡量用片語。
- `example` 裡要考的部分用 `[ ]` 括起來，進階和精熟的例句填空題會挖掉這個部分。括號裡可以是變化形，例如 `[bounced back]`。

**課文理解**

```json
{
  "title": "Mia's Second Try",
  "passage": ["第一段……", "第二段……"],
  "questions": [
    { "skill": "細節", "q": "What went wrong during Mia's first competition?",
      "options": ["…", "…", "…", "…"], "answer": 1, "explain": "第一段：……" }
  ]
}
```

- `answer` 是正確選項的索引，從 0 開始。
- `skill` 是題型標籤，例如主旨、細節、字義、推論、態度。

改完後執行內容檢查：

```bash
node tools/check-content.mjs
```

檢查項目：

- 課文理解的題目或選項，只要跟文章有**連續 6 個英文字以上相同**，就算照抄，會列為錯誤；連續 5 個字會列為警告。
- 單字片語的例句有沒有用 `[ ]` 標出目標字、有沒有重複的字，以及中文意思有沒有重複。

換成真正的內容後，記得把 `data/lessons/index.json` 裡對應單元的 `"sample": true` 拿掉，並更新 `count`。

## 發布到 GitHub Pages

1. GitHub repo → **Settings → Pages** → Source 選 **Deploy from a branch**，Branch 選 `main`，資料夾選 `/ (root)`。
2. 網址會是 `https://<帳號>.github.io/<repo>/`。
3. 在原本的 Google Sites 用「插入 → 嵌入 → 依網址」貼上這個網址，或把導覽連結改到新網站。

## 老師後台與成績（Google Apps Script）

1. 建立一份 Google 試算表 → **擴充功能 → Apps Script**。
2. 貼上 `apps-script/Code.gs`、`apps-script/Setup.gs`，再新增一個 HTML 檔，命名為 `Admin`，貼上 `Admin.html` 的內容。
3. 選擇 `setup` 函式並按 **執行**。執行後會建立 `settings`、`teachers`、`scores` 三個分頁，並把你的帳號加入老師名單。其他老師的帳號可以直接加到 `teachers` 分頁。
4. **部署 → 新增部署作業 → 網頁應用程式**：執行身分選「我」，誰可以存取選「所有人」。
5. 把 Web App 網址（結尾是 `/exec`）貼到 `js/config.js` 的 `SCRIPT_URL`，然後 commit。
6. 老師用學校 Google 帳號登入後，打開同一個網址（不帶參數）就是後台。這個網址也會出現在網站頁尾的「老師後台」連結。

老師可以設定：

| 設定 | 效果 |
| --- | --- |
| 顯示 | 取消勾選後，學生首頁就看不到這個單元 |
| 開放的測驗 | 單字片語可以個別關閉基礎、進階或精熟；課文理解可以整個關閉 |
| 每次題數 | 單字片語每次測驗的題數（預設 10 題） |

`scores` 分頁的欄位：時間、班級、座號、姓名、單元、等級（基礎／進階／精熟／課文理解）、分數、總分、百分比、錯題、作答秒數。
「練習錯的題目」只是讓學生複習，不會送出成績。

> 帳號判斷使用 `Session.getActiveUser()`，學校 Google Workspace 網域內的帳號可以取得 email。修改 Apps Script 程式碼後，要在「管理部署作業」建立新版本才會生效。

## 專案結構

```
index.html               入口（hash 路由：#/u/<單元>/<等級>）
css/style.css            配色與版面
js/app.js                首頁、等級選擇、路由
js/levels.js             三個等級的出題規則
js/modes/level.js        單字片語測驗流程
js/modes/reading.js      課文理解流程
js/components/*.js       題目元件（選擇題、字母框拼字）、結果頁、測驗前關卡
data/lessons/*.json      課程資料
tools/check-content.mjs  內容檢查（防止閱讀題照抄文章）
apps-script/             Google Apps Script（成績、設定、老師後台）
```
