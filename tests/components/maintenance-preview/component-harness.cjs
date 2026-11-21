const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');
const { mkdirSync } = require('node:fs');
const { buildSync } = require('esbuild');
const sourceRoot = path.resolve(process.env.OUCL_SOURCE_ROOT || path.join(__dirname, '../../..'));
const testRoot = path.resolve(process.env.OUCL_TEST_ROOT || path.join(sourceRoot, '.test-build/maintenance-preview-components'));
mkdirSync(testRoot, { recursive: true });
const bundle = path.join(testRoot, 'component-harness-bundle.cjs');

// Exercise the actual component with deterministic hooks and bridge responses.
// No DOM, Electron, filesystem-backed profile or network is involved.
buildSync({ entryPoints: [path.join(sourceRoot, 'src/ui/MaintenancePreviewPanel.tsx')], outfile: bundle,
  bundle: true, platform: 'node', format: 'cjs', jsx: 'automatic',
  alias: { react: path.join(__dirname, 'react-stub.cjs'), 'react/jsx-runtime': path.join(__dirname, 'jsx-stub.cjs') } });
const { MaintenancePreviewPanel } = require(bundle);
const file = { fileId: 'a'.repeat(64), filename: 'provider.jar', enabled: true, size: 1, sha1: 'b'.repeat(40), sha256: 'c'.repeat(64), sha512: 'd'.repeat(128), mods: [], source: null, sourceStatus: 'unknown', issues: [] };
const report = { formatVersion: 1, instanceId: '00000000-0000-4000-8000-000000000002', instanceRevision: 1, fingerprint: 'e'.repeat(64), checkedAt: '2026-11-11T00:00:00.000Z', mode: 'check', localState: 'satisfied', state: 'unknown', files: [file], issues: [] };
const rootId = '00000000-0000-4000-8000-000000000001';
const previewId = '00000000-0000-4000-8000-000000000003';
const issue = { moment: 'after', scope: 'local', severity: 'error', code: 'MOD_DEPENDENCY_MISSING', fileId: file.fileId, modId: 'dependent_mod', dependencyModId: 'parent_alias', dependencyProjectId: null, dependencyVersionId: null, requirement: '*', actual: [], embeddedDepth: 0 };
const display = { rootId, instanceId: report.instanceId, instanceRevision: report.instanceRevision, fingerprint: report.fingerprint, fileId: file.fileId, filename: file.filename, sha256: file.sha256, action: 'disable', state: 'blocked', providers: [], directRequiredBy: [], transitiveRequiredBy: [], relations: [], platformFailures: [], incomplete: false,
  issues: [issue, { ...issue, dependencyModId: 'nested_mod' }, { ...issue, scope: 'platform', code: 'PLATFORM_PIN_MISMATCH', modId: null, dependencyModId: null, dependencyProjectId: 'ProvPr01', dependencyVersionId: 'ProvVr02', requirement: null }] };
const ok = data => ({ ok: true, data });
const timeout = { ok: false, error: { code: 'TIMEOUT', messageKey: 'timeout' } };
function renderHarness() {
  const state = []; const refs = []; let index = 0; let effects = []; let cleanups = []; let previousDeps = [];
  globalThis.__hooks = {
    useState(initial) { const n = index++; if (!(n in state)) state[n] = initial; return [state[n], value => { state[n] = typeof value === 'function' ? value(state[n]) : value; }]; },
    useRef(initial) { const n = index++; return refs[n] ??= { current: initial }; },
    useEffect(fn, deps) { const n = index++; if (!previousDeps[n] || deps.some((x, i) => x !== previousDeps[n][i])) { effects.push(() => { cleanups[n]?.(); cleanups[n] = fn(); }); previousDeps[n] = deps; } },
  };
  function render() { index = 0; const tree = MaintenancePreviewPanel({ rootId, report, file, disabled: false }); const pending = effects; effects = []; pending.forEach(effect => effect()); return tree; }
  function nodes(node) { if (node == null || typeof node !== 'object') return []; return [node, ...[].concat(node.props?.children ?? []).flat(Infinity).flatMap(nodes)]; }
  function text(node) { if (node == null || typeof node === 'boolean') return ''; if (typeof node !== 'object') return String(node); return [].concat(node.props?.children ?? []).flat(Infinity).map(text).join(''); }
  const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
  return { render, nodes, text, flush };
}

