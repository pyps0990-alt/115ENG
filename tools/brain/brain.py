"""錯誤分析引擎（「小型大腦」）：預先算好一個單字單元裡，每兩個字之間的關係，以及每句例句空格的用法。

學生答錯時，選到／拼成的字一定是同一單元的另一個字，所以可以事先把所有字的兩兩關係算好：
  拼法（形近）、發音（音近，CMU 發音字典）、字根（同字根，WordNet 衍生關係）、
  意思（WordNet 同義／反義、中文翻譯重疊）、例句空格需要的詞性與前後搭配的字（詞性標註器）。
網站作答時只要查表，不用連網、不用等。

用法：
  analyze(unit_data) -> dict（存成 Firestore public/analysis_<單元>，網站讀這份）
  explain(analysis, target, chosen, kind, example_index) -> (分類, 說明)（測試準確度、產生報告用；網站有一份相同邏輯的 JS）

依賴 nltk（tools/brain/nltk_data 裡的 wordnet、cmudict、averaged_perceptron_tagger_eng）與 jieba（中文斷詞，找翻譯裡對應的詞）。
"""
import os
import re

import jieba
import nltk

ENGINE_VERSION = 1
HERE = os.path.dirname(os.path.abspath(__file__))
nltk.data.path.insert(0, os.path.join(HERE, 'nltk_data'))

from nltk.corpus import cmudict as _cmu  # noqa: E402
from nltk.corpus import wordnet as wn  # noqa: E402

_CMU = None


def cmu():
    global _CMU
    if _CMU is None:
        _CMU = _cmu.dict()
    return _CMU


# ---------------------------------------------------------------- 基本工具
POS_ZH = {'n': '名詞', 'v': '動詞', 'adj': '形容詞', 'adv': '副詞', 'prep': '介系詞', 'conj': '連接詞', 'pron': '代名詞', 'phr': '片語'}
_POS_TAG = {'n': 'n', 'v': 'v', 'vt': 'v', 'vi': 'v', 'adj': 'adj', 'a': 'adj', 'adv': 'adv', 'prep': 'prep', 'conj': 'conj', 'pron': 'pron', 'phr': 'phr', 'ph': 'phr'}
_WN_POS = {'n': wn.NOUN, 'v': wn.VERB, 'adj': wn.ADJ, 'adv': wn.ADV}


def letters(s):
    return re.sub(r'[^a-z]', '', str(s).lower())


def pos_list(w):
    """老師填的詞性（adj. / n.）→ ['adj', 'n']；片語 → ['phr']"""
    if w.get('type') == 'phrase' or ' ' in w['word'].strip():
        return ['phr']
    out = []
    for t in re.split(r'[^a-z]+', str(w.get('pos', '')).lower()):
        p = _POS_TAG.get(t)
        if p and p not in out:
            out.append(p)
    return out


def meanings(zh):
    """中文意思拆成義項（和網站 js/util.js 的 meaningsOf 相同）"""
    s = re.sub(r'[（(][^）)]*[）)]', '', str(zh or ''))
    s = re.sub(r'^\s*(?:[a-z]+\.\s*)+', '', s, flags=re.I)
    out = []
    for part in re.split(r'[；;、，,／/]+', s):
        part = re.sub(r'\s+', '', part)
        part = re.sub(r'[的地得]$', '', part)
        if part:
            out.append(part)
    return out


def damerau(a, b):
    """編輯距離（字母對調算一次）"""
    d = [[0] * (len(b) + 1) for _ in range(len(a) + 1)]
    for i in range(len(a) + 1):
        d[i][0] = i
    for j in range(len(b) + 1):
        d[0][j] = j
    for i in range(1, len(a) + 1):
        for j in range(1, len(b) + 1):
            c = 0 if a[i - 1] == b[j - 1] else 1
            d[i][j] = min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + c)
            if i > 1 and j > 1 and a[i - 1] == b[j - 2] and a[i - 2] == b[j - 1]:
                d[i][j] = min(d[i][j], d[i - 2][j - 2] + 1)
    return d[len(a)][len(b)]


def common_prefix(a, b):
    n = 0
    while n < min(len(a), len(b)) and a[n] == b[n]:
        n += 1
    return n


