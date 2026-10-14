"""錯誤分析引擎的網路服務（Hugging Face Space，Gradio SDK＋FastAPI，免費 CPU）

老師後台儲存單字單元後，送題目來這裡分析；分析一個單元約 3～4 分鐘，所以用「工作」的方式：
  POST /analyze      開始分析（要帶 X-Brain-Key），回傳 {job}
  GET  /jobs/{job}   查進度與結果（job 是隨機 32 碼，猜不到；不需要金鑰）
  GET  /health       健康檢查
  /                  Gradio 狀態頁（Space 頁面看到的畫面）

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

HERE = os.path.dirname(os.path.abspath(__file__))


def _prepare():
    """開機準備（Gradio Space 沒有 Dockerfile，字典、單字表在這裡下載；語言模型第一次用到時才下載）"""
    import nltk
    data = os.path.join(HERE, 'nltk_data')
    for pkg, path in (('wordnet', 'corpora/wordnet.zip'), ('cmudict', 'corpora/cmudict.zip'), ('averaged_perceptron_tagger_eng', 'taggers/averaged_perceptron_tagger_eng')):
        if not os.path.exists(os.path.join(data, path)):
            nltk.download(pkg, download_dir=data, quiet=True)
    repo = os.environ.get('WORDBANK_REPO', '').strip()
    if repo:
        # 單字表不放在公開的 Space 裡：從私人 dataset 下載到 wordbank/
        from huggingface_hub import snapshot_download
        snapshot_download(repo_id=repo, repo_type='dataset', local_dir=os.path.join(HERE, 'wordbank'),
                          allow_patterns=['*.csv', '*.tsv', '*.txt'], token=os.environ.get('HF_TOKEN') or None)


_prepare()

import gradio as gr  # noqa: E402
from fastapi import FastAPI, Header, HTTPException  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402
from pydantic import BaseModel  # noqa: E402

import brain  # noqa: E402  （字典與單字表準備好才載入）
import wordbank  # noqa: E402

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


@app.get('/health')
def health():
    return {'ok': True, 'engine': brain.ENGINE_VERSION, 'queue': QUEUE.qsize(), 'wordbank': len(wordbank.load())}


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


# Space 頁面看到的狀態頁（實際分析由老師後台呼叫上面的 API）
def _status():
    rows = [[j.get('unit', ''), j.get('status', ''), j.get('step', ''), time.strftime('%m/%d %H:%M', time.localtime(j.get('created', 0)))] for j in reversed(JOBS.values())]
    return f"引擎版本 {brain.ENGINE_VERSION}・單字表 {len(wordbank.load())} 個字・排隊中 {QUEUE.qsize()} 個", rows


with gr.Blocks(title='B5 錯誤分析引擎') as demo:
    gr.Markdown('## B5 Practice 錯誤分析引擎\n老師後台「匯入內容 → 分析上方選的單元」會呼叫這裡。下面是最近的分析工作。')
    info = gr.Markdown()
    table = gr.Dataframe(headers=['單元', '狀態', '步驟', '時間'], interactive=False)
    gr.Button('重新整理').click(_status, outputs=[info, table])
    demo.load(_status, outputs=[info, table])

app = gr.mount_gradio_app(app, demo, path='/')

if __name__ == '__main__':
    import uvicorn
    uvicorn.run(app, host='0.0.0.0', port=int(os.environ.get('PORT', 7860)))
