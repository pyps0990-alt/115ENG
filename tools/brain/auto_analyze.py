"""自動錯誤分析（GitHub Actions 定時執行，不用開網頁、不用開電腦）

  python auto_analyze.py check     只檢查：用的是哪個服務帳戶、能不能寫 Firestore、有哪些單元待分析（不寫任何東西）
  python auto_analyze.py run       分析所有「題目改過、還沒分析」的單字單元，分析完一個就寫回 public/analysis_<單元>

憑證：環境變數 GOOGLE_APPLICATION_CREDENTIALS 指到服務帳戶的 JSON（workflow 從 GitHub Secrets 的 FIREBASE_SERVICE_ACCOUNT 寫出來）。
讀題目用公開的 public/content_<單元>；寫回的格式和老師後台「開始分析」一樣（public/analysis_<單元> 的 json 欄位）。
"""
import json
import os
import random
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

import brain

PROJECT = os.environ.get('FIREBASE_PROJECT', 'eng-3385e')
ROOT = f'projects/{PROJECT}/databases/(default)/documents'
API = 'https://firestore.googleapis.com/v1/'
BUDGET_SEC = int(os.environ.get('BUDGET_SEC', str(5 * 3600)))  # GitHub 一個工作最多 6 小時：留一點時間寫回、收尾
_creds = None


def token():
    global _creds
    import google.auth.transport.requests
    from google.oauth2 import service_account
    if _creds is None:
        _creds = service_account.Credentials.from_service_account_file(
            os.environ['GOOGLE_APPLICATION_CREDENTIALS'], scopes=['https://www.googleapis.com/auth/cloud-platform'])
    if not _creds.valid:
        _creds.refresh(google.auth.transport.requests.Request())
    return _creds.token


def call(method, url, body=None):
    req = urllib.request.Request(url, method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={'Authorization': 'Bearer ' + token(), 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read() or b'{}')
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return None
        raise RuntimeError(f'{method} {url.split("?")[0]} → HTTP {e.code}：{e.read()[:300].decode("utf-8", "replace")}')


def public(doc_id):
    d = call('GET', API + f'{ROOT}/public/' + urllib.parse.quote(doc_id))
    return json.loads(d['fields']['json']['stringValue']) if d and 'fields' in d else None


def pending():
    """[(單元, 標題, 題目資料, 狀態)]：題目改過或沒分析過的單字單元"""
    cfg = public('config') or {}
    units = [u for u in cfg.get('customUnits', []) if u.get('type') == 'vocab']
    out = []
    for u in units:
        uid = u['id']
        c = public('content_' + uid)
        data = (c or {}).get('data') or {}
        words = [w for w in data.get('words', []) if w.get('word')]
        if not words:
            continue
        old = public('analysis_' + uid)
        if old and old.get('sig') == brain.signature(words):
            continue
        out.append((uid, u.get('title') or uid, data, '題目改過' if old else '還沒分析'))
    return out


def publish(uid, a):
    body = {'writes': [{'update': {'name': f'{ROOT}/public/analysis_{uid}', 'fields': {'json': {'stringValue': json.dumps(a, ensure_ascii=False)}}}}]}
    call('POST', API + f'{ROOT}:commit', body)


def check():
    with open(os.environ['GOOGLE_APPLICATION_CREDENTIALS'], encoding='utf-8') as f:
        email = json.load(f).get('client_email', '?')
    print('服務帳戶：', email)
    need = ['datastore.entities.get', 'datastore.entities.create', 'datastore.entities.update']
    try:
        got = (call('POST', f'https://cloudresourcemanager.googleapis.com/v1/projects/{PROJECT}:testIamPermissions', {'permissions': need}) or {}).get('permissions', [])
        miss = [p for p in need if p not in got]
        print('寫 Firestore 的權限：', '✓ 都有' if not miss else '✗ 缺 ' + '、'.join(miss) + '（到 Google Cloud Console → IAM 幫這個帳戶加「Cloud Datastore 使用者」角色）')
    except Exception as e:  # noqa: BLE001
        print('查不到權限（Cloud Resource Manager API 可能沒開）：', e)
    items = pending()
    print('待分析：', len(items), '個單元')
    for uid, title, data, state in items:
        print('  ', title, f'({uid})', len(data.get('words', [])), '個字', state)
    return 0


def run():
    t_start = time.time()
    items = pending()
    print('待分析：', len(items), '個單元', flush=True)
    done = 0
    for uid, title, data, state in items:
        if time.time() - t_start > BUDGET_SEC:
            print('時間快到了，剩下的下一次再做', flush=True)
            break
        t0 = time.time()
        print(f'分析 {title}（{uid}，{state}，{len(data.get("words", []))} 個字）…', flush=True)
        a = brain.analyze(data)
        a['unsafe'] = brain.option_safety(data, a)
        a['extra'] = brain.extra_options(data, a, random.Random(uid), uid=uid)
        a['at'] = int(time.time() * 1000)
        publish(uid, a)
        done += 1
        print(f'  已寫回網站（{time.time() - t0:.0f} 秒）', flush=True)
    print('完成', done, '個單元', flush=True)
    return 0


if __name__ == '__main__':
    mode = sys.argv[1] if len(sys.argv) > 1 else 'check'
    sys.exit(run() if mode == 'run' else check())
