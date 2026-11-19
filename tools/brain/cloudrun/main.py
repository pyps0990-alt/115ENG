"""錯誤分析引擎（Google Cloud Run）

Cloud Run 只在「有請求進來」時給 CPU，所以不能「先回 job 編號、背景慢慢算」：
老師後台直接呼叫 POST /analyze，這個請求一路等到分析完才回應（Cloud Run 的請求逾時設 60 分鐘）。
回應是一行一個 JSON（NDJSON）：分析期間每 2 秒一行進度 {"p": {stage, step, steps, done, total, word, sec}}
（同時當心跳，避免學校網路或代理把閒置連線切掉），最後一行是 {"result": …} 或 {"error": …}。

  GET  /health    健康檢查（單字表字數、引擎版本）
  POST /event     Firestore 事件（Eventarc）：public/content_<單元> 被寫入時呼叫，單字單元題目改過就分析並寫回 public/analysis_<單元>
  POST /sweep     把所有「題目改過、還沒分析」的單字單元分析完並寫回（部署後補做一次，或手動觸發）
  POST /analyze   標頭 X-Brain-Key；本文 {unit, data: {words:[…]}, lm: true, rejected: []}
                  回進度行＋最後一行 {result: {…}} 或 {error: "…"}

環境變數：
  BRAIN_KEY       老師後台呼叫 /analyze 時帶的金鑰（自動分析的服務可以不設，/event、/sweep 靠 Cloud Run 的 IAM 保護）
  ALLOW_ORIGINS   選填。允許呼叫的網站，逗號分隔（預設 eng-3385e 的兩個網址）
  ALLOW_ORIGIN_REGEX 選填。另外允許的網址規則（預設 Firebase 預覽頻道 eng-3385e--*.web.app）
"""
import asyncio
import json
import urllib.error
import os
import random
import re
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
# Firebase 預覽頻道（.github/workflows/preview.yml）的網址 eng-3385e--preview-xxxx.web.app 也可以呼叫（先在預覽網站測試再上線）
ORIGIN_RE = os.environ.get('ALLOW_ORIGIN_REGEX', r'https://eng-3385e--[a-z0-9-]+\.web\.app')
# 新版 Starlette（1.x）自己處理 Chrome 的 Private Network Access：沒有開 allow_private_network，
# 網站呼叫本機（127.0.0.1）的預檢一律回 400「Disallowed CORS private-network」，本機分析整個不能用。舊版沒有這個參數就不傳（由下面的中介層補標頭）
import inspect
_PNA = {'allow_private_network': True} if 'allow_private_network' in inspect.signature(CORSMiddleware.__init__).parameters else {}
app.add_middleware(CORSMiddleware, allow_origins=ORIGINS, allow_origin_regex=ORIGIN_RE or None, allow_methods=['GET', 'POST', 'OPTIONS'],
                   allow_headers=['Content-Type', 'X-Brain-Key'], max_age=600, **_PNA)

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


# ---------------------------------------------------------------------------------------------
# 自動分析（不用開網頁）：老師在後台存了單字單元 → Firestore 的 public/content_<單元> 被寫入 →
# Eventarc 通知這個服務的 /event → 題目真的改過才分析 → 結果寫回 public/analysis_<單元>（和老師後台「開始分析」存的格式一樣）。
# 這兩個路徑沒有金鑰檢查：部署成「不公開」的服務（--no-allow-unauthenticated），只有 Eventarc／排程用的服務帳戶能呼叫（見 DEPLOY-AUTO.md）。
PROJECT = os.environ.get('GOOGLE_CLOUD_PROJECT') or 'eng-3385e'
_ROOT = f'projects/{PROJECT}/databases/(default)/documents'
_FS = 'https://firestore.googleapis.com/v1/'


def _token():
    """Cloud Run 服務帳戶的存取權杖（服務帳戶要有 Cloud Datastore 使用者角色）"""
    import google.auth
    import google.auth.transport.requests
    global _creds
    if '_creds' not in globals() or _creds is None:
        _creds, _ = google.auth.default(scopes=['https://www.googleapis.com/auth/datastore'])
    if not _creds.valid:
        _creds.refresh(google.auth.transport.requests.Request())
    return _creds.token


