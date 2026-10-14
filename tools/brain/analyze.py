"""錯誤分析引擎的命令列工具（在老師電腦上測準確度用；之後同一份 brain.py 會放到 Firebase 雲端自動執行）

  .venv\\Scripts\\python analyze.py fetch           從 Firebase 讀目前所有單字單元的題目，存到 samples/（只讀，不寫）
  .venv\\Scripts\\python analyze.py run             分析 samples/ 的每個單元，結果存到 out/<單元>.json
  .venv\\Scripts\\python analyze.py report          產生 report.html：模擬學生答錯的題目，老師逐題判斷分析準不準
  .venv\\Scripts\\python analyze.py run --lm        另外用語言模型檢查干擾選項、挑課外選項（每單元約 3～4 分鐘）
  .venv\\Scripts\\python analyze.py options         產生 options.html：每句例句被排除的同單元字、加進來的課外選項，老師檢查
"""
import json
import os
import random
import re
import sys
import urllib.request

import brain

HERE = os.path.dirname(os.path.abspath(__file__))
SAMPLES = os.path.join(HERE, 'samples')
OUT = os.path.join(HERE, 'out')
FS = 'https://firestore.googleapis.com/v1/projects/eng-3385e/databases/(default)/documents/public/'


def _public(doc_id):
    raw = json.loads(urllib.request.urlopen(FS + doc_id, timeout=20).read())
    return json.loads(raw['fields']['json']['stringValue'])


def fetch():
    os.makedirs(SAMPLES, exist_ok=True)
    cfg = _public('config')
    types = {u['id']: u['type'] for u in cfg.get('customUnits', [])}
    for uid in cfg.get('content', {}):
        if types.get(uid) != 'vocab':
            continue
        d = _public('content_' + uid)['data']
        with open(os.path.join(SAMPLES, uid + '.json'), 'w', encoding='utf-8') as f:
            json.dump(d, f, ensure_ascii=False, indent=1)
        print(uid, len(d.get('words', [])), '個字')


def units():
    for name in sorted(os.listdir(SAMPLES)):
        if name.endswith('.json'):
            with open(os.path.join(SAMPLES, name), encoding='utf-8') as f:
                yield name[:-5], json.load(f)


def run(with_lm=False):
    """with_lm：另外用語言模型檢查同單元的干擾選項、挑課外選項（每個單元約 3～4 分鐘）"""
    os.makedirs(OUT, exist_ok=True)
    for uid, d in units():
        a = brain.analyze(d)
        old_path = os.path.join(OUT, uid + '.json')
        if not with_lm and os.path.exists(old_path):
            # 沒加 --lm：語言模型的結果很花時間，單字沒變就沿用上一次的
            with open(old_path, encoding='utf-8') as f:
                old = json.load(f)
            if 'extra' in old and set(old.get('words', {})) == set(a['words']):
                a['unsafe'], a['extra'] = old['unsafe'], old['extra']
        if with_lm:
            a['unsafe'] = brain.option_safety(d, a)
            a['extra'] = brain.extra_options(d, a, random.Random(uid))
        with open(os.path.join(OUT, uid + '.json'), 'w', encoding='utf-8') as f:
            json.dump(a, f, ensure_ascii=False)
        print(uid, len(a['words']), '個字', len(a['pairs']), '組有關係：', a['pairs'])


def _blank(ex):
    return re.sub(r'\[[^\]]+\]', '____', ex)


def _form(w, i=0):
    """這個字在自己例句裡的形式（例句選字題的選項就是這個）"""
    exs = brain._examples(w)
    m = re.search(r'\[([^\]]+)\]', exs[i] if i < len(exs) else (exs[0] if exs else ''))
    return m.group(1) if m else w['word']


