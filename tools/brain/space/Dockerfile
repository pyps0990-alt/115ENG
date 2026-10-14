# 錯誤分析引擎（Hugging Face Space，Docker）
FROM python:3.11-slim

# Hugging Face Space 用 1000 號使用者執行
RUN useradd -m -u 1000 user
USER user
ENV HOME=/home/user PATH=/home/user/.local/bin:$PATH HF_HOME=/home/user/app/models PYTHONUNBUFFERED=1
WORKDIR /home/user/app

COPY --chown=user requirements.txt .
RUN pip install --no-cache-dir --user torch --index-url https://download.pytorch.org/whl/cpu \
 && pip install --no-cache-dir --user -r requirements.txt

# 字典與語言模型在建置時就下載好，開機不用等
RUN python -c "import nltk; [nltk.download(p, download_dir='nltk_data', quiet=True) for p in ('wordnet','cmudict','averaged_perceptron_tagger_eng')]" \
 && python -c "from transformers import AutoTokenizer, AutoModelForMaskedLM; AutoTokenizer.from_pretrained('distilroberta-base'); AutoModelForMaskedLM.from_pretrained('distilroberta-base')" \
 && python -c "import jieba; jieba.initialize()"

COPY --chown=user . .
EXPOSE 7860
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "7860"]
