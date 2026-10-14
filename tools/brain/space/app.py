"""錯誤分析引擎的網路服務（Hugging Face Space，Docker + FastAPI）

老師後台儲存單字單元後，送題目來這裡分析；分析一個單元約 3～4 分鐘，所以用「工作」的方式：
  POST /analyze      開始分析（要帶 X-Brain-Key），回傳 {job}
  GET  /jobs/{job}   查進度與結果（job 是隨機 32 碼，猜不到；不需要金鑰）
  GET  /             健康檢查

環境變數（Space 的 Settings → Variables and secrets）：
  BRAIN_KEY        必填（Secret）。老師後台呼叫時帶的金鑰，存在 Apps Script 指令碼屬性，不會出現在網頁原始碼
  WORDBANK_REPO    選填。放 7000 單字表的私人 dataset（例如 yourname/b5-wordbank），Space 開機時下載
  HF_TOKEN         選填（Secret）。讀私人 dataset 用
  ALLOW_ORIGINS    選填。允許呼叫的網站，逗號分隔（預設 eng-3385e 的兩個網址）
"""
import os
import secrets
import threading
import time
import traceback
from collections import OrderedDict
from queue import Queue

from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

HERE = os.path.dirname(os.path.abspath(__file__))


def _fetch_wordbank():
    """單字表：WORDBANK_REPO 有設定就從私人 dataset 下載到 wordbank/（單字表不放在公開的 Space 裡）"""
    repo = os.environ.get('WORDBANK_REPO', '').strip()
    if not repo:
        return
    from huggingface_hub import snapshot_download
    snapshot_download(repo_id=repo, repo_type='dataset', local_dir=os.path.join(HERE, 'wordbank'),
                      allow_patterns=['*.csv', '*.tsv', '*.txt'], token=os.environ.get('HF_TOKEN') or None)


_fetch_wordbank()

import brain  # noqa: E402  （單字表下載好才載入）

app = FastAPI(title='B5 錯誤分析引擎')
origins = [o.strip() for o in os.environ.get('ALLOW_ORIGINS', 'https://eng-3385e.web.app,https://eng-3385e.firebaseapp.com').split(',') if o.strip()]
app.add_middleware(CORSMiddleware, allow_origins=origins, allow_methods=['GET', 'POST'], allow_headers=['Content-Type', 'X-Brain-Key'])

JOBS = OrderedDict()   # 最近 50 個工作（記憶體裡，Space 重開就清掉；結果老師後台會存到 Firebase）
QUEUE = Queue()        # 一次只分析一個單元（免費 CPU 只有 2 核）
MAX_JOBS = 50


class AnalyzeIn(BaseModel):
    unit: str
    data: dict
    lm: bool = True              # 語言模型檢查與課外選項（約 3～4 分鐘）；false 只算字的關係（幾秒）
    rejected: list[str] = []     # 老師另外標成不適合的課外選項（單元|單字|第幾句|課外字），和內建的清單合併


def _worker():
    import random
    while True:
        job_id = QUEUE.get()
        job = JOBS.get(job_id)
        if not job:
            continue
        job['status'] = 'running'
        job['started'] = time.time()
        try:
            req = job.pop('req')
            data = req['data']
            if not isinstance(data.get('words'), list) or not data['words']:
                raise ValueError('沒有單字')
            brain.EXTRA_REJECTED = set(req.get('rejected') or [])
            a = brain.analyze(data)
            if req.get('lm', True):
                job['step'] = '檢查同單元的干擾選項'
                a['unsafe'] = brain.option_safety(data, a)
                job['step'] = '挑選課外選項'
                a['extra'] = brain.extra_options(data, a, random.Random(req['unit']), uid=req['unit'])
            job['result'] = a
            job['status'] = 'done'
        except Exception as e:  # noqa: BLE001
            job['status'] = 'error'
            job['error'] = f'{type(e).__name__}: {e}'
            traceback.print_exc()
        finally:
            job['finished'] = time.time()


threading.Thread(target=_worker, daemon=True).start()


@app.get('/')
def health():
    return {'ok': True, 'engine': brain.ENGINE_VERSION, 'queue': QUEUE.qsize()}


@app.post('/analyze')
def analyze(body: AnalyzeIn, x_brain_key: str = Header(default='')):
    key = os.environ.get('BRAIN_KEY', '')
    if not key or not secrets.compare_digest(x_brain_key, key):
        raise HTTPException(status_code=401, detail='金鑰不正確')
    if len(body.data.get('words', [])) > 150:
        raise HTTPException(status_code=413, detail='一個單元最多 150 個字')
    job_id = secrets.token_hex(16)
    JOBS[job_id] = {'status': 'queued', 'unit': body.unit, 'created': time.time(), 'req': body.model_dump()}
    while len(JOBS) > MAX_JOBS:
        JOBS.popitem(last=False)
    QUEUE.put(job_id)
    return {'job': job_id, 'ahead': QUEUE.qsize() - 1}


@app.get('/jobs/{job_id}')
def job(job_id: str):
    j = JOBS.get(job_id)
    if not j:
        raise HTTPException(status_code=404, detail='找不到這個工作（Space 可能重開過，請重新分析）')
    out = {k: v for k, v in j.items() if k not in ('req',)}
    if j.get('started'):
        out['seconds'] = round((j.get('finished') or time.time()) - j['started'])
    return out
