import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const repository = fileURLToPath(new URL('../../../', import.meta.url));
const output = path.join(repository, 'docs/work-packages/P-C/evidence/acceptance-v2-component');
await mkdir(output, { recursive: true });
await build({ absWorkingDir: repository, stdin: { contents: `
  export { MaintenancePreviewPanel } from './src/ui/MaintenancePreviewPanel.tsx';
  export { isPreviewResult, previewFailure } from './src/shared/contracts/mod-maintenance-preview.ts';
  export { MESSAGES } from './src/shared/locales/messages.ts';`, resolveDir: repository },
  bundle: true, platform: 'node', format: 'esm', target: 'node24', packages: 'external', jsx: 'automatic',
  outfile: path.join(output, 'component.mjs'), plugins: [{ name: 'controlled-hooks', setup(api) {
    api.onResolve({ filter: /^react$/ }, () => ({ path: 'hooks', namespace: 'fixture' }));
    api.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: `
      export function useState(initial) { const h=globalThis.__bcHooks,i=h.cursor++;
        if (!(i in h.values)) h.values[i]=initial;
        return [h.values[i],value=>{h.values[i]=typeof value==='function'?value(h.values[i]):value;}]; }
      export function useRef(initial) { const h=globalThis.__bcHooks,i=h.cursor++;
        if (!(i in h.values)) h.values[i]={current:initial}; return h.values[i]; }
      export function useEffect(effect,deps) { const h=globalThis.__bcHooks,i=h.cursor++,old=h.effects[i];
        if (!old || deps.some((v,n)=>!Object.is(v,old.deps[n]))) h.pending.push(()=>{
          old?.cleanup?.(); h.effects[i]={deps,cleanup:effect()}; }); }
    `, loader: 'js' }));
  } }] });
const { MaintenancePreviewPanel, isPreviewResult, previewFailure, MESSAGES } = await import(pathToFileURL(path.join(output, 'component.mjs')).href);
const rootId = '00000000-0000-4000-8000-000000000001';
const instanceId = '00000000-0000-4000-8000-000000000002';
const previewId = '00000000-0000-4000-8000-000000000003';
const file = { fileId: 'a'.repeat(64), filename: 'first.jar', enabled: true, size: 1,
  sha1: 'b'.repeat(40), sha256: 'c'.repeat(64), sha512: 'd'.repeat(128), mods: [], source: null, sourceStatus: 'unknown', issues: [] };
const other = { ...file, fileId: 'f'.repeat(64), filename: 'second.jar' };
const report = { formatVersion: 1, instanceId, instanceRevision: 1, fingerprint: 'e'.repeat(64),
  checkedAt: '2026-11-12T00:00:00.000Z', mode: 'check', localState: 'satisfied', state: 'unknown', files: [file, other], issues: [] };