def common_suffix(a, b):
    return common_prefix(a[::-1], b[::-1])


# ---------------------------------------------------------------- 兩個字的關係
def look_alike(a, b):
    """拼法很像：差異不到四分之一（至少容許 1 個字母、字母對調算 1），或開頭 5 個字母以上相同且長度接近，或頭尾都一樣只差中間一點"""
    x, y = letters(a), letters(b)
    if min(len(x), len(y)) < 4 or x == y:
        return False
    m = max(len(x), len(y))
    if damerau(x, y) <= max(1, round(m * 0.25)):
        return True
    if common_prefix(x, y) >= 5 and abs(len(x) - len(y)) <= 3:
        return True
    return common_prefix(x, y) >= 3 and common_suffix(x, y) >= 3 and damerau(x, y) <= 3


def _phones(word):
    p = cmu().get(word.lower())
    return [[re.sub(r'\d', '', ph) for ph in pron] for pron in p] if p else []


def sound_alike(a, b):
    """唸起來很像：CMU 發音字典裡，音素只差 1 個（不算重音），至少 4 個音素；拼法完全一樣的不算"""
    if ' ' in a or ' ' in b or letters(a) == letters(b):
        return False
    for pa in _phones(a):
        for pb in _phones(b):
            if min(len(pa), len(pb)) >= 4 and damerau(pa, pb) <= 1:
                return True
    return False


def _lemmas(word):
    out = set()
    for s in wn.synsets(word.replace(' ', '_')):
        for l in s.lemmas():
            if l.name().lower() == word.lower().replace(' ', '_'):
                out.add(l)
    return out


def same_family(a, b):
    """同字根：WordNet 的衍生關係（differ／differentiate、evaluate／evaluation），或一個字是另一個字加字尾"""
    if ' ' in a or ' ' in b:
        return False
    x, y = a.lower(), b.lower()
    if x == y:
        return False
    for l in _lemmas(x):
        for r in l.derivationally_related_forms():
            if r.name().lower() == y:
                return True
    for l in _lemmas(y):
        for r in l.derivationally_related_forms():
            if r.name().lower() == x:
                return True
    short, long_ = sorted((letters(x), letters(y)), key=len)
    stem = short[:-1] if short.endswith('e') else short
    return len(stem) >= 4 and long_.startswith(stem) and len(long_) - len(stem) <= 8


def _synsets(word, pos=None):
    return wn.synsets(word.replace(' ', '_'), pos=pos)


def synonyms(a, b):
    """意思相近：WordNet 有共同的詞義（同義詞），或形容詞的「相似」關係"""
    sa = set(_synsets(a))
    sb = set(_synsets(b))
    if sa & sb:
        return True
    for s in sa:
        if s.pos() in ('a', 's') and set(s.similar_tos()) & sb:
            return True
    return False


def antonyms(a, b):
    """意思相反：WordNet 的反義詞"""
    for l in _lemmas(a.lower()):
        if any(x.name().lower() == b.lower().replace(' ', '_') for x in l.antonyms()):
            return True
    return False


def zh_overlap(a, b):
    ma = set(meanings(a))
    return [m for m in meanings(b) if m in ma]


def relation(wa, wb):
    """兩個字的關係（依序取第一個成立的）：family 同字根、sound 音近、spell 形近、ant 意思相反、syn 意思相近；都不是回傳 None"""
    a, b = wa['word'].strip(), wb['word'].strip()
    if same_family(a, b):
        return 'family'
    if sound_alike(a, b):
        return 'sound'
    if look_alike(a, b):
        return 'spell'
    if antonyms(a, b) or antonyms(b, a):
        return 'ant'
    if zh_overlap(wa.get('zh'), wb.get('zh')) or synonyms(a, b):
        return 'syn'
    return None


# ---------------------------------------------------------------- 例句空格
_TAG = [('NN', 'n'), ('VB', 'v'), ('JJ', 'adj'), ('RB', 'adv'), ('IN', 'prep'), ('PRP', 'pron'), ('CC', 'conj')]
_STOP = set('a an the this that these those my your his her its our their of to in on at for with by from and or but is are was were be been it he she they we you i as than so very'.split())


