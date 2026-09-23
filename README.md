# B5 Practice

高二英文 Book 5 互動練習網站：單字（單字卡、選擇題、拼字／克漏字、配對遊戲）、閱讀、文法、克漏字，以及可以回傳成績給老師的正式測驗。

- 分析與設計說明：[`docs/analysis.md`](docs/analysis.md)
- 目前的內容是**範例資料**，換成課本內容的方法請見分析文件第 5 節。

## 本機預覽

網站用 `fetch` 讀取 JSON，所以要用網頁伺服器開啟（不能直接雙擊 `index.html`）：

```bash
python3 -m http.server 8000
# 開啟 http://localhost:8000
```

## 發布到 GitHub Pages

1. 到 GitHub repo 的 **Settings → Pages**。
2. Source 選 **Deploy from a branch**，Branch 選 `main`，資料夾選 `/ (root)`。
3. 幾分鐘後網址會是 `https://<帳號>.github.io/<repo>/`。
4. 在原本的 Google Sites 上用「插入 → 嵌入 → 依網址」貼上這個網址，或把導覽連結直接改到新網站。

## 老師後台與成績回傳（Google Apps Script）

1. 建立一份新的 Google 試算表 → **擴充功能 → Apps Script**。
2. 把 `apps-script/` 裡的三個檔案貼進去：`Code.gs`、`Setup.gs`，再新增一個 HTML 檔，命名為 `Admin`，貼上 `Admin.html` 的內容。
3. 在編輯器選擇函式 `setup` 並按 **執行**（第一次執行需要授權）。執行後會建立 `settings`、`teachers`、`scores` 三個分頁，並把你的帳號加入老師名單。其他老師的帳號可以直接加到 `teachers` 分頁。
4. 按 **部署 → 新增部署作業 → 網頁應用程式**：
   - 執行身分：**我**
   - 誰可以存取：**所有人**（學生不用登入就能讀取設定、送出成績）
5. 複製 Web App 網址（結尾是 `/exec`），貼到 `js/config.js` 的 `SCRIPT_URL`，然後 commit。
6. 老師用**學校 Google 帳號登入**後，打開同一個網址（不帶參數）就是老師後台。這個網址也會出現在網站頁尾的「老師後台」連結。

> 帳號判斷使用 `Session.getActiveUser()`。學校 Google Workspace 網域內的帳號可以取得 email；沒登入或網域外的帳號會看到「僅限老師使用」。
> 修改 Apps Script 程式碼後，要到「管理部署作業」建立新版本，修改才會生效。

### 老師可以控制的項目

| 設定 | 效果 |
| --- | --- |
| 顯示 | 取消勾選後，學生首頁就看不到這個單元 |
| 開放的練習模式 | 取消勾選的模式（例如配對）會從分頁中隱藏 |
| 正式測驗 開放／題數／開始日／截止日 | 控制正式測驗能不能進入，以及要抽幾題 |

## 專案結構

```
index.html              入口（hash 路由：#/u/<單元>/<模式>）
css/style.css           設計系統（淺色／深色、手機優先）
js/app.js               路由、首頁、單元頁
js/modes/*.js           list / flashcards / mc / spell / match / exam / passage
js/components/*.js      題目元件、結果頁、測驗前關卡
js/storage.js           localStorage：熟悉度、錯題、最佳成績
js/remote-config.js     讀取老師設定（失敗時改用 data/config.default.json）
js/submit.js            成績回傳
data/lessons/*.json     課程資料
apps-script/            Google Apps Script（成績、設定、老師後台）
```