const ok = data => ({ contractVersion: 1, requestId: rootId, ok: true, data });
const fail = code => previewFailure(rootId, code, rootId);
const flush = () => new Promise(resolve => setImmediate(resolve));
function text(node) {
  if (Array.isArray(node)) return node.map(text).join('');
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  return node && typeof node === 'object' ? text(node.props?.children) : '';
}
function nodes(node, predicate) {
  if (Array.isArray(node)) return node.flatMap(child => nodes(child, predicate));
  if (!node || typeof node !== 'object') return [];
  return [...(predicate(node) ? [node] : []), ...nodes(node.props?.children, predicate)];
}
function render() {
  const hooks = globalThis.__bcHooks; hooks.cursor = 0; hooks.pending = [];
  const tree = MaintenancePreviewPanel({ rootId, report, file, disabled: false });
  for (const effect of hooks.pending) effect(); return tree;
}
function click(tree, label) {
  const button = nodes(tree, node => node.type === 'button' && text(node) === label)[0];
  assert.ok(button && !button.props.disabled, `expected enabled ${label}`); button.props.onClick();
}
function cleanup() {
  for (const effect of globalThis.__bcHooks?.effects ?? []) effect?.cleanup?.();
  delete globalThis.__bcHooks; delete globalThis.window;
}
function setup(statuses, cancel = async () => fail('PREVIEW_EXPIRED')) {
  cleanup(); globalThis.__bcHooks = { cursor: 0, values: [], effects: [], pending: [] };
  const accepted = []; const queried = [];
  globalThis.window = { oucl: {
    maintenancePreview: async (id, input) => { accepted.push({ id, input }); return ok({ previewId }); },
    maintenancePreviewStatus: async id => { queried.push(id); assert.ok(statuses.length, 'unexpected query'); return statuses.shift(); },
    maintenancePreviewCancel: cancel,
  } };
  return { accepted, queried };
}
async function accept() {
  click(render(), MESSAGES.modsPreviewDisable); await flush(); render(); await flush(); return render();
}
const results = [];
try {
  // TIMEOUT keeps the observation identity. Only authoritative expiry releases the active UI.
  let fixture = setup([fail('TIMEOUT'), fail('PREVIEW_EXPIRED'), fail('TIMEOUT')]);
  let tree = await accept();
  assert.ok(text(tree).includes(MESSAGES.modsPreviewPending));
  assert.equal(nodes(tree, node => node.type === 'button' && text(node) === MESSAGES.modsPreviewDisable)[0].props.disabled, true);
  click(tree, MESSAGES.modsPreviewQuery); render(); await flush(); tree = render();
  assert.ok(text(tree).includes(MESSAGES.modsPreviewExpired));
  assert.ok(!text(tree).includes(MESSAGES.modsPreviewPending));
  assert.ok(!text(tree).includes(MESSAGES.modsPreviewCancel));
  tree = await accept(); assert.equal(fixture.accepted.length, 2);
  assert.notEqual(fixture.accepted[0].id, fixture.accepted[1].id);
  assert.deepEqual(fixture.queried, [previewId, previewId, previewId]);
  results.push('PASS: TIMEOUT retains identity; status expiry releases UI and retry uses a new requestId');

  fixture = setup([fail('TIMEOUT'), fail('TIMEOUT')]); tree = await accept();
  click(tree, MESSAGES.modsPreviewCancel); await flush(); tree = render();
  assert.ok(text(tree).includes(MESSAGES.modsPreviewExpired));
  assert.ok(!text(tree).includes(MESSAGES.modsPreviewPending));
  await accept(); assert.notEqual(fixture.accepted[0].id, fixture.accepted[1].id);
  results.push('PASS: cancel expiry releases UI and permits a new requestId');

  fixture = setup([fail('TIMEOUT'), fail('PREVIEW_EXPIRED'), fail('TIMEOUT')], async () => ok({ previewId, status: 'completed' }));
  tree = await accept(); click(tree, MESSAGES.modsPreviewCancel); await flush(); tree = render();
  assert.ok(text(tree).includes(MESSAGES.modsPreviewExpired)); await accept();
  assert.notEqual(fixture.accepted[0].id, fixture.accepted[1].id);
  results.push('PASS: expiry in the post-cancel status read also permits retry');

  const issue = { moment: 'after', scope: 'local', severity: 'error', code: 'VERSION_MISMATCH', fileId: file.fileId,
    modId: 'example_mod', dependencyModId: 'target_mod', dependencyProjectId: null, dependencyVersionId: null,
    requirement: '>=2', actual: ['1.0'], embeddedDepth: 2 };
  const display = { rootId, instanceId, instanceRevision: 1, fingerprint: report.fingerprint, fileId: file.fileId,
    filename: file.filename, sha256: file.sha256, action: 'disable', state: 'blocked', providers: [], directRequiredBy: [],
    transitiveRequiredBy: [], relations: [], platformFailures: [], incomplete: false, issues: [issue,
      { ...issue, fileId: other.fileId, severity: 'warning', actual: ['1.5'], embeddedDepth: 0 },
      { ...issue, scope: 'platform', severity: 'unknown', fileId: '9'.repeat(64), modId: null, dependencyModId: null,
        dependencyProjectId: 'project1', dependencyVersionId: null, requirement: null, actual: [], embeddedDepth: 0 }] };
  const completed = ok({ previewId, status: 'completed', result: display, errorCode: null });
  assert.equal(isPreviewResult(completed, rootId, 'mods:maintenancePreviewStatus'), true);
  setup([completed]); tree = await accept();
  const items = nodes(tree, node => node.type === 'li').map(text);
  assert.equal(items.length, 3);
  assert.ok(items[0].includes('first.jar') && items[0].includes(MESSAGES.modsIssueError)
    && items[0].includes(MESSAGES.modsDeclaration) && items[0].includes('1.0')
    && items[0].includes(`${MESSAGES.modsPreviewEmbeddedDepth} 2`));
  assert.ok(items[1].includes('second.jar') && items[1].includes(MESSAGES.modsIssueWarning) && items[1].includes('1.5'));
  assert.ok(items[2].includes('Modrinth') && items[2].includes(`${'9'.repeat(64)} (${MESSAGES.modsUnknown})`));
  assert.doesNotMatch(text(tree), /https?:|[A-Z]:\\|nested\/private/i);
  for (const privateText of ['https://private.invalid/token', 'C:\\private\\mods', 'nested/private.jar']) {
    const invalid = structuredClone(completed); invalid.data.result.issues[0].actual = [privateText];
    assert.equal(isPreviewResult(invalid, rootId, 'mods:maintenancePreviewStatus'), false);
  }
  results.push('PASS: files/severity/source/actual/depth distinguish issues; unknown IDs remain explicit; public validator rejects URL/path evidence');
  console.log(results.join('\n'));
  await writeFile(path.join(output, 'result.json'), JSON.stringify({ status: 'PASS', checks: results, component: 'production MaintenancePreviewPanel',
    hooks: 'controlled substitute', transport: 'mock bridge', realReactDomOrElectron: false }, null, 2));
} finally { cleanup(); }
