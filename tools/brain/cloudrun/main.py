"""錯誤分析引擎（Google Cloud Run）

Cloud Run 只在「有請求進來」時給 CPU，所以不能「先回 job 編號、背景慢慢算」：
老師後台直接呼叫 POST /analyze，這個請求一路等到分析完才回應（Cloud Run 的請求逾時設 60 分鐘）。
回應是一行一個 JSON（NDJSON）：分析期間每 2 秒一行進度 {"p": {stage, step, steps, done, total, word, sec}}
（同時當心跳，避免學校網路或代理把閒置連線切掉），最後一行是 {"result": …} 或 {"error": …}。

  GET  /health    健康檢查（單字表字數、引擎版本）
  POST /analyze   標頭 X-Brain-Key；本文 {unit, data: {words:[…]}, lm: true, rejected: []}
                  回進度行＋最後一行 {result: {…}} 或 {error: "…"}

環境變數：
  BRAIN_KEY       必填。老師後台呼叫時帶的金鑰
  ALLOW_ORIGINS   選填。允許呼叫的網站，逗號分隔（預設 eng-3385e 的兩個網址）
"""
import asyncio
import json
import os
import random
import secrets
import threading
import time
import traceback

from fastapi import FastAPI, Header, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse

import brain
import wordbank

ORIGINS = [o.strip() for o in os.environ.get('ALLOW_ORIGINS', 'https://eng-3385e.web.app,https://eng-3385e.firebaseapp.com').split(',') if o.strip()]
app = FastAPI(title='B5 錯誤分析引擎', docs_url=None, redoc_url=None, openapi_url=None)
app.add_middleware(CORSMiddleware, allow_origins=ORIGINS, allow_methods=['GET', 'POST', 'OPTIONS'],
                   allow_headers=['Content-Type', 'X-Brain-Key'], max_age=600)

@app.middleware('http')
async def _private_network(request, call_next):
    """本機執行（老師電腦 127.0.0.1）時：網站從 https 呼叫本機要多一個許可標頭（Chrome 的 Private Network Access）"""
    resp = await call_next(request)
    if request.headers.get('access-control-request-private-network'):
        resp.headers['Access-Control-Allow-Private-Network'] = 'true'
    return resp


_lock = threading.Lock()  # 一個實例一次只分析一個單元（記憶體與 CPU 都吃緊）


_STEPS = 3


def _run(req, state):
    """真正的分析（在執行緒裡跑，不擋住進度回報）。state：目前進度，串流每 2 秒讀一次回報給後台"""
    def stage(step, name):
        state.update(step=step, stage=name, done=0, total=0, word='')

    def prog(done, total, word):
        state.update(done=done, total=total, word=word)

    if _lock.locked():
        stage(0, '等另一個單元分析完')
    with _lock:
        data = req['data']
        brain.EXTRA_REJECTED = set(req.get('rejected') or [])
        stage(1, '分析詞性與字詞關係')
        a = brain.analyze(data)
        if req.get('lm', True):
            stage(2, '檢查同單元選項會不會也說得通')
            a['unsafe'] = brain.option_safety(data, a, progress=prog)
            stage(3, '挑選課外選項')
            a['extra'] = brain.extra_options(data, a, random.Random(req['unit']), uid=req['unit'], progress=prog)
        return a


@app.get('/health')
def health():
    return {'ok': True, 'engine': brain.ENGINE_VERSION, 'wordbank': len(wordbank.load())}


@app.post('/analyze')
async def analyze(request: Request, x_brain_key: str = Header(default='')):
    key = os.environ.get('BRAIN_KEY', '')
    if not key or not secrets.compare_digest(x_brain_key, key):
        return JSONResponse({'error': '金鑰不正確'}, status_code=401)
    try:
        body = await request.json()
        req = {'unit': str(body['unit']), 'data': body['data'], 'lm': bool(body.get('lm', True)), 'rejected': list(body.get('rejected') or [])}
        words = req['data'].get('words')
        if not isinstance(words, list) or not words:
            raise ValueError('沒有單字')
    except Exception:  # noqa: BLE001
        return JSONResponse({'error': '內容格式不正確（需要 unit 與 data.words）'}, status_code=400)
    if len(words) > 150:
        return JSONResponse({'error': '一個單元最多 150 個字'}, status_code=413)

    async def stream():
        loop = asyncio.get_running_loop()
        state = {'step': 0, 'stage': '準備中', 'done': 0, 'total': 0, 'word': ''}
        fut = loop.run_in_executor(None, _run, req, state)
        t0 = time.time()
        line = lambda o: (json.dumps(o, ensure_ascii=False) + chr(10)).encode('utf-8')
        while True:
            yield line({'p': dict(state, steps=_STEPS, sec=round(time.time() - t0))})  # 進度（也是心跳）
            try:
                result = await asyncio.wait_for(asyncio.shield(fut), timeout=2)
                break
            except asyncio.TimeoutError:
                continue
            except Exception as e:  # noqa: BLE001
                traceback.print_exc()
                yield line({'error': f'{type(e).__name__}: {e}'})
                return
        yield line({'result': result, 'seconds': round(time.time() - t0)})

    return StreamingResponse(stream(), media_type='application/x-ndjson')
