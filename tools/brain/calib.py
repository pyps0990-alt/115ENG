"""語言模型門檻校正：人工標好的例子（1＝放進去也說得通，不能當干擾選項；0＝說不通）
  .venv\Scripts\python calib.py distilroberta-base"""
import sys
import time

import lm

CASES = [
    ('The museum exhibits ', ' art from artists around the world.', 'contemporary', {'renowned': 1, 'essence': 0, 'solitary': 0, 'extensive': 0, 'unconventional': 1, 'comment': 0}),
    ('The police found ', ' evidence that proved the suspect was guilty.', 'compelling', {'objective': 1, 'extensive': 1, 'validity': 0, 'solitary': 0, 'plain': 0, 'mainstream': 0, 'renowned': 0}),
    ('Experts gathered to ', ' the environmental impact of the new factory.', 'evaluate', {'penetrate': 0, 'cite': 0, 'depict': 0, 'predict': 1, 'illustrate': 0, 'justify': 0}),
    ('We planted flowers to create a ', ' garden behind our house.', 'lush', {'gorgeous': 1, 'majestic': 1, 'dense': 0, 'stark': 0, 'lively': 1, 'bustling': 0, 'mountainous': 0}),
    ('The teacher praised Alice for her ', ' performance on tests.', 'exceptional', {'strategic': 0, 'stark': 0, 'lush': 0, 'gorgeous': 0, 'majestic': 0, 'dense': 0, 'lively': 0}),
    ('Opinions often ', ' among classmates during active group discussions.', 'differ', {'soar': 0, 'settle': 0, 'exceed': 0, 'possess': 0, 'stream': 0}),
    ('The continuous online bullying caused great mental ', ' to the teenager.', 'torment', {'reaction': 0, 'scale': 0, 'concern': 0, 'fiber': 0, 'tissue': 0, 'infrastructure': 0}),
    ('Dad shared a ', ' story about our ancestors after dinner.', 'compelling', {'plain': 1, 'complicated': 1, 'solitary': 0, 'extensive': 0, 'renowned': 0, 'objective': 0, 'mainstream': 0}),
    ('The government finally approved the ', ' plan.', 'latter', {'comprehensive': 1, 'substantial': 1, 'genetic': 0, 'primitive': 0, 'unethical': 0}),
]

lm.MODEL = sys.argv[1] if len(sys.argv) > 1 else lm.MODEL
t = time.time()
rows = []
for b, a, ans, opts in CASES:
    d = lm.fit(b, a, ans, list(opts))
    rows += [(d[o], y, o) for o, y in opts.items()]
print(lm.MODEL, round(time.time() - t, 1), 's', flush=True)
pos = sum(1 for r in rows if r[1])
for th in (3, 4, 5, 6, 7, 8, 10):
    tp = sum(1 for s, y, _ in rows if y and s < th)
    fp = sum(1 for s, y, _ in rows if not y and s < th)
    print(f'  門檻 {th}: 抓到「也說得通」{tp}/{pos}，誤排除（其實說不通）{fp}/{len(rows) - pos}')
print('  ', sorted((round(s, 1), y, o) for s, y, o in rows))
