"""把錯誤分析引擎打包成 Hugging Face Space 要上傳的資料夾 space_dist/

  .venv\\Scripts\\python make_space.py
  huggingface-cli upload <你的帳號>/b5-brain space_dist . --repo-type=space

單字表不會放進 space_dist（Space 是公開的）：另外上傳到私人 dataset，Space 用 WORDBANK_REPO＋HF_TOKEN 讀。
"""
import os
import shutil

HERE = os.path.dirname(os.path.abspath(__file__))
DIST = os.path.join(HERE, 'space_dist')

if os.path.isdir(DIST):
    shutil.rmtree(DIST)
os.makedirs(DIST)
for name in ('app.py', 'Dockerfile', 'requirements.txt', 'README.md'):
    shutil.copy(os.path.join(HERE, 'space', name), DIST)
for name in ('brain.py', 'lm.py', 'wordbank.py', 'rejected_extras.json'):
    shutil.copy(os.path.join(HERE, name), DIST)
print('已產生', DIST)
print('內容：', sorted(os.listdir(DIST)))
