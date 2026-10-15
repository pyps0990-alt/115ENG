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
import json
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


_PHRASE_PREP_HEAD = {'in', 'on', 'at', 'from', 'by', 'for', 'with', 'under', 'out', 'of', 'to', 'into', 'within', 'without', 'beyond', 'after', 'before', 'over', 'as'}


def phrase_role(w):
    """片語在句子裡當什麼詞性用：動詞片語（participate in、take a toll、be worlds apart）→ 'v'；
    介系詞開頭（in theory、from far and wide）→ 'adv'；結尾是介系詞且開頭不是動詞（prior to、because of）→ 'prep'"""
    toks = w['word'].lower().split()
    first, last = toks[0], toks[-1]
    if first in ('be', 'get', 'have', 'make', 'take', 'keep', 'give', 'put', 'set', 'go', 'come', 'do'):
        return 'v'
    if first in _PHRASE_PREP_HEAD:
        return 'adv'
    if wn.synsets(first, pos='v') and not (wn.synsets(first, pos='a') and last in _PHRASE_PREP_HEAD | {'to'} and len(toks) == 2 and not wn.synsets(first, pos='n')):
        return 'v'
    if last in _PHRASE_PREP_HEAD or last == 'to':
        return 'prep'
    return 'adv'


def roles(w):
    """這個字詞在句子裡能當的詞性（單字＝老師填的詞性；片語＝phrase_role）"""
    return [phrase_role(w)] if pos_list(w) == ['phr'] else pos_list(w)


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


def _zh_span(zh, meaning_list, fuzzy=True):
    """在中文翻譯裡找出對應這個字的那幾個字：先找完全相同的義項，找不到就找字最相近的一段（穿過／穿透、著名的／聞名）"""
    pieces = []
    for m in meaning_list:
        pieces += [p for p in m.split('⋯') if p] if '⋯' in m else [m]
    for m in sorted(pieces, key=len, reverse=True):
        if len(m) >= 2 and m in zh:
            i = zh.index(m)
            return i, i + len(m)
    # 意思被中間插了幾個字（引起共鳴 → 引起了強烈共鳴、造成惡果 → 造成嚴重的惡果）：前後兩半各至少兩個字
    for m in sorted(pieces, key=len, reverse=True):
        for k in range(2, len(m) - 1):
            g = re.search(re.escape(m[:k]) + r'[^，。；、！？]{1,5}?' + re.escape(m[k:]), zh)
            if g:
                return g.start(), g.end()
    if not fuzzy:
        return None
    # 找不到完全相同的：用 jieba 斷詞，在完整的詞（或相鄰兩個詞）裡找字最相近的，替換時不會切在詞的中間
    toks = list(jieba.tokenize(zh))
    spans = [(t[1], t[2]) for t in toks] + [(toks[k][1], toks[k + 1][2]) for k in range(len(toks) - 1)]
    best = (0, None)
    for a, b in spans:
        win = zh[a:b]
        if len(win) < 2 or not all('一' <= ch <= '鿿' for ch in win):
            continue
        for m in pieces:
            if len(m) < 2:
                continue
            shared = sum(1 for ch in set(m) if ch in win)
            if shared < 2:  # 只有一個字相同（上當／上午）不算
                continue
            score = shared / max(len(m), len(win)) + (0.1 if win[0] in m else 0) + len(win) * 0.001
            if score > best[0]:
                best = (score, (a, b))
    return best[1] if best[0] >= 0.5 else None


def _bank_entry(word):
    """7000 單字表裡這個字的資料（沒有單字表時回 None）"""
    import wordbank
    return wordbank.load().get(str(word).lower())