def example_pairs(w):
    """[(英文例句, 中文翻譯)]"""
    exs = w.get('examples') or [{'ex': w.get('example', ''), 'zh': w.get('exampleZh', '')}]
    return [(e.get('ex', ''), e.get('zh', '')) for e in exs if e.get('ex')]


def chosen_form(w):
    """這個字在自己第一句例句裡的形式（例句選字題的選項就是這個）"""
    exs = example_pairs(w)
    m = re.search(r'\[([^\]]+)\]', exs[0][0]) if exs else None
    return m.group(1) if m else w['word']


def study(w, kind, example_index=0):
    """答錯後一定附上的「正確的字」：意思、詞性，加一句相關例句（例句題換一句沒考過的，讓學生多看一種用法）"""
    exs = example_pairs(w)
    ex, zh = ('', '')
    if exs:
        i = (example_index + 1) % len(exs) if kind == 'cloze' and len(exs) > 1 else 0
        ex, zh = exs[i]
    return {'word': w['word'], 'pos': w.get('pos', ''), 'zh': w.get('zh', ''), 'ex': ex, 'exZh': zh}


def _zh_span(zh, meaning_list):
    """在中文翻譯裡找出對應這個字的那幾個字：先找完全相同的義項，找不到就找字最相近的一段（穿過／穿透、著名的／聞名）"""
    pieces = []
    for m in meaning_list:
        pieces += [p for p in m.split('⋯') if p] if '⋯' in m else [m]
    for m in sorted(pieces, key=len, reverse=True):
        if len(m) >= 2 and m in zh:
            i = zh.index(m)
            return i, i + len(m)
    # 找不到完全相同的：用 jieba 斷詞，在完整的詞（或相鄰兩個詞）裡找字最相近的，替換時不會切在詞的中間
    toks = list(jieba.tokenize(zh))
    spans = [(t[1], t[2]) for t in toks] + [(toks[k][1], toks[k + 1][2]) for k in range(len(toks) - 1)]
    best = (0, None)
    for a, b in spans:
        win = zh[a:b]
        if not all('一' <= ch <= '鿿' for ch in win):
            continue
        for m in pieces:
            if len(m) < 2:
                continue
            shared = sum(1 for ch in set(m) if ch in win)
            if not shared:
                continue
            score = shared / max(len(m), len(win)) + (0.1 if win[0] in m else 0) + len(win) * 0.001
            if score > best[0]:
                best = (score, (a, b))
    return best[1] if best[0] >= 0.5 else None


def sense(t, c, ex, ex_zh, chosen_form):
    """文意：把學生選的字放回這句，看句子變成什麼意思（翻譯裡對應的詞換成學生選的字的意思）"""
    m = re.search(r'\[([^\]]+)\]', ex)
    if not m:
        return None
    yours_en = ex[:m.start()] + '[' + chosen_form + ']' + ex[m.end():]
    out = {'en': yours_en, 'zh': '', 'orig': ex_zh}
    # 片語的翻譯常被拆開（fall for → 上了⋯的當），硬換會換錯字：片語只放回英文句子，不換中文
    span = None if 'phr' in pos_list(t) else _zh_span(ex_zh or '', meanings(t.get('zh')))
    if span:
        i, j = span
        while j - i > 1 and ex_zh[i] in '的了著地得':
            i += 1
        while j - i > 1 and ex_zh[j - 1] in '的了著地得':
            j -= 1
        span = (i, j)
    cm = [x for x in meanings(c.get('zh')) if '⋯' not in x] or [x.replace('⋯', '') for x in meanings(c.get('zh'))]
    if span and cm:
        i, j = span
        out['zh'] = ex_zh[:i] + '[' + cm[0] + ']' + ex_zh[j:]
        out['orig'] = ex_zh[:i] + '[' + ex_zh[i:j] + ']' + ex_zh[j:]
    return out


def _examples(w):
    exs = w.get('examples') or [{'ex': w.get('example', ''), 'zh': w.get('exampleZh', '')}]
    return [e.get('ex', '') for e in exs if e.get('ex')]


