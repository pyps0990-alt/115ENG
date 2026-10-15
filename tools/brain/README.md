# 錯誤分析引擎（小型大腦）

預先算好每個單字單元裡「兩兩字之間的關係」與「每句例句空格需要的詞性、搭配的字」，學生答錯時網站直接查表，說明為什麼錯（形近、音近、同字根、意思相近、意思相反、詞性不合、句意不合）。

## 在自己電腦上測準確度

```
python -m venv tools\brain\.venv
tools\brain\.venv\Scripts\python -m pip install -r tools\brain\requirements.txt
tools\brain\.venv\Scripts\python -c "import nltk; [nltk.download(p, download_dir='tools/brain/nltk_data') for p in ('wordnet','cmudict','averaged_perceptron_tagger_eng')]"
cd tools\brain
.venv\Scripts\python analyze.py fetch    # 從 Firebase 讀目前所有單字單元（只讀）
.venv\Scripts\python analyze.py run      # 分析，結果在 out/
.venv\Scripts\python analyze.py report   # 產生 report.html，逐題判斷準不準
```

之後會把 `brain.py` 放到 Firebase Cloud Functions（Python），老師儲存題目時自動分析，結果存成 `public/analysis_<單元>`。

## 接到網站（Google Cloud Run）

1. 部署：見 `cloudrun/DEPLOY.md`（`make_cloudrun.py` 打包、`gcloud run deploy`）。
2. 老師後台「匯入內容」最下面「錯誤分析結果上傳 → 引擎設定」填 Cloud Run 網址與金鑰。
3. 選好單元按「分析上方選的單元」：瀏覽器直接呼叫 Cloud Run，一個請求等到分析完（3～10 分鐘），結果寫到 Firebase `public/analysis_<單元>`（不改單元設定、不重製學生進度）。
4. 也可以在自己電腦跑 `analyze.py run --lm`，把 `out/單元代號.json` 用同一張卡片的「上傳檔案」上傳。
5. 網站開單元時讀這份結果：同單元「放進句子也說得通」的字不當選項、例句選字有一半機會混入 1～3 個課外字；老師改過題目（簽章對不上）就自動不用。
