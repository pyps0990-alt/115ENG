# 錯誤分析引擎（Google Cloud Run）
FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 NLTK_DATA=/app/nltk_data HF_HOME=/app/models PIP_NO_CACHE_DIR=1
WORKDIR /app

COPY requirements.txt .
RUN pip install torch==2.8.0 --index-url https://download.pytorch.org/whl/cpu \
 && pip install -r requirements.txt

# 字典與語言模型在建置時就下載好（冷啟動不用再等下載）
RUN python -c "import nltk; [nltk.download(p, download_dir='/app/nltk_data', quiet=True) for p in ('wordnet','cmudict','averaged_perceptron_tagger_eng')]" \
 && python -c "from transformers import AutoTokenizer, AutoModelForMaskedLM; AutoTokenizer.from_pretrained('distilroberta-base'); AutoModelForMaskedLM.from_pretrained('distilroberta-base')" \
 && python -c "import jieba; jieba.initialize()"

COPY . .
CMD exec uvicorn main:app --host 0.0.0.0 --port ${PORT:-8080}
