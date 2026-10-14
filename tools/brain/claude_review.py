"""Claude 逐句看過課外選項後，判斷「放進句子也說得通」的（單字|第幾句|課外字）。
合併進 rejected_extras.json（老師標的那份），下次產生課外選項就不會再出現。"""
import json
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
JUDGED = """
contemporary|2|influential contemporary|2|sensitive plain|0|advanced plain|1|artistic renowned|0|sensitive renowned|0|diligent
solitary|0|systematic compelling|0|suspicious compelling|0|sexual compelling|2|concrete comment|1|roast compose|2|blend
predict|2|announce unconventional|0|peculiar unconventional|1|adequate justify|1|cease justify|2|convey
encounter|2|monitor encounter|2|flee essence|1|perfection mislead|0|monitor journalism|0|ceramic journalism|1|observation
attempt|1|cease attempt|2|protest illustrate|0|recall illustrate|2|explore illustrate|2|establish
extensive|0|acceptable extensive|1|sufficient extensive|2|accurate mainstream|0|mobile mainstream|0|prominent mainstream|1|spiritual
evaluate|2|isolate cite|0|contribute cite|0|challenge cite|2|insert
differ|1|dispute differ|2|clash differentiate|0|relate settle|1|rent possess|2|combine possess|2|observe
exceptional|0|attractive exceptional|1|flexible strategic|1|typical strategic|1|considerable strategic|2|current strategic|2|global
opposite|1|critical core|2|continuous considerably|0|weekly considerably|0|barely considerably|2|roughly considerably|2|somehow
majestic|1|outstanding majestic|2|outdoor majestic|2|remote valley|1|homeland
stark|0|troublesome stark|0|racial stark|2|political lively|0|valuable lively|0|cooperative lively|1|weekly lively|2|suspicious
agricultural|0|digital agricultural|1|criminal agricultural|2|outdoor gorgeous|1|commercial lush|0|awful lush|2|tropical lush|2|shady
mountainous|0|conservative mountainous|0|violent mountainous|2|stormy
primitive|0|modest primitive|1|domestic primitive|2|available tissue|0|impact provoke|0|awake
substantial|0|critical substantial|0|profitable substantial|1|slight substantial|2|splendid
unethical|1|average unethical|2|genuine torment|2|achievement torment|2|process
estimate|1|percentage estimate|2|swear switch|0|circulate switch|1|plug concern|2|horror
infrastructure|0|operation infrastructure|2|performance
genetic|0|environmental genetic|0|unique genetic|1|regional genetic|1|characteristic genetic|2|annual genetic|2|constant
latter|0|opposite latter|1|combination induce|2|fuel somewhat|0|largely alter|0|decrease
comprehensive|1|manageable comprehensive|2|vivid
contemporary|1|award contemporary|2|various contemporary|2|modest complicated|0|imaginative complicated|0|scary
complicated|1|distinct complicated|1|artificial plain|0|typical plain|0|conventional penetrate|2|strengthen penetrate|2|overcome
renowned|0|financial renowned|0|bald depict|0|concern depict|1|celebrate solitary|0|memorable solitary|1|mechanical
compelling|1|enjoyable predict|0|recognize predict|1|clarify predict|2|reveal predict|2|establish
unconventional|0|superior unconventional|0|artistic unconventional|1|imaginative justify|2|dispute encounter|0|observe
encounter|2|confine essence|2|significance mislead|1|instruct journalism|1|literature journalism|2|management attempt|2|approach
illustrate|0|suggest illustrate|0|reflect illustrate|2|trace extensive|2|appropriate mainstream|0|conservative mainstream|1|impressive
evaluate|1|communicate evaluate|2|manage validity|0|structure cite|2|edit cite|2|consult objective|0|honorable
objective|2|appropriate objective|2|genuine differ|0|unite differ|2|interact crew|1|security crew|2|charity settle|1|retreat
possess|0|strengthen exceptional|2|magnificent exceptional|2|competitive strategic|0|offensive opposite|0|empty opposite|1|romantic
opposite|1|normal opposite|1|intermediate core|2|desirable considerably|0|lately considerably|1|nowadays considerably|2|yearly
considerably|2|scarcely dense|2|swift stark|0|tragic stark|1|vacant stark|2|definite lively|0|brilliant lively|0|monthly
agricultural|0|current agricultural|0|typical agricultural|0|previous agricultural|1|prosperous agricultural|1|influential
agricultural|2|technological agricultural|2|commercial gorgeous|0|inferior lush|2|delightful bustling|0|enjoyable bustling|2|prosperous
mountainous|0|unique primitive|0|multiple substantial|0|constructive substantial|0|specific unethical|0|offensive torment|0|challenge
livestock|2|battery estimate|2|suggest switch|0|determine concern|2|obstacle infrastructure|0|vision infrastructure|2|structure
genetic|0|individual genetic|1|fundamental genetic|2|gradual latter|0|indoor reaction|2|ache alter|0|disturb suit|0|reward
scale|0|firework scale|0|fashion scale|1|costume comprehensive|2|unique
""".split()


def main():
    import brain
    units = {}
    for uid in ('L1-2VOC', 'L3VOC', 'L4VOC'):
        with open(os.path.join(HERE, 'samples', uid + '.json'), encoding='utf-8') as f:
            for w in json.load(f)['words']:
                units[w['word']] = uid
    path = os.path.join(HERE, 'rejected_extras.json')
    with open(path, encoding='utf-8') as f:
        keys = set(json.load(f))
    added = 0
    for item in JUDGED:
        word, idx, extra = item.split('|')
        k = f'{units[word]}|{word}|{idx}|{extra}'
        if k not in keys:
            keys.add(k)
            added += 1
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(sorted(keys), f, ensure_ascii=False, indent=1)
    print('新增', added, '個，共', len(keys), '個')


if __name__ == '__main__':
    main()
