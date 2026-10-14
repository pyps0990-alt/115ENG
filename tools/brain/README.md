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