def slot(w, ex):
    """這句例句的空格：需要的詞性（老師填的詞性為主，詞性標註器幫忙在 adj. / n. 之間選）與前後最近的實詞（搭配提示）"""
    m = re.search(r'\[([^\]]+)\]', ex)
    if not m:
        return None
    answer = m.group(1)
    plain = ex[:m.start()] + answer + ex[m.end():]
    toks = re.findall(r"[A-Za-z']+|[^\sA-Za-z']", plain)
    before = re.findall(r"[A-Za-z']+|[^\sA-Za-z']", ex[:m.start()])
    i = len(before)
    n_ans = len(re.findall(r"[A-Za-z']+|[^\sA-Za-z']", answer))
    tags = nltk.pos_tag(toks)
    allowed = pos_list(w)
    j = i + n_ans  # 空格後面第一個字
    tag = lambda k: tags[k][1] if 0 <= k < len(tags) else ''
    word = lambda k: tags[k][0].lower() if 0 <= k < len(tags) else ''
    if allowed == ['phr']:
        need = 'phr'
    elif len(allowed) == 1:
        need = allowed[0]
    else:
        need = None
        # 文法規則先判斷（標註器在 adj. / n. / v. 之間常猜錯）：
        if 'v' in allowed and word(i - 1) in _VERB_BEFORE:
            need = 'v'  # to／will／can… 後面是原形動詞（began to concern）
        elif 'adj' in allowed and tag(j).startswith('NN') and not _adj_like(tags, i - 1):
            need = 'adj'  # 直接放在名詞前面修飾它（a plain meal、core skill），前面已經有形容詞的除外（fertile plain）
        elif 'adj' in allowed and word(j) in ('and', 'or') and tag(j + 1).startswith('JJ'):
            need = 'adj'  # 和另一個形容詞並列（plain and simple）
        if need is None:
            tagged = [p for t, p in _TAG if tag(i).startswith(t)]
            need = tagged[0] if tagged and tagged[0] in allowed else None
        # -ing／-ed 的形容詞（compelling、renowned）標註器常標成動詞：老師標的是形容詞就以形容詞為準
        if need is None and tag(i) in ('VBG', 'VBN') and 'adj' in allowed:
            need = 'adj'
        if need is None:
            need = allowed[0] if allowed else None
    return {'need': need, 'answer': answer, 'hint': _hint(tags, i, j, need)}


def _adj_like(tags, k):
    """前一個字是形容詞：標註器說是，或 WordNet 裡只有形容詞的意思（fertile 常被標錯）"""
    if k < 0 or k >= len(tags):
        return False
    if tags[k][1].startswith('JJ'):
        return True
    ss = wn.synsets(tags[k][0].lower())
    return bool(ss) and all(x.pos() in ('a', 's') for x in ss)


_VERB_BEFORE = {'to', 'will', 'would', 'can', 'could', 'should', 'must', 'may', 'might', "don't", "didn't", "doesn't", 'not'}


def _hint(tags, i, j, need):
    """搭配提示：空格跟哪個字關係最近——形容詞看後面的名詞、動詞看後面的受詞名詞、名詞看前面的動詞或形容詞"""
    content = lambda k: 0 <= k < len(tags) and re.match(r"[A-Za-z]", tags[k][0]) and tags[k][0].lower() not in _STOP
    # 動詞、名詞後面緊接的介系詞就是搭配（comment on、concern over）
    if need in ('v', 'n') and j < len(tags) and tags[j][1] in ('IN', 'TO') and tags[j][0].lower() not in ('that', 'because', 'if', 'than'):
        return tags[j][0].lower()
    if need in ('adj', 'v'):
        for k in range(j, min(j + 4, len(tags))):
            if tags[k][1].startswith('NN') and content(k):
                return tags[k][0]
    if need == 'n':
        for k in range(i - 1, max(i - 4, -1), -1):
            if (tags[k][1][:2] == 'VB' or _adj_like(tags, k)) and content(k):
                return tags[k][0]
    for k in range(j, min(j + 3, len(tags))):
        if content(k):
            return tags[k][0]
    for k in range(i - 1, max(i - 3, -1), -1):
        if content(k):
            return tags[k][0]
    return ''


