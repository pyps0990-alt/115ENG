"""把錯誤分析引擎打包成 Cloud Run 要部署的資料夾 cloudrun_dist/（部署步驟見 cloudrun/DEPLOY.md）

  .venv\\Scripts\\python make_cloudrun.py

單字表（wordbank/）會一起放進映像檔：Artifact Registry 的映像檔是私人的，不會公開。
"""
import os
import shutil

HERE = os.path.dirname(os.path.abspath(__file__))
DIST = os.path.join(HERE, 'cloudrun_dist')
CR, LF = bytes([13]), bytes([10])


def copy_lf(src, dst_dir):
    """文字檔一律存成 LF 換行（Dockerfile 的反斜線接續行在 CRLF 下會失效）"""
    with open(src, 'rb') as f:
        data = f.read().replace(CR + LF, LF)
    with open(os.path.join(dst_dir, os.path.basename(src)), 'wb') as f:
        f.write(data)


if os.path.isdir(DIST):
    shutil.rmtree(DIST)
os.makedirs(DIST)
for name in ('main.py', 'Dockerfile', 'requirements.txt'):
    copy_lf(os.path.join(HERE, 'cloudrun', name), DIST)
for name in ('brain.py', 'lm.py', 'wordbank.py', 'rejected_extras.json', 'slot_overrides.json'):
    copy_lf(os.path.join(HERE, name), DIST)
bank = os.path.join(HERE, 'wordbank')
files = [n for n in (os.listdir(bank) if os.path.isdir(bank) else []) if n.lower().endswith(('.csv', '.tsv', '.txt'))]
if not files:
    raise SystemExit('找不到單字表：請把 7000 單字 CSV 放在 tools/brain/wordbank/')
os.makedirs(os.path.join(DIST, 'wordbank'))
for i, name in enumerate(sorted(files)):
    # 映像檔裡的檔名一律用英數（中文檔名會讓 Cloud Run 匯入映像檔失敗）
    ext = os.path.splitext(name)[1].lower()
    shutil.copy(os.path.join(bank, name), os.path.join(DIST, 'wordbank', 'bank%d%s' % (i, ext)))
with open(os.path.join(DIST, '.gcloudignore'), 'w', encoding='utf-8') as f:
    f.write('__pycache__/\n*.pyc\n')
print('已產生', DIST)
print('內容：', sorted(os.listdir(DIST)), '單字表：', files)
