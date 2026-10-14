"""把錯誤分析引擎打包成 Hugging Face Space 要上傳的資料夾 space_dist/

  .venv\\Scripts\\python make_space.py
  .venv\\Scripts\\huggingface-cli upload <你的帳號>/b5-brain space_dist . --repo-type=space

單字表不會放進 space_dist（Space 是公開的）：另外上傳到私人 dataset，Space 用 WORDBANK_REPO＋HF_TOKEN 讀。
"""
import os
import shutil

HERE = os.path.dirname(os.path.abspath(__file__))
DIST = os.path.join(HERE, 'space_dist')
CR, LF = bytes([13]), bytes([10])


def copy_lf(src):
    """一律存成 LF 換行：README 開頭的 Space 設定與 requirements 用 LF 最保險"""
    with open(src, 'rb') as f:
        data = f.read().replace(CR + LF, LF)
    with open(os.path.join(DIST, os.path.basename(src)), 'wb') as f:
        f.write(data)


if os.path.isdir(DIST):
    shutil.rmtree(DIST)
os.makedirs(DIST)
for name in ('app.py', 'requirements.txt', 'README.md'):
    copy_lf(os.path.join(HERE, 'space', name))
for name in ('brain.py', 'lm.py', 'wordbank.py', 'rejected_extras.json'):
    copy_lf(os.path.join(HERE, name))
print('已產生', DIST)
print('內容：', sorted(os.listdir(DIST)))
