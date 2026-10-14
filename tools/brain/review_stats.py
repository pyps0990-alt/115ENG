"""老師標成「不適合」的課外選項（rejected_extras.json）和目前分析結果比對：看模型分數（gap）、詞性、級數有沒有規律，用來調整挑選規則。"""
import glob
import json
import os
import statistics as st
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
rej = set(json.load(open(os.path.join(HERE, 'rejected_extras.json'), encoding='utf-8')))
rows = []
for f in glob.glob(os.path.join(HERE, 'out', '*.json')):
    uid = os.path.basename(f)[:-5]
    a = json.load(open(f, encoding='utf-8'))
    for w, per in a['extra'].items():
        for i, lst in enumerate(per):
            for o in lst:
                rows.append((f'{uid}|{w}|{i}|{o["word"]}' in rej, o['gap'], o['word'], o['level'], o['pos'], w, i))
bad = [r for r in rows if r[0]]
ok = [r for r in rows if not r[0]]
print('總', len(rows), '不適合', len(bad), '保留', len(ok), '| 清單裡找不到對應的', len(rej) - len(bad))
for name, g in (('不適合', bad), ('保留', ok)):
    gs = sorted(r[1] for r in g)
    print(name, 'gap 最小/25%/中位/75%/最大', gs[0], gs[len(gs) // 4], st.median(gs), gs[3 * len(gs) // 4], gs[-1])
for th in (9, 11, 12, 13, 14, 15, 16, 18):
    b = sum(1 for r in bad if r[1] < th)
    o = sum(1 for r in ok if r[1] < th)
    print(f'  門檻提高到 {th}: 擋掉不適合 {b}/{len(bad)}，連保留的也擋掉 {o}/{len(ok)}')
print('級數 不適合', sorted(Counter(r[3] for r in bad).items()), '保留', sorted(Counter(r[3] for r in ok).items()))
print('詞性 不適合', Counter(r[4] for r in bad).most_common(5), '保留', Counter(r[4] for r in ok).most_common(5))
