# 自動錯誤分析（Cloud Run GPU＋Firestore 事件）

老師在後台存了單字單元的題目 → Firestore 的 `public/content_<單元>` 被寫入 → Eventarc 通知 `b5-brain-auto` 服務 → 題目真的改過才分析 → 結果寫回 `public/analysis_<單元>`。
**不用開著網頁或 Colab**：存完就可以關掉。沒有人存題目時服務關機（0 台），不計費。

- 服務：`b5-brain-auto`（和原本給後台呼叫的 `b5-brain` 分開；這個不公開，只有 Eventarc 能呼叫）
- GPU：NVIDIA L4，一個單元約 1～2 分鐘（冷啟動另外約 1 分鐘）
- 程式：`cloudrun/main.py` 的 `/event`（事件）、`/sweep`（把所有待分析的單元補做一次）

以下指令在 `tools\brain` 資料夾、用 Windows 命令提示字元（cmd）執行。`gcloud` 要先 `gcloud auth login` 用 Firebase 專案擁有者的帳號登入。

## 1. 開啟需要的服務（只要一次）

```
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com eventarc.googleapis.com --project eng-3385e
```

## 2. 打包並部署（GPU 版）

```
.venv\Scripts\python make_cloudrun.py --gpu
gcloud run deploy b5-brain-auto --source cloudrun_gpu_dist --project eng-3385e --region asia-southeast1 ^
  --gpu 1 --gpu-type nvidia-l4 --no-gpu-zonal-redundancy --cpu 4 --memory 16Gi --no-cpu-throttling ^
  --timeout 3600 --concurrency 1 --min-instances 0 --max-instances 1 --no-allow-unauthenticated
```

- 第一次建置約 20～30 分鐘（PyTorch、兩個 Qwen 模型都放進映像檔）。
- 區域用 `asia-southeast1`（新加坡，有 L4 GPU；台灣區目前沒有 Cloud Run GPU）。
- 出現 GPU 配額不足：到 Google Cloud Console →「IAM 與管理 → 配額」搜尋 `Total Nvidia L4 GPU allocation without zonal redundancy`，區域選 asia-southeast1，申請 1。
- 電腦上沒有 `wordbank\` 也沒關係：建置時會從 Hugging Face 的 `nhmccyj/b5-wordbank` 下載大考中心詞彙表。

## 3. 給服務帳戶權限（只要一次）

先查專案編號：

```
gcloud projects describe eng-3385e --format="value(projectNumber)"
```

下面的 `<編號>` 換成查到的數字（服務帳戶是 `<編號>-compute@developer.gserviceaccount.com`）：

```
gcloud projects add-iam-policy-binding eng-3385e --member=serviceAccount:<編號>-compute@developer.gserviceaccount.com --role=roles/datastore.user
gcloud projects add-iam-policy-binding eng-3385e --member=serviceAccount:<編號>-compute@developer.gserviceaccount.com --role=roles/eventarc.eventReceiver
gcloud run services add-iam-policy-binding b5-brain-auto --project eng-3385e --region asia-southeast1 --member=serviceAccount:<編號>-compute@developer.gserviceaccount.com --role=roles/run.invoker
```

- `datastore.user`：讓服務讀題目、寫回分析結果
- `eventarc.eventReceiver`、`run.invoker`：讓 Firestore 事件可以呼叫這個服務

## 4. 建立 Firestore 事件觸發（只要一次）

先查 Firestore 資料庫的位置（例如 `asia-east1`、`nam5`）：

```
gcloud firestore databases describe --database="(default)" --project eng-3385e --format="value(locationId)"
```

下面的 `<位置>` 換成查到的值：

```
gcloud eventarc triggers create b5-content-saved --project eng-3385e --location=<位置> ^
  --destination-run-service=b5-brain-auto --destination-run-region=asia-southeast1 --destination-run-path=/event ^
  --event-filters="type=google.cloud.firestore.document.v1.written" --event-filters="database=(default)" ^
  --event-filters-path-pattern="document=public/content_{unit}" --event-data-content-type="application/json" ^
  --service-account=<編號>-compute@developer.gserviceaccount.com
```

- 只看 `public/content_*`：分析結果寫進 `public/analysis_*` 不會再觸發自己。
- 不是單字單元（課文、句型）、題目沒改：服務直接略過，幾秒就結束。
- 分析失敗會回錯誤，Eventarc 會自動重送。

## 5. 補做一次目前待分析的單元

```
gcloud run services proxy b5-brain-auto --project eng-3385e --region asia-southeast1 --port 8099
```

保持這個視窗開著，另開一個命令提示字元：

```
curl -X POST http://localhost:8099/sweep
```

會列出每個單元的結果（「已寫回」或「略過」）。做完回到第一個視窗按 Ctrl+C。

## 6. 確認

- 後台「錯誤分析」頁：狀態變成「已分析」，時間是剛剛。
- 之後老師改了單字單元的題目、按儲存：1～3 分鐘內狀態自動變成「已分析」。
- 看紀錄：Google Cloud Console → Cloud Run → `b5-brain-auto` →「記錄」，會看到「L5-voc：題目改過，66 個字，85 秒，已寫回」這類訊息。

## 費用

- 只有分析時開機：L4 GPU＋4 vCPU＋16 GiB 每秒約 0.0003 美元，一個單元（含冷啟動）約 2～3 分鐘，約 0.05 美元。
- 沒事時 0 台，不計費。映像檔約 10 GB 存在 Artifact Registry，每月約 1 美元。
- `--max-instances 1`：同時最多一台，費用有上限。建議在 Google Cloud 設預算快訊。

## 之後更新程式（改了 brain.py、lm.py、單字表）

```
.venv\Scripts\python make_cloudrun.py --gpu
gcloud run deploy b5-brain-auto --source cloudrun_gpu_dist --project eng-3385e --region asia-southeast1
```

（GPU、權限、事件觸發都會沿用。）
