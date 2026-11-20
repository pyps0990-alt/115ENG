#!/usr/bin/env bash
# 自動錯誤分析一鍵設定（在 Google Cloud Shell 執行；用 Firebase 專案擁有者的帳號）
#   bash tools/brain/cloudrun/setup-auto.sh            全部做一次（開服務 → 部署 → 權限 → 觸發 → 補做）
#   bash tools/brain/cloudrun/setup-auto.sh sweep      只把目前待分析的單元補做一次
# 重跑沒關係：已經做好的會略過或更新。說明見 DEPLOY-AUTO.md
set -euo pipefail

PROJECT=${PROJECT:-eng-3385e}
REGION=${REGION:-asia-southeast1}   # 有 L4 GPU 的區域（台灣區目前沒有 Cloud Run GPU）
SERVICE=b5-brain-auto
TRIGGER=b5-content-saved
HERE="$(cd "$(dirname "$0")/.." && pwd)"   # tools/brain
step() { echo; echo "━━ $* ━━"; }

gcloud config set project "$PROJECT" --quiet >/dev/null
NUM=$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')
RUN_SA="${NUM}-compute@developer.gserviceaccount.com"
LOC=$(gcloud firestore databases describe --database='(default)' --format='value(locationId)')
echo "專案 $PROJECT（編號 $NUM），Firestore 位置 $LOC，服務帳戶 $RUN_SA"

sweep() {
  step "補做目前待分析的單字單元（每個約 1～2 分鐘）"
  URL=$(gcloud run services describe "$SERVICE" --region "$REGION" --format='value(status.url)')
  TOKEN=$(gcloud auth print-identity-token)
  curl -sS -X POST -H "Authorization: Bearer $TOKEN" --max-time 3500 "$URL/sweep" | python3 -m json.tool
}
if [ "${1:-all}" = "sweep" ]; then sweep; exit 0; fi

step "1/5 開啟需要的服務"
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com eventarc.googleapis.com pubsub.googleapis.com --quiet

step "2/5 打包並部署 GPU 服務（第一次約 20～30 分鐘）"
( cd "$HERE" && python3 make_cloudrun.py --gpu )
gcloud run deploy "$SERVICE" --source "$HERE/cloudrun_gpu_dist" --region "$REGION" \
  --gpu 1 --gpu-type nvidia-l4 --no-gpu-zonal-redundancy --cpu 4 --memory 16Gi --no-cpu-throttling \
  --timeout 3600 --concurrency 1 --min-instances 0 --max-instances 1 --no-allow-unauthenticated --quiet

step "3/5 權限：讀寫 Firestore、接收事件、呼叫服務"
gcloud projects add-iam-policy-binding "$PROJECT" --member="serviceAccount:$RUN_SA" --role=roles/datastore.user --condition=None --quiet >/dev/null
gcloud projects add-iam-policy-binding "$PROJECT" --member="serviceAccount:$RUN_SA" --role=roles/eventarc.eventReceiver --condition=None --quiet >/dev/null
gcloud run services add-iam-policy-binding "$SERVICE" --region "$REGION" --member="serviceAccount:$RUN_SA" --role=roles/run.invoker --quiet >/dev/null
# Eventarc 用 Pub/Sub 送事件：Pub/Sub 的服務代理要能替服務帳戶簽身分權杖
gcloud projects add-iam-policy-binding "$PROJECT" --member="serviceAccount:service-${NUM}@gcp-sa-pubsub.iam.gserviceaccount.com" --role=roles/iam.serviceAccountTokenCreator --condition=None --quiet >/dev/null || true
echo "已給權限"

step "4/5 建立觸發：存了單字單元（public/content_*）就分析"
if gcloud eventarc triggers describe "$TRIGGER" --location="$LOC" >/dev/null 2>&1; then
  echo "觸發已經存在，略過"
else
  # 剛給的權限要一點時間生效：失敗就等 30 秒重試，最多 5 次
  for i in 1 2 3 4 5; do
    if gcloud eventarc triggers create "$TRIGGER" --location="$LOC" \
        --destination-run-service="$SERVICE" --destination-run-region="$REGION" --destination-run-path=/event \
        --event-filters="type=google.cloud.firestore.document.v1.written" --event-filters="database=(default)" \
        --event-filters-path-pattern="document=public/content_{unit}" --event-data-content-type="application/json" \
        --service-account="$RUN_SA" --quiet; then break; fi
    [ "$i" = 5 ] && exit 1
    echo "等權限生效，30 秒後重試（$i/5）"; sleep 30
  done
fi

step "5/5 補做"
sweep

step "完成"
echo "之後在後台存了單字單元，1～3 分鐘內會自動分析並更新網站（不用開著網頁）。"
echo "紀錄：Google Cloud Console → Cloud Run → $SERVICE → 記錄"
