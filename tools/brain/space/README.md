---
title: B5 Brain
emoji: 🧠
colorFrom: blue
colorTo: indigo
sdk: gradio
sdk_version: 5.9.1
python_version: "3.11"
app_file: app.py
pinned: false
---

# B5 Practice 錯誤分析引擎

分析單字單元：兩兩字的關係（同字根、音近、形近、反義、近義）、例句空格的詞性與搭配、
同單元哪些字放進例句也說得通（不當干擾選項）、從單字表挑課外選項。

- `POST /analyze`（標頭 `X-Brain-Key`）：`{unit, data, lm, rejected}` → `{job}`
- `GET /jobs/{job}`：`status`（queued／running／done／error）、`step`、`result`
- `GET /health`

Secrets：`BRAIN_KEY`（必填）、`HF_TOKEN`（讀私人單字表）；Variables：`WORDBANK_REPO`（私人 dataset）。
硬體選免費的 CPU basic 即可。