# ---------------------------------------------------------------- 整個單元
def analyze(data):
    words = [w for w in data.get('words', []) if w.get('word')]
    info = {}
    for w in words:
        info[w['word']] = {
            'pos': pos_list(w),
            'ex': [slot(w, ex) for ex in _examples(w)],
        }
    pairs = {}
    for i, a in enumerate(words):
        for b in words[i + 1:]:
            r = relation(a, b)
            if r:
                key = '|'.join(sorted([a['word'], b['word']]))
                pairs[key] = r
    return {'engine': ENGINE_VERSION, 'words': info, 'pairs': pairs}


# ---------------------------------------------------------------- 判斷與說明（網站 js/components/question.js 有相同邏輯）
def _pos_zh(ps):
    return '／'.join(POS_ZH.get(p, p) for p in ps)


def explain(analysis, data, target, chosen, kind, example_index=0):
    """target、chosen：單字（字串）；kind：'cloze' 例句選字、'zh2en'、'en2zh'、'spell'。回傳 (分類, 說明, 正確的字的意思與相關例句)"""
    by = {w['word']: w for w in data['words']}
    t, c = by[target], by.get(chosen)
    st = study(t, kind, example_index)
    cat, tip = _explain(analysis, t, c, kind, example_index) if c is not None else ('不熟悉', '')
    # 例句題：把學生選的字放回句子，看意思變成什麼（意思相近的字放進去常常說得通，不用這個說明）
    if kind == 'cloze' and c is not None and cat != '意思相近':
        exs = example_pairs(t)
        if exs:
            ex, ex_zh = exs[example_index] if example_index < len(exs) else exs[0]
            st['sense'] = sense(t, c, ex, ex_zh, chosen_form(c))
    if not tip:
        tip = f"{t['word']} 的意思是「{t['zh']}」，看下面的例句記住它的用法"
    elif cat == '詞性不合':
        tip += f"；這裡要的是 {t['word']}（{t['zh']}）"
    return (cat, tip, st)


def _explain(analysis, t, c, kind, example_index):
    target, chosen = t['word'], c['word']
    rel = analysis['pairs'].get('|'.join(sorted([target, chosen])))
    a = f"{c['word']}（{c['zh']}）"
    b = f"{t['word']}（{t['zh']}）"
    tinfo, cinfo = analysis['words'][target], analysis['words'][chosen]
    sl = None
    if kind == 'cloze':
        exs = tinfo['ex']
        sl = exs[example_index] if example_index < len(exs) else (exs[0] if exs else None)
    if rel == 'family':
        return ('同字根', f"{c['word']} 和 {t['word']} 是同一個字根，但詞性或意思不同：{c['word']}（{_pos_zh(cinfo['pos'])}，{c['zh']}）；{t['word']}（{_pos_zh(tinfo['pos'])}，{t['zh']}）")
    if rel == 'sound':
        return ('音近混淆', f"{c['word']} 和 {t['word']} 唸起來很像，意思不同：{a}；{b}")
    if rel == 'spell':
        return ('形近混淆', f"{c['word']} 和 {t['word']} 拼法很像，意思不同：{a}；{b}")
    if rel == 'ant':
        return ('意思相反', f"{c['word']} 的意思剛好相反（{c['zh']}）；這裡要的是 {b}")
    if rel == 'syn':
        hint = f"，這句看「{sl['hint']}」選搭配得起來的字" if sl and sl.get('hint') else '，看例句記住它的用法和搭配'
        return ('意思相近', f"{a} 和 {b} 意思接近{hint}")
    if kind == 'cloze' and sl and sl['need']:
        if sl['need'] not in cinfo['pos'] and cinfo['pos']:
            return ('詞性不合', f"空格需要{POS_ZH.get(sl['need'], sl['need'])}，你選的 {c['word']} 是{_pos_zh(cinfo['pos'])}（{c['zh']}）")
        tail = f"；看空格旁邊的「{sl['hint']}」，想想什麼字能和它搭配" if sl.get('hint') else ''
        return ('句意不合', f"這句要的是「{t['zh']}」的 {t['word']}；你選的 {c['word']} 是「{c['zh']}」，放在這裡不合適{tail}")
    if kind == 'spell':
        return ('意思混淆', f"你拼成清單裡的另一個字 {a}；這題要的是 {b}")
    return ('不熟悉', '')
