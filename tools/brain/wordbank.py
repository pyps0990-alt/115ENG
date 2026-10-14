"""課外單字表（高中 7000 單字）：例句選字題的選項裡參雜 1～2 個課外字。

單字表放在 tools/brain/wordbank/ 底下，任何 .tsv、.csv 或 .txt 都會讀進來，一行一個字：
  英文<Tab或逗號>詞性<Tab或逗號>中文<Tab或逗號>級數（級數可省略）
  例：abandon	v.	拋棄；放棄	4
第一行如果是欄名（word／英文…）會自動略過。

挑選規則（每句例句挑 2 個，網站出題時隨機用 1～2 個）：
  1. 詞性和空格需要的一樣（不能一眼用詞性刪掉）
  2. 級數接近這個單元的字（太簡單、太難的都不要）
  3. 不是本單元的字、不是答案的同義字／同字根
  4. 放進句子後語言模型認為「說不通」（和答案的分數差距夠大），避免一題兩個答案
  5. 依空格的形式變化（過去式、複數、-ing…），選項看起來和答案一樣自然
"""
import csv
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
BANK_DIR = os.path.join(HERE, 'wordbank')
_BANK = None


def load():
    global _BANK
    if _BANK is not None:
        return _BANK
    words = {}
    if os.path.isdir(BANK_DIR):
        for name in sorted(os.listdir(BANK_DIR)):
            if not name.lower().endswith(('.tsv', '.csv', '.txt')):
                continue
            with open(os.path.join(BANK_DIR, name), encoding='utf-8-sig') as f:
                text = f.read()
            delim = '\t' if '\t' in text else ','
            for row in csv.reader(text.splitlines(), delimiter=delim):
                row = [c.strip() for c in row]
                if len(row) < 3 or not re.match(r"^[A-Za-z][A-Za-z '\-]*$", row[0]):
                    continue
                w = row[0].lower()
                level = int(row[3]) if len(row) > 3 and row[3].isdigit() else 0
                words.setdefault(w, {'word': w, 'pos': row[1], 'zh': row[2], 'level': level})
    _BANK = words
    return words
