// 老師後台開啟加速：先讀 Firestore 的設定（約 0.1 秒），再用 Apps Script 的完整資料核對
//   node tools/e2e/admin-load.mjs
// 把 Admin.html 開啟流程那一段放進 vm 執行，Firestore 與 Apps Script 都用假的、可以控制回來的先後
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const html = fs.readFileSync(new URL('../../apps-script/Admin.html', import.meta.url), 'utf8');
const i = html.indexOf('    var staleNote = null;');
const j = html.indexOf('.getAdminData();', i) + '.getAdminData();'.length;
assert(i > 0 && j > i);
const code = html.slice(i, j);

const CFG = { updated: 'x1', units: { u1: { visible: true, disabled: [], questionCount: 10, since: 's' } }, customUnits: [{ id: 'u1', title: 'U1', type: 'vocab', lesson: 1, topic: '' }],
  content: { u1: { updated: 't1', count: 40, topic: '' } }, ext: { u1: { '306-7': '2026-10-05T18:00' } } };
const SERVER = { units: [], customUnits: [{ id: 'u1', title: 'U1', type: 'vocab', lesson: 1, topic: '', visible: true, disabled: [], questionCount: 10, createdAt: 's', openAt: '', closeAt: '', custom: true }],
  content: [{ id: 'u1', updated: 't1', updatedBy: 'a@b', count: 40 }], extensions: [{ unit: 'u1', cls: '306', seat: '7', until: '2026-10-05T18:00', note: '病假' }],
  config: { ...CFG, updated: 'x2' }, siteUrl: 'https://site/', sheetUrl: 'https://sheet/' };

function run({ cache, fsCfg, server, order, edit = false }) {
  const applied = [], listeners = {};
  const sections = [{ inert: false }, { inert: false }];
  const notes = [];
  const pending = {};
  const ctx = {
    console, JSON, Object, Array,
    $: (id) => ({ parentNode: { insertBefore: (n) => notes.push(n) }, href: '' }),
    tabSections: () => sections,
    applyAdminData: (d) => applied.push(d),
    ADMIN_CACHE: 'k',
    localStorage: { getItem: () => (cache ? JSON.stringify(cache) : null), setItem: () => {} },
    document: { createElement: () => ({ setAttribute() {}, remove() { this.removed = true; } }), addEventListener: (ev, f) => { listeners[ev] = f; } },
    window: { fbPublic: fsCfg === undefined ? undefined : () => new Promise((res) => { pending.fs = () => res(fsCfg); }) },
    google: { script: { run: new Proxy({}, { get: (_, k) => {
      if (k === 'withSuccessHandler') return (ok) => ({ withFailureHandler: (fail) => ({ getAdminData: () => { pending.server = () => (server instanceof Error ? fail(server) : ok(server)); }, getAiStatus() {} }) });
      return () => {};
    } }) } },
    aiPaint() {}, prLoad() {}, esc: (s) => String(s), cfgBase: null, siteUrl: '',
  };
  vm.createContext(ctx);
  vm.runInContext(code, ctx);
  return {
    ctx, applied, sections, notes,
    async step(name) { pending[name](); await new Promise((r) => setTimeout(r, 0)); },
    edit() { listeners.input({ target: { closest: () => ({}) } }); },
    locked: () => sections.every((s) => s.inert),
    note: () => notes.filter((n) => !n.removed).map((n) => n.textContent).join(''),
  };
}

// 1. 沒有快取：先用 Firestore 設定畫出畫面（只能看），Apps Script 回來後換成完整資料並開放編輯
{
  const t = run({ cache: null, fsCfg: CFG, server: SERVER });
  assert.equal(t.applied.length, 0);
  await t.step('fs');
  assert.equal(t.applied.length, 1, '0.1 秒就有畫面');
  const d = t.applied[0];
  assert.equal(d.customUnits[0].title, 'U1');
  assert.equal(d.content[0].count, 40);
  assert.deepEqual(JSON.parse(JSON.stringify(d.extensions)), [{ unit: 'u1', cls: '306', seat: '7', until: '2026-10-05T18:00', note: '' }]);
  assert.ok(t.locked(), '設定裡缺補作備註等資料：先不能編輯');
  await t.step('server');
  assert.equal(t.applied.length, 2);
  assert.ok(!t.locked(), 'Apps Script 回來後開放編輯');
}