_creds = None


def _fs(method, path, body=None):
    import urllib.request
    req = urllib.request.Request(_FS + path, method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={'Authorization': 'Bearer ' + _token(), 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read() or b'{}')
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return None
        raise RuntimeError(f'Firestore {method} {path} → HTTP {e.code} {e.read()[:300]!r}')


def _public(doc_id):
    d = _fs('GET', f'{_ROOT}/public/{doc_id}')
    return json.loads(d['fields']['json']['stringValue']) if d and 'fields' in d else None


def _vocab_units():
    cfg = _public('config') or {}
    return {u['id']: u for u in cfg.get('customUnits', []) if u.get('type') == 'vocab'}


def _needs(uid):
    """(題目資料, 狀態)：狀態是 None＝不用分析（不是單字單元、沒有題目、已經分析過同一份題目）"""
    c = _public('content_' + uid)
    data = (c or {}).get('data') or {}
    words = [w for w in data.get('words', []) if w.get('word')]
    if not words:
        return data, None
    old = _public('analysis_' + uid)
    if old and old.get('sig') == brain.signature(words):
        return data, None
    return data, ('題目改過' if old else '還沒分析')


def _publish(uid, a):
    body = {'writes': [{'update': {'name': f'{_ROOT}/public/analysis_{uid}', 'fields': {'json': {'stringValue': json.dumps(a, ensure_ascii=False)}}}}]}
    _fs('POST', f'{_ROOT}:commit', body)


def _auto_one(uid):
    """分析一個單元並寫回（題目沒改就略過）。回傳說明文字"""
    if uid not in _vocab_units():
        return f'{uid}：不是單字單元，略過'
    data, state = _needs(uid)
    if not state:
        return f'{uid}：已經是最新的分析，略過'
    t0 = time.time()
    state_box = {'step': 0, 'stage': '', 'done': 0, 'total': 0, 'word': ''}
    a = _run({'unit': uid, 'data': data, 'lm': True, 'rejected': []}, state_box)
    a['at'] = int(time.time() * 1000)
    _publish(uid, a)
    return f'{uid}：{state}，{len(a.get("words", {}))} 個字，{time.time() - t0:.0f} 秒，已寫回'


def _unit_from_event(body, headers):
    """從 Eventarc 的 Firestore 事件找出是哪個單元：public/content_<單元>"""
    names = [headers.get('ce-subject', ''), headers.get('ce-document', '')]
    if isinstance(body, dict):
        for k in ('value', 'oldValue'):
            v = body.get(k) or {}
            if isinstance(v, dict):
                names.append(v.get('name', ''))
    for n in names:
        m = re.search(r'(?:^|/)public/content_([^/]+)$', n or '')
        if m:
            return m.group(1)
    return None


@app.post('/event')
async def event(request: Request):
    raw = await request.body()
    try:
        body = json.loads(raw) if raw else {}
    except Exception:  # noqa: BLE001  （不是 JSON：只靠標頭的 ce-subject 判斷）
        body = {}
    uid = _unit_from_event(body, {k.lower(): v for k, v in request.headers.items()})
    if not uid:
        return JSONResponse({'ok': True, 'skip': '不是單元題目的事件'})
    loop = asyncio.get_running_loop()
    try:
        msg = await loop.run_in_executor(None, _auto_one, uid)
    except Exception as e:  # noqa: BLE001  回 500 讓 Eventarc 稍後重送
        traceback.print_exc()
        return JSONResponse({'ok': False, 'error': f'{type(e).__name__}: {e}'}, status_code=500)
    print(msg, flush=True)
    return JSONResponse({'ok': True, 'result': msg})


@app.post('/sweep')
async def sweep():
    loop = asyncio.get_running_loop()

    def go():
        out = []
        for uid in _vocab_units():
            try:
                out.append(_auto_one(uid))
            except Exception as e:  # noqa: BLE001
                traceback.print_exc()
                out.append(f'{uid}：失敗 {type(e).__name__}: {e}')
        return out
    res = await loop.run_in_executor(None, go)
    for m in res:
        print(m, flush=True)
    return JSONResponse({'ok': True, 'results': res})
