"""用老師的標記訓練 lm.py 的判斷（標得越多越準；之後每次多標一批不適合的課外選項，就重跑一次）

  .venv\\Scripts\\python train_lm.py

資料：rejected_extras.json 的課外字＝也說得通（1）；accepted_extras.json（人工校對後留下的課外選項）＝說不通（0）。
輸出 lm_model.json：兩個特徵的平均、標準差、權重，以及兩個門檻：
  p_unsafe：同單元的字機率 ≥ 它就盡量不當這句的選項（說不通的字只有約 20% 會被誤判）
  p_extra：課外選項機率 ≤ 它才用（老師標不適合的課外字，約 85% 會被擋掉）
"""
import json
import os
import random

import torch

import bench_models
import lm

HERE = os.path.dirname(os.path.abspath(__file__))


def train(X, Y, l2=1e-2):
    w = torch.zeros(X.shape[1] + 1, requires_grad=True)
    opt = torch.optim.LBFGS([w], max_iter=300)
    Xb = torch.cat([X, torch.ones(len(X), 1)], 1)

    def closure():
        opt.zero_grad()
        loss = torch.nn.functional.binary_cross_entropy_with_logits(Xb @ w, Y) + l2 * (w[:-1] ** 2).sum()
        loss.backward()
        return loss
    opt.step(closure)
    return w.detach()


def main():
    data = bench_models.cases()
    print(f'{len(data)} 個標記（{sum(y for *_, y in data)} 個不適合），計算特徵…', flush=True)
    feats = []
    by_sent = {}
    for i, ((b, ans, a), x, y) in enumerate(data):
        by_sent.setdefault((b, ans, a), []).append(i)
    feats = [None] * len(data)
    for (b, ans, a), idx in by_sent.items():
        for i, f in zip(idx, lm.features(b, a, ans, [data[i][1] for i in idx])):
            feats[i] = f
    X = torch.tensor(feats)
    Y = torch.tensor([float(y) for *_, y in data])
    mean, sd = X.mean(0), X.std(0)
    Xn = (X - mean) / sd

    # 交叉驗證（依句子分組，同一句不會同時出現在訓練與測試）：回報真實準確度
    sents = sorted(by_sent); random.Random(0).shuffle(sents)
    pred = torch.zeros(len(Y))
    for k in range(5):
        test = set(i for s in sents[k::5] for i in by_sent[s])
        te = torch.tensor([i in test for i in range(len(Y))])
        w = train(Xn[~te], Y[~te])
        pred[te] = torch.cat([Xn[te], torch.ones(int(te.sum()), 1)], 1) @ w
    cv = bench_models.auc(list(zip((-pred).tolist(), Y.tolist())))

    w = train(Xn, Y)
    p = torch.sigmoid(torch.cat([Xn, torch.ones(len(Y), 1)], 1) @ w)
    pos = sorted(p[Y == 1].tolist())
    neg = p[Y == 0]
    # 同單元的字：只排除比較確定的（說不通的字只有 20% 會被誤排除），不然一句會少掉太多干擾選項
    p_unsafe = sorted(neg.tolist())[int(len(neg) * 0.8)]
    p_extra = pos[int(len(pos) * 0.15)]   # 課外字：也說得通的只有 15% 機率在這之下
    out = {'models': [lm.BASE, lm.CHAT], 'features': ['句子分數差', '問答判斷'],
           'mean': mean.tolist(), 'sd': sd.tolist(), 'w': w[:-1].tolist(), 'b': float(w[-1]),
           'p_unsafe': round(p_unsafe, 3), 'p_extra': round(p_extra, 3), 'cv_auc': round(cv, 3), 'labels': len(data)}
    with open(os.path.join(HERE, 'lm_model.json'), 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    print(f'交叉驗證準確度（AUC）{cv:.3f}')
    print(f'p_unsafe {p_unsafe:.3f}：也說得通的抓到 {float((p[Y == 1] >= p_unsafe).float().mean()):.0%}，說不通的誤判 {float((neg >= p_unsafe).float().mean()):.0%}')
    print(f'p_extra {p_extra:.3f}：留下來的課外字有 {float((neg <= p_extra).float().mean()):.0%} 仍可用；'
          f'老師標不適合的只有 15% 會漏過')


if __name__ == '__main__':
    main()