def answer_span(t, ex_zh):
    """中文翻譯裡對應答案的那一段 (i, j)，頭尾的「的了著地得」不算；找不到回 None。
    片語的翻譯常被拆開（fall for → 上了⋯的當），硬換會換錯字：片語一律回 None"""
    ms = meanings(t.get('zh'))
    if 'phr' in pos_list(t):
        ms = [x for x in ms if '⋯' not in x]  # 拆開的片語意思（受⋯的騙）不硬找
    else:
        bank = _bank_entry(t['word'])  # 7000 單字表的中文意思當補充（shatter：使破碎 → 粉碎）
        ms = ms + [x for x in meanings(re.sub(r'\(\d\)', '；', bank['zh'])) if x not in ms] if bank else ms
    ms = ms + [x[1:] for x in ms if len(x) >= 3 and x[0] in '使被有']  # 使破碎 → 破碎、有天壤之別 → 天壤之別
    # 片語不用「字最相近」的找法：只找到一半（引起了強烈共鳴 → 引起）時，換字會換出怪句子
    span = _zh_span(ex_zh or '', ms, fuzzy='phr' not in pos_list(t)) if ms else None
    if not span:
        return None
    i, j = span
    while j - i > 1 and ex_zh[i] in '的了地得':  # 開頭的「著」不去掉（著名、著稱）
        i += 1
    while j - i > 1 and ex_zh[j - 1] in '的了著地得':
        j -= 1
    return (i, j) if j - i >= 2 else None


def sense(t, c, ex, ex_zh, chosen_form):
    """文意：把學生選的字放回這句，看句子變成什麼意思（翻譯裡對應的詞換成學生選的字的意思）"""
    m = re.search(r'\[([^\]]+)\]', ex)
    if not m:
        return None
    yours_en = ex[:m.start()] + '[' + chosen_form + ']' + ex[m.end():]
    out = {'en': yours_en, 'zh': '', 'orig': ex_zh}
    span = answer_span(t, ex_zh)
    cm =[x for x in meanings(c.get('zh')) if '⋯' not in x] or [x.replace('⋯', '') for x in meanings(c.get('zh'))]
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
def signature(words):
    """題目內容的簽章（單字＋每句英文例句）：老師改過題目後簽章會變，網站就不會套用舊的分析結果。和 js/data.js 的 analysisSig 一樣"""
    s = '\u0002'.join('\u0001'.join([w['word']] + [ex for ex, _ in example_pairs(w)]) for w in words)
    h = 5381
    for ch in s:
        h = ((h * 33) ^ ord(ch)) & 0xFFFFFFFF
    return str(h)


def _slot_view(w, ex, ex_zh):
    """一句例句的空格資訊，加上網站解題步驟要用的：span 中文翻譯裡答案那一段、say 空格角色的說明"""
    sl = slot(w, ex)
    if sl is None:
        return None
    span = answer_span(w, ex_zh)
    sl['span'] = list(span) if span else None
    sl['say'] = _slot_text(ex, sl)
    sl['role'] = roles(w)[0] if pos_list(w) == ['phr'] else sl['need']  # 空格要的詞性（片語換成它當的詞性）
    # 人工校對過的修正（slot_overrides.json）：例句英文完全相同才套用，老師改過例句就自動失效
    for o in _overrides().get(w['word'], []):
        if o.get('ex') == ex:
            if o.get('zh') and ex_zh and o['zh'] in ex_zh:
                i = ex_zh.index(o['zh'])
                sl['span'] = [i, i + len(o['zh'])]
            if o.get('say'):
                sl['say'] = o['say']
    return sl


_OVERRIDES = None


def _overrides():
    global _OVERRIDES
    if _OVERRIDES is None:
        path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'slot_overrides.json')
        try:
            with open(path, encoding='utf-8') as f:
                _OVERRIDES = json.load(f)
        except FileNotFoundError:
            _OVERRIDES = {}
    return _OVERRIDES


def analyze(data):
    words = [w for w in data.get('words', []) if w.get('word')]
    info = {}
    for w in words:
        info[w['word']] = {
            'pos': pos_list(w),
            'role': roles(w),  # 在句子裡當什麼詞性用（片語也算出來：participate in → 動詞），網站解題步驟用來排除詞性不合的選項
            'ex': [_slot_view(w, ex, ex_zh) for ex, ex_zh in example_pairs(w)],
        }
    pairs = {}
    for i, a in enumerate(words):
        for b in words[i + 1:]:
            r = relation(a, b)
            if r:
                key = '|'.join(sorted([a['word'], b['word']]))
                pairs[key] = r
    return {'engine': ENGINE_VERSION, 'sig': signature(words), 'words': info, 'pairs': pairs}


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