for (const [name, row, pattern] of [['first missing dependency', 0, /声明模组 dependent_mod.*依赖模组 parent_alias/], ['second missing dependency', 1, /声明模组 dependent_mod.*依赖模组 nested_mod/], ['platform project and fixed version', 2, /平台项目 ProvPr01.*固定版本 ProvVr02/]]) test(name, async () => {
  globalThis.window = { oucl: { maintenancePreview: async () => ok({ previewId }), maintenancePreviewStatus: async () => ok({ previewId, status: 'completed', result: display, errorCode: null }) } };
  globalThis.crypto = { randomUUID: () => previewId };
  const h = renderHarness(); let tree = h.render(); h.nodes(tree).find(n => n.type === 'button').props.onClick(); await h.flush(); h.render(); await h.flush(); tree = h.render();
  const rows = h.nodes(tree).filter(n => n.type === 'li').map(h.text);
  assert.match(rows[row], pattern);
});

test('successful cancel terminal query clears an earlier status timeout', async () => {
  let calls = 0;
  globalThis.window = { oucl: { maintenancePreview: async () => ok({ previewId }), maintenancePreviewStatus: async () => ++calls === 1 ? timeout : ok({ previewId, status: 'cancelled', result: null, errorCode: null }), maintenancePreviewCancel: async () => ok({ previewId, status: 'cancelled' }) } };
  globalThis.crypto = { randomUUID: () => previewId };
  const h = renderHarness(); let tree = h.render(); h.nodes(tree).find(n => n.type === 'button').props.onClick(); await h.flush(); h.render(); await h.flush(); tree = h.render();
  assert.ok(h.nodes(tree).some(n => n.props?.role === 'alert'), 'timeout visible before cancel');
  h.nodes(tree).find(n => n.type === 'button' && h.text(n).includes('取消预览')).props.onClick(); await h.flush(); tree = h.render();
  assert.ok(h.text(tree).includes('已取消')); assert.equal(h.nodes(tree).filter(n => n.props?.role === 'alert').length, 0);
});

for (const [name, cancelResult, latest] of [
  ['cancel failure', timeout, null],
  ['status failure', ok({ previewId, status: 'cancelled' }), timeout],
  ['mismatched completion', ok({ previewId, status: 'completed' }), ok({ previewId, status: 'completed', result: { ...display, instanceId: '00000000-0000-4000-8000-000000000004' }, errorCode: null })],
]) test(`${name} remains an alert`, async () => {
  let calls = 0;
  globalThis.window = { oucl: { maintenancePreview: async () => ok({ previewId }), maintenancePreviewStatus: async () => ++calls === 1 ? timeout : latest, maintenancePreviewCancel: async () => cancelResult } };
  globalThis.crypto = { randomUUID: () => previewId };
  const h = renderHarness(); let tree = h.render(); h.nodes(tree).find(n => n.type === 'button').props.onClick(); await h.flush(); h.render(); await h.flush(); tree = h.render();
  h.nodes(tree).find(n => n.type === 'button' && h.text(n).includes('取消预览')).props.onClick(); await h.flush(); tree = h.render();
  assert.ok(h.nodes(tree).some(n => n.props?.role === 'alert'));
  assert.ok(!h.text(tree).includes('存在阻止因素'));
});

test('completion wins cancel and clears old timeout', async () => {
  let calls = 0;
  globalThis.window = { oucl: { maintenancePreview: async () => ok({ previewId }), maintenancePreviewStatus: async () => ++calls === 1 ? timeout : ok({ previewId, status: 'completed', result: display, errorCode: null }), maintenancePreviewCancel: async () => ok({ previewId, status: 'completed' }) } };
  globalThis.crypto = { randomUUID: () => previewId };
  const h = renderHarness(); let tree = h.render(); h.nodes(tree).find(n => n.type === 'button').props.onClick(); await h.flush(); h.render(); await h.flush(); tree = h.render();
  h.nodes(tree).find(n => n.type === 'button' && h.text(n).includes('取消预览')).props.onClick(); await h.flush(); tree = h.render();
  assert.ok(h.text(tree).includes('存在阻止因素')); assert.equal(h.nodes(tree).filter(n => n.props?.role === 'alert').length, 0);
});

test('admission timeout retries the same identity', async () => {
  const requests = [];
  globalThis.window = { oucl: { maintenancePreview: async id => { requests.push(id); return requests.length === 1 ? timeout : ok({ previewId }); }, maintenancePreviewStatus: async () => ok({ previewId, status: 'completed', result: display, errorCode: null }) } };
  const h = renderHarness(); let tree = h.render(); h.nodes(tree).find(n => n.type === 'button').props.onClick(); await h.flush(); tree = h.render();
  h.nodes(tree).find(n => n.type === 'button').props.onClick(); await h.flush(); h.render(); await h.flush(); tree = h.render();
  assert.equal(requests.length, 2); assert.ok(requests[0]); assert.equal(requests[0], requests[1]); assert.ok(h.text(tree).includes('存在阻止因素'));
});
