---
version: 1
slug: "admin-html"
primary_target: "admin.html"
related_targets: ["tools/e2e/admin-prototype.html"]
---

Scope: teacher admin (admin.html), Operate mode. Audience: one or two teachers, mostly desktop, phone for lookups. Job: prepare units, watch completion and flags, open makeup windows; rare: AI, analysis engine, semester cleanup.

## Direction contract
THESIS: The admin is organised around the unit, not around data types: a persistent unit list beside the selected unit's workspace, so preparing, watching and fixing one unit never leaves one screen. It refuses the five-tab data-type layout and the card-grid dashboard.
OWN-WORLD: The student site's palette carried into a working shell: a navy nav rail, a cool wash unit column, white workspace; amber only for the one primary action and focus, green/red only for pass and fault states. Nunito for UI, Atkinson Hyperlegible for English content, tabular numerals in every table.
STORY: The teacher sees what needs attention, opens a unit, edits or checks it in tabs, saves from a sticky bar that appears only when something changed.
FIRST VIEWPORT: Left 64px navy rail (總覽 單元 學生 成績 設定); 280px unit column grouped by lesson, each row a status dot, title, and a per-class completion strip; workspace with unit header, four tabs, content. Overview spans workspace: attention queue rows with jump actions, live online count, today's submissions stream.
FORM: split list/workspace, candidate 6 of 7, seed key f01ebbf2. Signature move: the per-class completion strip on each unit row (one segment per class, filled by pass rate), echoed large in the unit's 成績 tab.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