# ---------------------------------------------------------------- 解題步驟（像老師講解一樣：先懂題意，再逐一看選項，最後篩出答案）
_NEED_ZH = {'adj': '形容詞', 'n': '名詞', 'v': '動詞', 'adv': '副詞', 'prep': '介系詞', 'phr': '片語'}


_NOT_HEAD = {'yesterday', 'today', 'tonight', 'tomorrow', 'overnight', 'recently', 'downtown', 'together', 'home', 'worldwide', 'citywide',
             'morning', 'evening', 'week', 'year', 'month', 'day', 'night', 'way', 'time'}


def _np_head(tags, j):
    """從 j 開始的名詞片語的中心名詞（the thick [windows]、this emergency medical rescue [team]）：跳過限定詞、所有格、數字，
    在名詞與形容詞連在一起的範圍裡取最後一個名詞（yesterday、downtown 這類時間地點副詞不算）；j 開頭不是名詞片語就回 None"""
    k = j
    while k < len(tags) and tags[k][1] in ('DT', 'PDT', 'PRP$', 'POS', 'CD'):
        k += 1
    head = None
    while k < len(tags) and (tags[k][1][:2] in ('NN', 'JJ') or tags[k][1] == 'POS'):
        w = tags[k][0]
        if tags[k][1].startswith('NN') and re.match(r"[A-Za-z]", w):
            if w.lower() in _NOT_HEAD and head:
                break
            head = w
        k += 1
    return head if head and head.lower() not in _STOP and head.lower() not in _NOT_HEAD else None


def _slot_text(ex, sl):
    """空格在句子裡的角色（「空格在 evidence 前面修飾它，需要形容詞」）。只說確定的關係，不確定就只說詞性"""
    need = sl.get('need') if sl else None
    if not need:
        return ''
    name = _NEED_ZH.get(need, need)
    if need == 'phr':
        return ''  # 片語：網站依它當的詞性（sl['role']）說明
    m = re.search(r'\[([^\]]+)\]', ex)
    if not m:
        return f"空格需要{name}"
    split = lambda s: re.findall(r"[A-Za-z][A-Za-z'-]*|[^\sA-Za-z]", s)
    before, ans = split(ex[:m.start()]), split(m.group(1))
    tags = nltk.pos_tag(before + ans + split(ex[m.end():]))
    i, j = len(before), len(before) + len(ans)  # 空格前一個字是 i-1，空格後第一個字是 j
    word = lambda k: tags[k][0] if 0 <= k < len(tags) else ''
    tag = lambda k: tags[k][1] if 0 <= k < len(tags) else ''
    if need == 'adj':
        # 後面直接是名詞片語（中間最多一個形容詞或名詞）才是「修飾它」；否則是放在 be 動詞等後面描述主詞
        if tag(j).startswith('NN') or (tag(j)[:2] in ('JJ', 'NN') and tag(j + 1).startswith('NN')):
            head = _np_head(tags, j)
            if head:
                return f"空格在「{head}」前面修飾它，需要{name}"
        return f"空格在描述人或事物的狀態，需要{name}"
    if need == 'v':
        nxt = word(j).lower()
        if tag(j) in ('IN', 'TO', 'RP') and nxt in _PREPS:
            return f"空格是句子的動作，後面接「{nxt}」，需要{name}"
        head = _np_head(tags, j)
        return f"空格是句子的動作，需要{name}" + (f"（受詞是「{head}」）" if head else '')
    if need == 'n':
        if word(j).lower() == 'of':
            return f"空格是一個東西或概念，後面接「of」，需要{name}"
        prev = i - 1
        while prev >= 0 and tag(prev) in ('DT', 'PRP$'):
            prev -= 1
        if prev >= 0 and tag(prev)[:2] == 'VB' and tag(prev) != 'VBN' and word(prev).lower() not in _STOP:
            return f"空格是「{word(prev)}」的對象，需要{name}"
        if tag(i - 1)[:2] in ('JJ', 'NN') and re.match(r"[A-Za-z]", word(i - 1)) and word(i - 1).lower() not in _STOP:
            return f"空格是一個東西或概念，前面的「{word(i - 1)}」在描述它，需要{name}"
        return f"空格是一個東西或概念，需要{name}"
    return f"空格需要{name}"


