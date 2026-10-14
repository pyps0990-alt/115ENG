"""錯誤分析引擎的網路服務（Hugging Face Space，Gradio SDK，免費 CPU）

老師後台儲存單字單元後，送題目來這裡分析；分析一個單元約 3～4 分鐘，所以用「工作」的方式：
  POST /analyze      開始分析（要帶 X-Brain-Key），回傳 {job}
  GET  /jobs/{job}   查進度與結果（job 是隨機 32 碼，猜不到；不需要金鑰）
  GET  /health       健康檢查
  /                  Gradio 狀態頁（Space 頁面看到的畫面）

啟動方式：Space 執行 `python app.py`，由 Gradio 自己啟動伺服器（埠號、代理都交給它），
再把上面的 API 路由掛到 Gradio 的 FastAPI 上。不自己開 uvicorn（Space 裡已經有人佔用埠號）。

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
if HERE not in os.sys.path:
    os.sys.path.insert(0, HERE)


def _prepare():
    """開機準備（字典與單字表在這裡下載；語言模型第一次分析時才下載）"""
    import nltk
    data = os.path.join(HERE, 'nltk_data')
    for pkg, path in (('wordnet', 'corpora/wordnet.zip'), ('cmudict', 'corpora/cmudict.zip'),
                      ('averaged_perceptron_tagger_eng', 'taggers/averaged_perceptron_tagger_eng')):
        if not os.path.exists(os.path.join(data, path)):
            nltk.download(pkg, download_dir=data, quiet=True)
    repo = os.environ.get('WORDBANK_REPO', '').strip()
    if repo:
        from huggingface_hub import snapshot_download
        snapshot_download(repo_id=repo, repo_type='dataset', local_dir=os.path.join(HERE, 'wordbank'),
                          allow_patterns=['*.csv', '*.tsv', '*.txt'], token=os.environ.get('HF_TOKEN') or None)


ORIGINS = [o.strip() for o in os.environ.get('ALLOW_ORIGINS', 'https://eng-3385e.web.app,https://eng-3385e.firebaseapp.com').split(',') if o.strip()]
JOBS = OrderedDict()   # 最近 50 個工作（記憶體裡，Space 重開就清掉；結果老師後台會存到 Firebase）
QUEUE = Queue()        # 一次只分析一個單元（免費 CPU 只有 2 核）
MAX_JOBS = 50


def _worker():
    import random
    import brain
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


def register(api):
    """把 API 路由掛到 FastAPI 物件上（Gradio 的 server_app，或測試用的 FastAPI()）"""
    from fastapi import Header, Request
    from fastapi.responses import JSONResponse, Response

    def cors(request, extra=None):
        origin = request.headers.get('origin', '')
        h = {'Vary': 'Origin'}
        if origin in ORIGINS:
            h.update({'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': 'Content-Type, X-Brain-Key',
                      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Max-Age': '600'})
        if extra:
            h.update(extra)
        return h

    def reply(request, body, status=200):
        return JSONResponse(body, status_code=status, headers=cors(request))

    async def preflight(request: Request):
        return Response(status_code=204, headers=cors(request))

    async def health(request: Request):
        import brain
        import wordbank
        return reply(request, {'ok': True, 'engine': brain.ENGINE_VERSION, 'queue': QUEUE.qsize(), 'wordbank': len(wordbank.load())})

    async def analyze(request: Request, x_brain_key: str = Header(default='')):
        key = os.environ.get('BRAIN_KEY', '')
        if not key or not secrets.compare_digest(x_brain_key, key):
            return reply(request, {'detail': '金鑰不正確'}, 401)
        try:
            body = await request.json()
            unit, data = str(body['unit']), body['data']
            words = data.get('words', [])
        except Exception:  # noqa: BLE001
            return reply(request, {'detail': '內容格式不正確（需要 unit 與 data.words）'}, 400)
        if len(words) > 150:
            return reply(request, {'detail': '一個單元最多 150 個字'}, 413)
        job_id = secrets.token_hex(16)
        JOBS[job_id] = {'status': 'queued', 'unit': unit, 'created': time.time(),
                        'req': {'unit': unit, 'data': data, 'lm': bool(body.get('lm', True)), 'rejected': list(body.get('rejected') or [])}}
        while len(JOBS) > MAX_JOBS:
            JOBS.popitem(last=False)
        QUEUE.put(job_id)
        return reply(request, {'job': job_id, 'ahead': QUEUE.qsize() - 1})

    async def job(job_id: str, request: Request):
        j = JOBS.get(job_id)
        if not j:
            return reply(request, {'detail': '找不到這個工作（Space 可能重開過，請重新分析）'}, 404)
        out = {k: v for k, v in j.items() if k != 'req'}
        if j.get('started'):
            out['seconds'] = round((j.get('finished') or time.time()) - j['started'])
        return reply(request, out)

    api.add_api_route('/health', health, methods=['GET'])
    api.add_api_route('/analyze', analyze, methods=['POST'])
    api.add_api_route('/analyze', preflight, methods=['OPTIONS'])
    api.add_api_route('/jobs/{job_id}', job, methods=['GET'])
    api.add_api_route('/jobs/{job_id}', preflight, methods=['OPTIONS'])


def main():
    _prepare()
    import gradio as gr
    import brain
    import wordbank

    threading.Thread(target=_worker, daemon=True).start()

    def status():
        rows = [[j.get('unit', ''), j.get('status', ''), j.get('step', ''), time.strftime('%m/%d %H:%M', time.localtime(j.get('created', 0)))]
                for j in reversed(JOBS.values())]
        return f'引擎版本 {brain.ENGINE_VERSION}・單字表 {len(wordbank.load())} 個字・排隊中 {QUEUE.qsize()} 個', rows

    with gr.Blocks(title='B5 錯誤分析引擎') as demo:
        gr.Markdown('## B5 Practice 錯誤分析引擎\n老師後台「匯入內容 → 分析上方選的單元」會呼叫這裡。下面是最近的分析工作。')
        info = gr.Markdown()
        table = gr.Dataframe(headers=['單元', '狀態', '步驟', '時間'], interactive=False)
        gr.Button('重新整理').click(status, outputs=[info, table])
        demo.load(status, outputs=[info, table])

    # 由 Gradio 啟動伺服器（Space 給的埠號與代理設定都在這裡處理），啟動後再掛上 API 路由
    demo.launch(server_name='0.0.0.0', prevent_thread_lock=True, show_api=False)
    register(demo.server_app)
    print('API 路由已掛上：/health /analyze /jobs/{job}', flush=True)
    demo.block_thread()


if __name__ == '__main__':
    main()
