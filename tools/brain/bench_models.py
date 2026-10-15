"""比較語言模型：哪個最能分出「老師標成不適合（放進去也說得通）」和「留下來（說不通）」的課外選項，以及速度。

  .venv\\Scripts\\python bench_models.py distilroberta-base roberta-large Qwen/Qwen2.5-1.5B

資料：rejected_extras.json（老師與人工校對標成不適合的課外字）＝正例；out/*.json 裡留下來的課外選項＝反例。
分數：答案和選項放進句子的分數差（越小＝越像也說得通）。AUC 越接近 1 越準。
"""
import json
import os
import random
import re
import sys
import time

import torch

import brain

HERE = os.path.dirname(os.path.abspath(__file__))
DEV = 'cuda' if torch.cuda.is_available() else 'cpu'


def cases():
    """[((before, answer, after), 選項形式, 1＝也說得通／0＝說不通)]：
    rejected_extras.json＝老師標不適合；accepted_extras.json＝人工校對後留下來的（凍結的名單，不會被新的分析結果蓋掉）"""
    rej = set(json.load(open(os.path.join(HERE, 'rejected_extras.json'), encoding='utf-8')))
    acc = set(json.load(open(os.path.join(HERE, 'accepted_extras.json'), encoding='utf-8'))) - rej
    out = []
    for name in sorted(os.listdir(os.path.join(HERE, 'samples'))):
        uid = name[:-5]
        d = json.load(open(os.path.join(HERE, 'samples', name), encoding='utf-8'))
        for w in d['words']:
            for i, ex in enumerate(brain._examples(w)):
                parts = brain._split(ex)
                if not parts:
                    continue
                tag = None if (brain.slot(w, ex) or {}).get('need') in ('adj', 'adv', 'prep') else brain._penn_tag(ex)
                pre = f'{uid}|{w["word"]}|{i}|'
                for keys, y in ((rej, 1), (acc, 0)):
                    for k in sorted(k for k in keys if k.startswith(pre)):
                        out.append((parts, brain.inflect(k[len(pre):], tag), y))
    return out


class MLM:
    """遮罩語言模型的虛擬對數似然（目前用的方法）"""
    def __init__(self, name):
        from transformers import AutoModelForMaskedLM, AutoTokenizer
        self.tok = AutoTokenizer.from_pretrained(name)
        self.m = AutoModelForMaskedLM.from_pretrained(name, torch_dtype=torch.float16 if DEV == 'cuda' else torch.float32).to(DEV).eval()

    def score(self, sents):
        rows, own, tgt = [], [], []
        for si, s in enumerate(sents):
            ids = self.tok(s, return_tensors='pt')['input_ids'][0]
            for p in range(1, len(ids) - 1):
                r = ids.clone(); r[p] = self.tok.mask_token_id
                rows.append(r); own.append(si); tgt.append((p, int(ids[p])))
        out = [0.0] * len(sents)
        for s in range(0, len(rows), 512):
            chunk = rows[s:s + 512]
            L = max(len(r) for r in chunk)
            b = torch.full((len(chunk), L), self.tok.pad_token_id); att = torch.zeros_like(b)
            for i, r in enumerate(chunk):
                b[i, :len(r)] = r; att[i, :len(r)] = 1
            with torch.no_grad():
                lp = torch.log_softmax(self.m(b.to(DEV), attention_mask=att.to(DEV)).logits.float(), -1)
            for k in range(len(chunk)):
                p, t = tgt[s + k]
                out[own[s + k]] += float(lp[k, p, t])
        return out


class CLM:
    """一般（由左到右）語言模型：整句的對數機率"""
    def __init__(self, name):
        from transformers import AutoModelForCausalLM, AutoTokenizer
        self.tok = AutoTokenizer.from_pretrained(name)
        self.m = AutoModelForCausalLM.from_pretrained(name, torch_dtype=torch.float16 if DEV == 'cuda' else torch.float32).to(DEV).eval()
        self.bos = self.tok.bos_token_id if self.tok.bos_token_id is not None else self.tok.eos_token_id

    def score(self, sents):
        out = []
        for s in range(0, len(sents), 64):
            chunk = sents[s:s + 64]
            enc = [[self.bos] + self.tok(x, add_special_tokens=False)['input_ids'] for x in chunk]
            L = max(len(e) for e in enc)
            pad = self.tok.pad_token_id if self.tok.pad_token_id is not None else 0
            b = torch.full((len(enc), L), pad); att = torch.zeros_like(b)
            for i, e in enumerate(enc):
                b[i, :len(e)] = torch.tensor(e); att[i, :len(e)] = 1
            with torch.no_grad():
                lp = torch.log_softmax(self.m(b.to(DEV), attention_mask=att.to(DEV)).logits.float(), -1)
            for i, e in enumerate(enc):
                out.append(float(sum(lp[i, k - 1, e[k]] for k in range(1, len(e)))))
        return out


def auc(pairs):
    pos = [s for s, y in pairs if y]
    neg = [s for s, y in pairs if not y]
    # 正例（也說得通）分數差應該比較小
    win = sum((p < n) + 0.5 * (p == n) for p in pos for n in neg)
    return win / (len(pos) * len(neg))


def main():
    data = cases()
    print(f'{len(data)} 個例子（{sum(y for *_, y in data)} 個老師標不適合）；裝置 {DEV}', flush=True)
    for name in sys.argv[1:] or ['distilroberta-base']:
        model = MLM(name) if 'roberta' in name or 'bert' in name else CLM(name)
        sents = []
        for (before, ans, after), x, y in data:
            sents += [f'{before}{ans}{after}', f'{before}{x}{after}']
        if DEV == 'cuda':
            torch.cuda.synchronize()
        t = time.time()
        sc = model.score(sents)
        if DEV == 'cuda':
            torch.cuda.synchronize()
        dt = time.time() - t
        gaps = [(sc[2 * i] - sc[2 * i + 1], y) for i, (*_, y) in enumerate(data)]
        print(f'{name}: AUC {auc(gaps):.3f}，{dt:.1f} 秒（{len(sents)} 句）', flush=True)
        del model
        if DEV == 'cuda':
            torch.cuda.empty_cache()


if __name__ == '__main__':
    random.seed(0)
    main()
