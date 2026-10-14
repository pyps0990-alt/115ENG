"""小型語言模型：判斷一個字放進例句裡「讀起來通不通」。

用遮罩語言模型（DistilRoBERTa）算整句的「虛擬對數似然」(pseudo-log-likelihood)：句子裡每個字輪流遮住，
看模型多有把握猜回原本的字，全部加起來。句子越自然分數越高。
把每個選項放進空格各算一次，和正確答案比：分數差距很小的干擾選項代表「放進去也說得通」，出題時不拿來用。

只在匯入題目時（老師電腦或雲端）執行，學生端不用下載模型。
"""
import os

HERE = os.path.dirname(os.path.abspath(__file__))
MODEL = 'distilroberta-base'
_tok = _model = None


def _load():
    global _tok, _model
    if _model is None:
        os.environ.setdefault('HF_HOME', os.path.join(HERE, 'models'))
        from transformers import AutoModelForMaskedLM, AutoTokenizer
        import torch  # noqa: F401
        _tok = AutoTokenizer.from_pretrained(MODEL)
        _model = AutoModelForMaskedLM.from_pretrained(MODEL)
        _model.eval()
    return _tok, _model


def pll(sentences):
    """每一句的虛擬對數似然（越高越自然）。一次把同一句的所有遮罩版本送進模型"""
    import torch
    tok, model = _load()
    out = []
    for s in sentences:
        ids = tok(s, return_tensors='pt')['input_ids'][0]
        n = len(ids)
        pos = list(range(1, n - 1))  # 不算開頭結尾的特殊符號
        batch = ids.repeat(len(pos), 1)
        for r, p in enumerate(pos):
            batch[r, p] = tok.mask_token_id
        with torch.no_grad():
            logits = model(batch).logits
        logp = torch.log_softmax(logits, dim=-1)
        out.append(float(sum(logp[r, p, ids[p]] for r, p in enumerate(pos))))
    return out


def fit(before, after, answer, options):
    """answer 與 options 放進「before＿＿after」各算一次；回傳 {選項: 比正確答案差多少}（0 附近＝跟答案一樣通順）"""
    cands = [answer] + [o for o in options if o != answer]
    scores = pll([f'{before}{c}{after}' for c in cands])
    base = scores[0]
    return {c: round(base - s, 2) for c, s in zip(cands[1:], scores[1:])}
