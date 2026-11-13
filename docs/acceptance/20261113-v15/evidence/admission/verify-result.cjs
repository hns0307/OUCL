// Read-only: prints JSON; no GUI/IPC, writes, process control or timing injection.
const fs = require('node:fs'), path = require('node:path');
const base = __dirname, checks = [], issues = [];
const read = file => { try { return JSON.parse(fs.readFileSync(path.join(base, file), 'utf8')); } catch (error) { if (error.code !== 'ENOENT') issues.push(file); return null; } };
const first = read('first-admission.json'); let rows = [];
try {
  const lines = fs.readFileSync(path.join(base, 'window.jsonl'), 'utf8').split(/\r?\n/);
  rows = lines.flatMap((line, i) => { if (!line.trim()) return []; try { return [{ ...JSON.parse(line), line: i + 1 }]; } catch { issues.push(`window.jsonl:${i + 1}`); return []; } });
} catch (error) { if (error.code !== 'ENOENT') issues.push('window.jsonl'); }
const canonical = value => JSON.stringify(value && Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]])));
const same = (a, b) => canonical(a) === canonical(b);
const ref = row => row ? { line: row.line, time: row.time, monoMs: row.monoMs, invocation: row.invocation, requestId: row.requestId } : null;
const after = (a, b) => !!a && !!b && a.line > b.line && a.monoMs >= b.monoMs;
const check = (id, ok, detail, contrary = false) => checks.push({ id, status: ok ? 'PASS' : contrary ? 'FAIL' : 'PENDING', ...detail });
const admits = rows.filter(row => row.kind === 'handled' && row.channel === 'mods:maintenancePreview' && row.result?.ok);
const initial = admits.find(row => row.invocation === first?.invocation && row.requestId === first?.requestId
  && row.result.data.previewId === first?.previewId && same(row.input, first?.input));
const held = rows.find(row => row.kind === 'held' && row.invocation === first?.invocation && row.waitMs === 8000);
const delayedRelease = rows.find(row => row.kind === 'delivered' && row.invocation === first?.invocation);
check('first-genuine-admission-held-only-once', !!initial && after(held, initial) && rows.filter(row => row.kind === 'held').length === 1,
  { handled: ref(initial), held: ref(held), previewId: first?.previewId ?? null });
const fileOf = row => row.kind === 'dom' && row.value?.selected === first?.input?.instanceId && row.value.nodeAbsent
  ? row.value.files?.find(file => file.filename === first?.filename) : null;
const button = (file, disabled) => file?.buttons?.some(item => item.text?.trim() === '预览禁用影响' && item.disabled === disabled);
const timeout = rows.find(row => { const file = fileOf(row); return after(row, held) && (!delayedRelease || row.line < delayedRelease.line)
  && file?.alerts?.some(text => /等待超时/.test(text)) && button(file, false)
  && !file.buttons.some(item => ['重新查询预览','取消预览'].includes(item.text?.trim())); });
check('real-timeout-dom-allows-retry-not-status-query', !!timeout, { dom: ref(timeout) });
const retry = admits.find(row => row !== initial && after(row, timeout));
const identityConflict = !!retry && (retry.requestId !== first?.requestId || !same(retry.input, first?.input) || retry.result.data.previewId !== first?.previewId);
check('gui-retry-same-request-input-preview-id', !!retry && !identityConflict, { retry: ref(retry), previewId: retry?.result?.data?.previewId ?? null }, identityConflict);
const retryDelivery = rows.find(row => row.kind === 'delivered' && row.invocation === retry?.invocation && same(row.result, retry?.result));
check('retry-receipt-released-unchanged', after(retryDelivery, retry), { delivered: ref(retryDelivery) });
const ids = new Set(admits.map(row => row.result.data.previewId));
const identity = rows.find(row => row.kind === 'public-observation-identity' && row.invocation === retry?.invocation);
check('only-one-public-observation-identity', admits.length >= 2 && ids.size === 1 && identity?.uniqueReturnedPreviewIds === 1
  && identity.reusesFirstIdentity === true && admits.every(row => row.requestId === first?.requestId && same(row.input, first?.input)),
  { successfulAdmissionCalls: admits.length, uniquePreviewIds: ids.size, identityLog: ref(identity),
    meaning: 'Original-handler identities plus production start prior-id branch; not direct check-call instrumentation.' }, ids.size > 1);
const completed = rows.find(row => row.kind === 'handled' && row.channel === 'mods:maintenancePreviewStatus' && after(row, retryDelivery)
  && row.input?.previewId === first?.previewId && row.result?.ok && row.result.data.previewId === first?.previewId
  && row.result.data.status === 'completed' && row.result.data.result?.fileId === first?.input?.fileId);
const completedDelivery = rows.find(row => row.kind === 'delivered' && row.invocation === completed?.invocation && same(row.result, completed?.result));
const words = { ready: '本次已知声明未发现阻止因素', blocked: '存在阻止因素', unknown: '无法确定影响' };
const completedDom = rows.find(row => { const file = fileOf(row), word = words[completed?.result?.data?.result?.state];
  return after(row, completedDelivery) && word && file?.previewText?.includes(word) && button(file, false)
    && !file.alerts?.some(text => /等待超时|预览已过期/.test(text)) && !/正在检查影响|等待检查/.test(file.previewText); });
check('same-observation-completed-consumed-by-component', after(completedDelivery, completed) && !!completedDom,
  { handled: ref(completed), delivered: ref(completedDelivery), dom: ref(completedDom), state: completed?.result?.data?.result?.state ?? null });
check('first-late-receipt-released-not-treated-as-ui-ack', delayedRelease?.reason === 'real-8000ms-admission-delay'
  && delayedRelease.elapsedMs >= 7990 && same(delayedRelease.result, initial?.result),
  { delivered: ref(delayedRelease), elapsedMs: delayedRelease?.elapsedMs ?? null, targetDelayMs: 8000,
    meaning: 'Allows10ms scheduling granularity; actual DOM TIMEOUT independently required. Delivery is not UI receipt.' },
  !!delayedRelease && delayedRelease.reason !== 'real-8000ms-admission-delay');
const exit = rows.find(row => row.kind === 'exit'), close = rows.find(row => row.kind === 'window-closed');
const quit = rows.find(row => row.kind === 'will-quit');
check('normal-close-after-ui-completion', after(close, completedDom) && after(quit, close) && after(exit, quit) && exit.code === 0,
  { close: ref(close), exit: ref(exit) }, !!exit && exit.code !== 0);
const errors = rows.filter(row => row.kind === 'dom-error');
check('no-harness-errors-or-incomplete-log', !!exit && !errors.length && !issues.length, { errors: errors.slice(0, 3).map(ref), parseIssues: issues.slice(0, 3) }, errors.length > 0);
const status = checks.some(item => item.status === 'FAIL') ? 'FAIL' : checks.every(item => item.status === 'PASS') ? 'PASS' : 'PENDING';
process.stdout.write(JSON.stringify({ status, readOnly: true, checks,
  limits: ['Public observation identity count is not measured inspection/check invocation count.', 'GUI gesture evidence remains coordinator-owned.',
    'No files are written and no GUI/IPC or product code is executed by this verifier.'] }, null, 2) + '\n');
process.exitCode = status === 'FAIL' ? 1 : status === 'PENDING' ? 2 : 0;
