import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const base = path.resolve('docs/work-packages/P-C/evidence/v2a-integrated'); await mkdir(base, { recursive: true });
await build({ entryPoints: ['src/ui/MaintenancePreviewPanel.tsx'], bundle: true, platform: 'node', format: 'esm', target: 'node24', packages: 'external',
  jsx: 'automatic', outfile: path.join(base, 'component-probe.mjs'), plugins: [{ name: 'fixture-hooks', setup(api) {
    api.onResolve({ filter: /^react$/ }, () => ({ path: 'react-hooks', namespace: 'fixture' }));
    api.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ loader: 'js', contents: `
      export function useState(initial) { const p=globalThis.__pcHooks, i=p.cursor++; if (!(i in p.values)) p.values[i]=initial;
        return [p.values[i], value => { p.values[i]=typeof value === 'function' ? value(p.values[i]) : value; }]; }
      export function useRef(initial) { const p=globalThis.__pcHooks, i=p.cursor++; if (!(i in p.values)) p.values[i]={current:initial}; return p.values[i]; }
      export function useEffect(effect,deps) { const p=globalThis.__pcHooks, i=p.cursor++, previous=p.effects[i];
        if (!previous || deps.some((v,n) => !Object.is(v,previous.deps[n]))) p.pending.push(() => { previous?.cleanup?.(); p.effects[i]={deps,cleanup:effect()}; }); }
    ` }));
  } }] });
// Reuse the real bundled bridge/handler/registry with only Electron transport replaced.
globalThis.__pcHooks = { cursor: 0, values: [], effects: [], pending: [] };
const { MaintenancePreviewJobs, handleMaintenancePreview } = await import(pathToFileURL(path.join(base, 'bridge-main-probe.mjs')).href);
const rootId = '00000000-0000-4000-8000-000000000001'; const instanceId = '00000000-0000-4000-8000-000000000002';
const file = { fileId: 'b'.repeat(64), filename: 'example.jar', enabled: true, size: 8, sha1: 'c'.repeat(40), sha256: 'd'.repeat(64),
  sha512: 'e'.repeat(128), mods: [], sourceStatus: 'unknown', source: null, issues: [] };
const report = { formatVersion: 1, instanceId, instanceRevision: 1, fingerprint: 'a'.repeat(64), checkedAt: '2026-11-11T00:00:00.000Z',
  mode: 'check', localState: 'satisfied', state: 'unknown', files: [file], issues: [] };
let calls = 0;
const jobs = new MaintenancePreviewJobs({ preview: async (input, signal) => {
  calls++; if (calls > 1) await new Promise(resolve => { if (signal.aborted) resolve(); else signal.addEventListener('abort', resolve, { once: true }); });
  const provider = { fileId: file.fileId, id: 'example_mod', ownerId: 'example_mod', version: '1', via: [] };
  const local = { state: 'satisfied', issues: [], providers: [provider] }; const platform = { state: 'satisfied', issues: [], files: [] };
  return { rootId, instanceId, instanceRevision: 1, fingerprint: input.expectedFingerprint, filename: file.filename, sha256: file.sha256, platformFailures: [],
    impact: { fileId: file.fileId, action: input.action, state: 'ready', before: { local, platform }, after: { local, platform }, introducedIssues: [],
      resolvedIssues: [], affectedProviders: [provider], directRequiredBy: [], transitiveRequiredBy: [], relations: [], truncated: false } };
} });
globalThis.__pcFixtureIpc = { invoke: (channel, envelope) => handleMaintenancePreview(channel, envelope, true, rootId, jobs) };
const { createMaintenancePreviewBridge } = await import(pathToFileURL(path.join(base, 'bridge-probe.mjs')).href);
globalThis.window = { oucl: createMaintenancePreviewBridge() };
const { MaintenancePreviewPanel } = await import(pathToFileURL(path.join(base, 'component-probe.mjs')).href);
const flush = () => new Promise(resolve => setImmediate(resolve));
function render() {
  const hooks = globalThis.__pcHooks; hooks.cursor = 0; hooks.pending = [];
  const tree = MaintenancePreviewPanel({ rootId, report, file, disabled: false });
  for (const effect of hooks.pending) effect(); return tree;
}
function walk(node, visit) {
  if (Array.isArray(node)) { for (const child of node) walk(child, visit); return; }
  if (!node || typeof node !== 'object') return;
  visit(node); walk(node.props?.children, visit);
}
function textOf(node) {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  return node && typeof node === 'object' ? textOf(node.props?.children) : '';
}
function click(tree, label) {
  let button; walk(tree, node => { if (node.type === 'button' && textOf(node).includes(label)) button = node; });
  assert.ok(button && !button.props.disabled, `missing enabled button: ${label}`); button.props.onClick();
}
try {
  let tree = render(); click(tree, '预览禁用影响'); await flush(); tree = render(); await flush(); tree = render();
  assert.ok(textOf(tree).includes('本次已知声明未发现阻止因素')); assert.ok(textOf(tree).includes('example_mod'));
  click(tree, '预览禁用影响'); await flush(); tree = render(); await flush(); tree = render();
  click(tree, '取消预览'); await flush(); await flush(); tree = render();
  assert.ok(textOf(tree).includes('模组检查已取消')); assert.equal(calls, 2);
  const result = { status: 'PASS', actualComponent: true, actualPreloadModule: true, actualHandler: true, actualRegistry: true,
    hooks: 'in-memory substitute', ipc: 'in-memory substitute', domOrElectron: false, previewAndCancel: true };
  await writeFile(path.join(base, 'component-probe.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
} finally {
  for (const effect of globalThis.__pcHooks.effects) effect?.cleanup?.(); await jobs.close();
  delete globalThis.window; delete globalThis.__pcFixtureIpc; delete globalThis.__pcHooks;
}