_PREPS = {'on', 'in', 'at', 'to', 'for', 'with', 'about', 'over', 'from', 'of', 'by', 'into', 'down', 'up', 'out', 'between', 'among'}


def walkthrough(analysis, data, target, options, kind, example_index=0, chosen=None):
    """選擇題的解題步驟。options：題目的選項（單字字串，含正確答案）；kind：'cloze'、'zh2en'、'en2zh'。
    回傳 {'ask': 題意, 'need': 空格要的詞性說明, 'options': [{word, form, pos, zh, ok, why, picked}], 'answer': 結論}"""
    by = {w['word']: w for w in data['words']}
    t = by[target]
    tpos = analysis['words'][target]['pos']
    out = {'ask': '', 'need': '', 'options': [], 'answer': ''}
    sl = None
    ex = ex_zh = ''
    if kind == 'cloze':
        exs = example_pairs(t)
        ex, ex_zh = exs[example_index] if example_index < len(exs) else exs[0]
        sl = slot(t, ex)
        span = None if 'phr' in tpos else _zh_span(ex_zh or '', meanings(t.get('zh')))
        stem = (ex_zh[:span[0]] + '＿＿' + ex_zh[span[1]:]) if span else ex_zh
        out['ask'] = f"這句在說：「{stem}」"
        out['need'] = _slot_text(ex, sl)
    elif kind == 'zh2en':
        out['ask'] = f"題目要找意思是「{t['zh']}」的英文"
    else:
        out['ask'] = f"題目問 {t['word']}（{t.get('pos', '')}）是什麼意思"
    need = sl['need'] if sl else None
    for o in options:
        w = by.get(o)
        if w is None:
            continue
        pos = analysis['words'][o]['pos']
        item = {'word': w['word'], 'form': chosen_form(w) if kind == 'cloze' else w['word'], 'pos': w.get('pos', ''), 'zh': w.get('zh', ''),
                'ok': o == target, 'picked': o == chosen, 'why': ''}
        if o == target:
            item['why'] = ('詞性和意思都符合' if kind == 'cloze' else '意思符合')
        else:
            rel = analysis['pairs'].get('|'.join(sorted([target, o])))
            if kind == 'cloze' and need and pos and need not in pos:
                item['why'] = f"詞性不合：它是{_pos_zh(pos)}，這裡需要{_NEED_ZH.get(need, need)}"
            elif rel == 'syn':
                item['why'] = f"意思接近，但這句習慣用 {t['word']}"
            elif rel in ('family', 'spell', 'sound'):
                label = {'family': '和答案同字根', 'spell': '和答案拼法很像', 'sound': '和答案唸起來很像'}[rel]
                item['why'] = f"{label}，但意思是「{w['zh']}」"
            elif kind == 'cloze':
                s = sense(t, w, ex, ex_zh, item['form'])
                item['why'] = f"意思不合：放進去變成「{s['zh']}」" if s and s['zh'] else '意思不合：放進去句子說不通'
                if s and s['zh']:
                    item['zh_sentence'] = s['zh']
            else:
                item['why'] = f"意思是「{w['zh']}」，不符" if kind == 'zh2en' else '不是這個字的意思'
        out['options'].append(item)
    out['answer'] = f"所以答案是 {t['word']}（{t['zh']}）"
    return out


# ---------------------------------------------------------------- 選項安全檢查與課外選項（需要語言模型 lm.py 與單字表 wordbank.py）
# 語言模型給每個選項「放進句子也說得通」的機率（lm.py）；門檻 lm.P_UNSAFE／lm.P_EXTRA 由 train_lm.py 依老師標記決定
EXTRA_PER_EXAMPLE = 3  # 每句例句備好幾個課外選項（網站每題最多用 3 個，用不用由 js/components/question.js 的 EXTRA_CHANCE 決定）


