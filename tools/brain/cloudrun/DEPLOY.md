# 錯誤分析引擎部署到 Google Cloud Run

專案 `eng-3385e`（Firebase 同一個專案，Blaze 方案），區域 `asia-east1`（台灣）。

## 第一次部署

```
cd tools\brain
.venv\Scripts\python make_cloudrun.py
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com --project eng-3385e
gcloud run deploy b5-brain --source cloudrun_dist --project eng-3385e --region asia-east1 ^
  --memory 4Gi --cpu 2 --timeout 3600 --concurrency 1 --min-instances 0 --max-instances 2 ^
  --allow-unauthenticated --set-env-vars BRAIN_KEY=<自己設一組長亂碼>
```

- 第一次建置要 10～15 分鐘（安裝 PyTorch、下載語言模型）。
- 完成時會顯示 Service URL（像 `https://b5-brain-xxxxx.asia-east1.run.app`）。
- 老師後台「匯入內容 → 錯誤分析結果上傳 → 引擎設定」填 Service URL 與 BRAIN_KEY。
- `--allow-unauthenticated`：讓老師的瀏覽器可以直接呼叫；沒有金鑰的請求一律回 401。

## 之後更新（改了 brain.py、rejected_extras.json 或單字表）

```
.venv\Scripts\python make_cloudrun.py
gcloud run deploy b5-brain --source cloudrun_dist --project eng-3385e --region asia-east1
```

（其他設定、金鑰都會沿用。）

## 費用

- 不用 GPU：只在匯入或修改單元時分析，CPU 一個單元 3～10 分鐘。
- `--min-instances 0`：沒在分析時不計費。每月免費額度約 18 萬 vCPU 秒，一次分析約 1,200 vCPU 秒，大約 150 次以內免費。
- 映像檔（約 2 GB）存在 Artifact Registry，每月約 0.2 美元。
- `--max-instances 2`：就算有人亂打也最多兩台，費用有上限。建議在 Google Cloud 設預算快訊（docs/firebase-backup.md 第 4 節）。

## 測試

```
curl https://<Service URL>/health
```

回 `{"ok":true,"engine":1,"wordbank":6486}` 就是好的。