def cases(uid, d, a, rng):
    """模擬學生答錯：每個字挑幾題（例句選字、中→英、英→中），干擾選項和網站一樣從同類（單字配單字、片語配片語）裡挑，
    有特殊關係（形近、同字根、意思相近…）的組合一定列入，其他隨機抽"""
    words = d['words']
    out = []
    for t in words:
        same = [w for w in words if w is not t and (w.get('type') == 'phrase') == (t.get('type') == 'phrase')]
        related = [w for w in same if '|'.join(sorted([t['word'], w['word']])) in a['pairs']]
        others = [w for w in same if w not in related]
        rng.shuffle(others)
        picks = [(w, 'cloze') for w in related] + [(w, 'zh2en') for w in related[:1]]
        picks += [(others[0], 'cloze')] if others else []
        if len(others) > 1 and rng.random() < 0.5:
            picks.append((others[1], rng.choice(['zh2en', 'en2zh'])))
        for c, kind in picks:
            exs = brain._examples(t)
            idx = rng.randrange(len(exs)) if exs else 0
            cat, tip, st = brain.explain(a, d, t['word'], c['word'], kind, idx)
            # 題目的四個選項：正確答案、學生選的，再從同類裡隨機補到 4 個（和網站出題一樣）
            fill = [w['word'] for w in same if w is not c]
            rng.shuffle(fill)
            opts = [t['word'], c['word']] + fill[:2]
            rng.shuffle(opts)
            walk = brain.walkthrough(a, d, t['word'], opts, kind, idx, chosen=c['word'])
            if kind == 'cloze':
                q, yours, right = _blank(exs[idx]), _form(c), _form(t, idx)
            elif kind == 'zh2en':
                q, yours, right = f"{t['zh']}（選出英文）", c['word'], t['word']
            else:
                q, yours, right = f"{t['word']}（選出中文）", c['zh'], t['zh']
            out.append({'id': f"{uid}|{t['word']}|{c['word']}|{kind}|{idx}", 'unit': uid, 'kind': {'cloze': '例句選字', 'zh2en': '中→英', 'en2zh': '英→中'}[kind],
                        'q': q, 'yours': yours, 'right': right, 'cat': cat, 'tip': tip, 'study': st, 'walk': walk, 'old': '意思混淆'})
    return out


def report():
    rng = random.Random(7)
    allc = []
    for uid, d in units():
        allc += cases(uid, d, brain.analyze(d), rng)
    with open(os.path.join(HERE, 'report.template.html'), encoding='utf-8') as f:
        html = f.read()
    html = html.replace('/*CASES*/[]', json.dumps(allc, ensure_ascii=False))
    with open(os.path.join(HERE, 'report.html'), 'w', encoding='utf-8') as f:
        f.write(html)
    from collections import Counter
    print(len(allc), '題；分類：', dict(Counter(c['cat'] for c in allc)))


def options():
    """出題檢查頁：需要先跑 run --lm"""
    rows = []
    for uid, d in units():
        path = os.path.join(OUT, uid + '.json')
        if not os.path.exists(path):
            continue
        with open(path, encoding='utf-8') as f:
            a = json.load(f)
        if 'extra' not in a:
            continue
        for w in d['words']:
            for i, (ex, zh) in enumerate(brain.example_pairs(w)):
                un = a['unsafe'].get(w['word']) or []
                ext = a['extra'].get(w['word']) or []
                rows.append({'id': f"{uid}|{w['word']}|{i}", 'unit': uid, 'word': w['word'], 'zh': w['zh'], 'ex': ex, 'exZh': zh,
                             'unsafe': un[i] if i < len(un) else [], 'extra': ext[i] if i < len(ext) else []})
    with open(os.path.join(HERE, 'options.template.html'), encoding='utf-8') as f:
        html = f.read().replace('/*ROWS*/[]', json.dumps(rows, ensure_ascii=False))
    with open(os.path.join(HERE, 'options.html'), 'w', encoding='utf-8') as f:
        f.write(html)
    print(len(rows), '句例句')


if __name__ == '__main__':
    cmd = sys.argv[1] if len(sys.argv) > 1 else 'run'
    if cmd == 'run' and '--lm' in sys.argv:
        run(True)
    else:
        {'fetch': fetch, 'run': run, 'report': report, 'options': options}[cmd]()