// 2. 有快取、跟 Firestore 設定一樣（只差 updated）：馬上開放編輯；Apps Script 回來資料相同就不重畫
{
  const cache = { ...SERVER, config: { ...CFG, updated: 'old' } };
  const t = run({ cache, fsCfg: CFG, server: SERVER });
  assert.equal(t.applied.length, 1, '先畫快取');
  assert.ok(t.locked());
  await t.step('fs');
  assert.ok(!t.locked(), '設定一致：馬上能編輯');
  assert.equal(t.applied.length, 1, '不用重畫');
  t.edit();
  await t.step('server');
  assert.equal(t.applied.length, 1, '資料相同：不重畫，正在輸入的內容不會被打斷');
  assert.equal(t.ctx.cfgBase.updated, 'x2', '基準設定換成伺服器的');
  assert.ok(!t.locked());
}

// 3. 提早開放編輯，但試算表在別處被改過：沒動過就換成新資料；動過就鎖住並提醒重新整理
{
  const changed = { ...SERVER, customUnits: [{ ...SERVER.customUnits[0], title: '別人改的' }] };
  const cache = { ...SERVER, config: CFG };
  let t = run({ cache, fsCfg: CFG, server: changed });
  await t.step('fs');
  await t.step('server');
  assert.equal(t.applied.at(-1).customUnits[0].title, '別人改的', '沒編輯過：直接換成新資料');
  assert.ok(!t.locked());
  t = run({ cache, fsCfg: CFG, server: changed });
  await t.step('fs');
  t.edit();
  await t.step('server');
  assert.equal(t.applied.length, 1, '編輯中不覆蓋');
  assert.ok(t.locked(), '鎖住避免蓋掉別人的修改');
  assert.match(t.note(), /請重新整理/);
}

// 4. 快取跟 Firestore 設定不一樣（別人改過）：先顯示 Firestore 的版本（沿用快取裡的補作備註），等 Apps Script
{
  const cache = { ...SERVER, config: { ...CFG, units: { u1: { ...CFG.units.u1, visible: false } } } };
  const t = run({ cache, fsCfg: CFG, server: SERVER });
  await t.step('fs');
  assert.equal(t.applied.length, 2);
  assert.equal(t.applied[1].extensions[0].note, '病假', '補作備註沿用快取');
  assert.ok(t.locked());
  await t.step('server');
  assert.ok(!t.locked());
}

// 5. Apps Script 比 Firestore 先回來：Firestore 晚到的設定不再蓋掉
{
  const t = run({ cache: null, fsCfg: CFG, server: SERVER });
  await t.step('server');
  await t.step('fs');
  assert.equal(t.applied.length, 1);
  assert.ok(!t.locked());
}

// 6. Apps Script 失敗：已確認一致的畫面照常可以用；沒確認的顯示錯誤
{
  let t = run({ cache: { ...SERVER, config: CFG }, fsCfg: CFG, server: new Error('逾時') });
  await t.step('fs');
  await t.step('server');
  assert.ok(!t.locked());
  t = run({ cache: { ...SERVER, config: CFG }, fsCfg: null, server: new Error('逾時') });
  await t.step('fs');
  await t.step('server');
  assert.match(t.note(), /讀取最新資料失敗/);
}

// 7. Apps Script 內建版（沒有 Firestore）：跟以前一樣
{
  const t = run({ cache: null, fsCfg: undefined, server: SERVER });
  await t.step('server');
  assert.equal(t.applied.length, 1);
}
console.log('後台開啟加速測試通過');