def _penn_tag(ex):
    """空格裡那個字在句子裡的詞性標記（VBD、NNS、VBG…），課外選項照這個做詞形變化"""
    m = re.search(r'\[([^\]]+)\]', ex)
    if not m or ' ' in m.group(1).strip():
        return None
    plain = ex[:m.start()] + m.group(1) + ex[m.end():]
    toks = re.findall(r"[A-Za-z']+|[^\sA-Za-z']", plain)
    i = len(re.findall(r"[A-Za-z']+|[^\sA-Za-z']", ex[:m.start()]))
    return nltk.pos_tag(toks)[i][1] if i < len(toks) else None


# 不可數名詞：沒有複數（equipments 是錯的），空格要複數時不拿來當選項
UNCOUNTABLE = set("""advice baggage bread chaos clothing courage damage dirt education electricity employment equipment evidence fun furniture
garbage gold grass happiness harm health help homework honesty housework information intelligence jewelry knowledge laughter
leisure luck luggage machinery mail money music news nonsense nutrition oxygen patience permission pollution poetry progress
research rice safety scenery sand silver smoke snow software stuff sunshine traffic transportation trash violence vocabulary
water weather wealth wisdom""".split())


def inflect(word, tag):
    """課外字變成和答案一樣的形式（過去式、複數、-ing…）；變不了就用原形"""
    if not tag or tag in ('JJ', 'RB', 'NN', 'VB', 'VBP'):
        return word
    from lemminflect import getInflection
    forms = getInflection(word, tag=tag)
    return forms[0] if forms else word


def _split(ex):
    m = re.search(r'\[([^\]]+)\]', ex)
    return (ex[:m.start()], m.group(1), ex[m.end():]) if m else None


def option_safety(data, analysis, progress=None):
    """每句例句：同單元其他字放進去也說得通的（語言模型機率 ≥ lm.P_UNSAFE）列為「不能當選項」。
    回傳 {單字: [[這句不能用的字...], ...]}（依例句順序）"""
    import lm
    words = [w for w in data['words'] if w.get('word')]
    out = {}
    for k, t in enumerate(words):
        if progress:
            progress(k, len(words), t['word'])
        same = [w for w in words if w is not t and ('phr' in pos_list(w)) == ('phr' in pos_list(t))]
        per = []
        for ex in _examples(t):
            parts = _split(ex)
            if not parts:
                per.append([])
                continue
            before, ans, after = parts
            # 詞性和空格不合的字，學生一看就能刪掉，不需要特別排除；只檢查詞性對得上的（避免把一半的字都排掉）
            need = (slot(t, ex) or {}).get('need')
            forms = {chosen_form(w): w['word'] for w in same if not need or not pos_list(w) or need in pos_list(w)}
            if not forms:
                per.append([])
                continue
            fit = lm.fit(before, after, ans, list(forms))
            per.append(sorted(forms[f] for f, p in fit.items() if p >= lm.P_UNSAFE))
        out[t['word']] = per
    return out


EXTRA_REJECTED = set()  # 網路服務（space/app.py）呼叫時另外帶來的不適合清單


# 不適合出現在高中測驗裡的字（單字表裡有，但不拿來當選項）
SCHOOL_UNSAFE = set("""bra brassiere breast damn hell queer sex sexual sexy suicide naked drunk kill murder gay bitch
shit fuck ass bastard porn rape""".split())


