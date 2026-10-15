"""語言模型：判斷一個字放進例句裡「也說得通」的機率（0～1）。

兩個 Qwen2.5-1.5B 一起判斷（在老師電腦的 GPU 上一個單元約 1 分鐘內）：
  1. 句子分數差：一般語言模型（Qwen2.5-1.5B）算「答案放進去」和「選項放進去」整句的對數機率，差越小越像也說得通
  2. 問答判斷：指令模型（Qwen2.5-1.5B-Instruct）直接回答「這個字放進空格也自然、也對嗎？Yes／No」
兩個分數用老師標過的課外選項（rejected_extras.json＝也說得通；留下來的＝說不通）訓練成一個機率（train_lm.py → lm_model.json）。
在老師標過的資料上，準確度（AUC）0.73；舊的 DistilRoBERTa 是 0.53。

沒有 GPU（例如 Cloud Run）一樣能跑，只是比較慢。
只在分析題目時（老師電腦或雲端）執行，學生端不用下載模型。
"""
import json
import math
import os

HERE = os.path.dirname(os.path.abspath(__file__))
BASE = 'Qwen/Qwen2.5-1.5B'
CHAT = 'Qwen/Qwen2.5-1.5B-Instruct'
_m = {}

# 機率門檻（train_lm.py 依老師標記決定，存在 lm_model.json；這裡是沒有該檔時的預設）
P_UNSAFE = 0.5   # 同單元的字：機率 ≥ 這個值＝放進去也說得通，不拿來當這句的選項
P_EXTRA = 0.3    # 課外選項：機率 ≤ 這個值才用（確定說不通）


def _device():
    import torch
    return 'cuda' if torch.cuda.is_available() else 'cpu'


def _load(name):
    if name not in _m:
        os.environ.setdefault('HF_HOME', os.path.join(HERE, 'models'))
        import torch
        from transformers import AutoModelForCausalLM, AutoTokenizer
        dev = _device()
        tok = AutoTokenizer.from_pretrained(name)
        tok.padding_side = 'left'
        if tok.pad_token is None:
            tok.pad_token = tok.eos_token
        model = AutoModelForCausalLM.from_pretrained(name, dtype=torch.float16 if dev == 'cuda' else torch.float32).to(dev).eval()
        _m[name] = (tok, model)
    return _m[name]


def sentence_scores(sentences, batch=32):
    """每一句的對數機率（越高越自然）"""
    import torch
    tok, model = _load(BASE)
    bos = tok.bos_token_id if tok.bos_token_id is not None else tok.eos_token_id
    out = []
    for s in range(0, len(sentences), batch):
        enc = [[bos] + tok(x, add_special_tokens=False)['input_ids'] for x in sentences[s:s + batch]]
        L = max(len(e) for e in enc)
        ids = torch.full((len(enc), L), tok.pad_token_id)
        att = torch.zeros_like(ids)
        for i, e in enumerate(enc):  # 右邊補齊（算每個字的機率比較直接）
            ids[i, :len(e)] = torch.tensor(e)
            att[i, :len(e)] = 1
        with torch.no_grad():
            lp = torch.log_softmax(model(ids.to(model.device), attention_mask=att.to(model.device)).logits.float(), -1)
        for i, e in enumerate(enc):
            t = torch.tensor(e[1:], device=lp.device)
            out.append(float(lp[i, torch.arange(len(e) - 1, device=lp.device), t].sum()))
    return out


def judge(items, batch=32):
    """items：[(before, answer, after, option)]。回傳每個的「Yes 對 No」對數勝算（越大越像也說得通）"""
    import torch
    tok, model = _load(CHAT)
    yes = [tok(x, add_special_tokens=False)['input_ids'][0] for x in ('Yes', ' Yes')]
    no = [tok(x, add_special_tokens=False)['input_ids'][0] for x in ('No', ' No')]
    prompts = []
    for b, ans, a, x in items:
        q = (f'Sentence: "{b}____{a}"\nThe intended answer is "{ans}".\n'
             f'Would "{x}" also be a natural, correct, and sensible word in the blank '
             f'(so a student choosing it could argue it is right)? Answer Yes or No.')
        prompts.append(tok.apply_chat_template([{'role': 'user', 'content': q}], tokenize=False, add_generation_prompt=True))
    out = []
    for s in range(0, len(prompts), batch):
        enc = tok(prompts[s:s + batch], return_tensors='pt', padding=True).to(model.device)
        with torch.no_grad():
            lp = torch.log_softmax(model(**enc).logits[:, -1].float(), -1)
        for r in lp:
            out.append(float(torch.logsumexp(r[yes], 0) - torch.logsumexp(r[no], 0)))
    return out


def features(before, after, answer, options):
    """[(句子分數差, 問答判斷)]，順序同 options"""
    sc = sentence_scores([f'{before}{answer}{after}'] + [f'{before}{o}{after}' for o in options])
    jd = judge([(before, answer, after, o) for o in options])
    return [(sc[0] - s, j) for s, j in zip(sc[1:], jd)]


_W = None


def _weights():
    global _W, P_UNSAFE, P_EXTRA
    if _W is None:
        path = os.path.join(HERE, 'lm_model.json')
        if os.path.exists(path):
            with open(path, encoding='utf-8') as f:
                _W = json.load(f)
            P_UNSAFE, P_EXTRA = _W['p_unsafe'], _W['p_extra']
        else:
            _W = {'mean': [10.0, -2.0], 'sd': [8.0, 2.0], 'w': [-1.0, 1.0], 'b': -0.5}
    return _W


def prob(feat):
    """把 (句子分數差, 問答判斷) 換成「也說得通」的機率"""
    W = _weights()
    z = W['b'] + sum(w * (x - m) / s for w, x, m, s in zip(W['w'], feat, W['mean'], W['sd']))
    return 1 / (1 + math.exp(-z))


def fit(before, after, answer, options):
    """answer 與 options 放進「before＿＿after」：回傳 {選項: 也說得通的機率}"""
    opts = [o for o in dict.fromkeys(options) if o != answer]
    if not opts:
        return {}
    _weights()
    return {o: round(prob(f), 3) for o, f in zip(opts, features(before, after, answer, opts))}