def load_rejected():
    """老師在出題選項檢查頁標成「不適合」的課外選項（rejected_extras.json：單元|單字|第幾句|課外字）。
    回傳 (完整鍵集合, {單元|單字: 被標過的課外字}, 全域禁用字)；同一個課外字被兩個以上不同的字標過就全域禁用"""
    import json
    path = os.path.join(HERE, 'rejected_extras.json')
    if not os.path.exists(path) and not EXTRA_REJECTED:
        return set(), {}, set()
    if not os.path.exists(path):
        path = None
    keys = set(EXTRA_REJECTED)
    if path:
        with open(path, encoding='utf-8') as f:
            keys |= set(json.load(f))
    per_target, targets = {}, {}
    for k in keys:
        uid, w, _i, x = k.split('|')
        per_target.setdefault(f'{uid}|{w}', set()).add(x)
        targets.setdefault(x, set()).add(f'{uid}|{w}')
    return keys, per_target, {x for x, t in targets.items() if len(t) >= 2}


def extra_options(data, analysis, rng, n=EXTRA_PER_EXAMPLE, pool_size=15, uid='', progress=None):
    """每句例句挑 n 個課外選項：詞性和空格一樣、級數接近（4 級以上優先）、不是本單元的字、不是答案的同義字或同字根、
    做成和答案一樣的形式後，語言模型認為放進去說不通（也說得通的機率 ≤ lm.P_EXTRA）。
    回傳 {單字: [[{word, form, pos, zh, level}, ...], ...]}"""
    import lm
    import wordbank
    bank = wordbank.load()
    rej_keys, rej_target, rej_global = load_rejected()
    unit = {w['word'].lower() for w in data['words']}
    out = {}
    for k, t in enumerate(data['words']):
        if progress:
            progress(k, len(data['words']), t['word'])
        if 'phr' in pos_list(t):
            out[t['word']] = []
            continue
        per = []
        for ex in _examples(t):
            parts = _split(ex)
            sl = slot(t, ex)
            if not parts or not sl or not sl.get('need'):
                per.append([])
                continue
            before, ans, after = parts
            need = sl['need']
            cands = [b for b in bank.values() if need in pos_list(b) and b['word'] not in unit and ' ' not in b['word']
                     and len(b['zh']) <= 22 and '【' not in b['zh']  # 單字表裡幾個詞性合併的項目，中文會黏在一起（「疹子輕率的」），不用
                     and len(b['word']) >= 4 and not same_family(b['word'], t['word']) and not synonyms(b['word'], t['word'])
                     and not zh_overlap(b['zh'], t['zh'])
                     and b['word'] not in rej_global and b['word'] not in rej_target.get(f"{uid}|{t['word']}", ())
                     and b['word'] not in SCHOOL_UNSAFE]
            hard = [b for b in cands if b['level'] in (3, 4)] or [b for b in cands if b['level'] in (2, 5)] or cands  # 課外字以 3～4 級為主（老師指定），不夠才放寬
            rng.shuffle(hard)
            tag = _penn_tag(ex)
            # 形容詞、副詞不做詞形變化：答案是 complicated／renowned／compelling 這類 -ed／-ing 形容詞時，標註器會標成動詞，
            # 不能把課外的形容詞也變成 crisped、paled、loosing
            if need in ('adj', 'adv', 'prep'):
                tag = None
            if tag in ('NNS', 'NNPS'):
                hard = [b for b in hard if b['word'] not in UNCOUNTABLE]
            # 一次評 pool_size 個候選字（語言模型最花時間）；確定說不通的不到 n 個再多評一批，最多三批
            forms, fit = {}, {}
            for start in range(0, pool_size * 3, pool_size):
                batch = {inflect(b['word'], tag): b for b in hard[start:start + pool_size]}
                batch = {f: b for f, b in batch.items() if f not in forms}
                if not batch:
                    break
                forms.update(batch)
                fit.update(lm.fit(before, after, ans, list(batch)))
                if sum(1 for p in fit.values() if p <= lm.P_EXTRA) >= n:
                    break
            # 最像答案但仍確定說不通的優先（太離譜的選項一眼就能刪掉，沒有鑑別度）
            ok = sorted([(-p, f) for f, p in fit.items() if p <= lm.P_EXTRA])
            per.append([{'word': forms[f]['word'], 'form': f, 'pos': forms[f]['pos'], 'zh': forms[f]['zh'], 'level': forms[f]['level'], 'p': -d}
                        for d, f in ok[:n]])
        out[t['word']] = per
    return out
