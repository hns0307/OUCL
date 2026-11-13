// Pure read-only evidence audit. Prints bounded JSON; never invokes Electron/IPC, writes files or changes clocks.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const base = __dirname;
const checks = [], parseIssues = [];
function readJson(name) {
  try { return JSON.parse(fs.readFileSync(path.join(base, name), 'utf8')); }
  catch (error) {
    if (error.code !== 'ENOENT') parseIssues.push({ file: name, reason: 'unreadable-or-partial-json' });
    return null;
  }
}
let rows = [];
try {
  const lines = fs.readFileSync(path.join(base, 'window.jsonl'), 'utf8').split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    if (!line.trim()) continue;
    try { rows.push({ ...JSON.parse(line), line: index + 1 }); }
    catch { parseIssues.push({ file: 'window.jsonl', line: index + 1, reason: 'invalid-or-in-progress-line' }); }
  }
} catch (error) { if (error.code !== 'ENOENT') parseIssues.push({ file: 'window.jsonl', reason: 'unreadable' }); }
const first = readJson('first-delayed.json');
const deadline = readJson('deadline-reached.json');
const probe = readJson('old-status-at-deadline.json');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const isExpired = result => result?.ok === false && result.error?.code === 'PREVIEW_EXPIRED';
const validUuid = value => typeof value === 'string' && /^[a-f\d]{8}-[a-f\d]{4}-[1-8][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i.test(value);
const before = (a, b) => !!a && !!b && a.line < b.line && a.monoMs <= b.monoMs;
const selectedDom = row => row.kind === 'dom' && row.value?.selected === first?.input?.instanceId && row.value.nodeAbsent === true;
const fileRow = row => selectedDom(row) ? row.value.files?.find(file => file.filename === first?.filename) : undefined;
const hasButton = (file, text, disabled) => file?.buttons?.some(button => button.text?.trim() === text && button.disabled === disabled);
const startText = first?.input?.action === 'enable' ? '预览启用影响' : '预览禁用影响';
const activeText = text => /正在检查影响|等待检查/.test(text ?? '');
function check(id, condition, detail, conflict = false) {
  checks.push({ id, status: condition ? 'PASS' : conflict ? 'FAIL' : 'PENDING', ...detail });
}
function ref(row) { return row ? { line: row.line, time: row.time, monoMs: row.monoMs, requestId: row.requestId } : null; }
const admitted = rows.find(row => row.kind === 'handled' && row.channel === 'mods:maintenancePreview' && row.requestId === first?.requestId
  && row.result?.ok && row.result.data.previewId === first?.previewId && same(row.input, first?.input));
const handled = rows.find(row => row.kind === 'handled' && row.channel === 'mods:maintenancePreviewStatus' && row.requestId === first?.statusRequestId
  && row.input?.previewId === first?.previewId && row.result?.ok && row.result.data.status === 'completed'
  && row.result.data.previewId === first?.previewId && row.result.data.result?.fileId === first?.input?.fileId);
const held = rows.find(row => row.kind === 'response-held' && row.requestId === first?.statusRequestId && row.previewId === first?.previewId);
const released = rows.find(row => row.kind === 'delivered' && row.requestId === first?.statusRequestId);
check('genuine-first-admission-and-completed-handled', validUuid(first?.requestId) && validUuid(first?.previewId)
  && before(admitted, handled) && before(handled, held), { admitted: ref(admitted), handled: ref(handled), held: ref(held) });
const timeoutDom = rows.find(row => {
  const file = fileRow(row);
  return before(held, row) && (!released || before(row, released)) && row.monoMs - handled.monoMs >= 2500
    && file?.alerts?.some(text => /等待超时/.test(text)) && activeText(file.previewText)
    && hasButton(file, '重新查询预览', false) && hasButton(file, startText, true);
});
check('real-component-timeout-keeps-old-active-state', !!timeoutDom, { dom: ref(timeoutDom),
  meaning: 'TIMEOUT is inferred from actual localized DOM, not synthesized from handler completion.' });
const deadlineRow = rows.find(row => row.kind === 'deadline-reached' && row.first?.previewId === first?.previewId);
const elapsed = deadline?.elapsedMs, wallElapsed = deadline && first ? Date.parse(deadline.dueAt) - Date.parse(first.completedHandledAt) : null;
check('real-retention-deadline-and-original-response-release', !!deadline && same(deadline.first, first) && before(held, deadlineRow)
  && held.waitMs === 900500 && elapsed >= 900000 && wallElapsed >= 900000
  && released?.reason === 'real-900500ms-deadline' && released.elapsedSinceHandledMs >= 900000
  && same(released.result, handled?.result) && before(deadlineRow, released), {
  deadline: ref(deadlineRow), released: ref(released), targetDelayMs: 900500, elapsedMs: elapsed ?? null, wallElapsedMs: wallElapsed,
  meaning: 'At least the real 900000ms retention elapsed; timer target900500ms is a guard margin. delivered is invoke release, not UI receipt.' },
  !!released && released.reason !== 'real-900500ms-deadline');
const probeRow = rows.find(row => row.kind === 'old-status-at-deadline' && row.first?.previewId === first?.previewId);
check('read-only-probe-sees-expired-id', !!probe && same(probe.first, first) && isExpired(probe.oldStatus)
  && same(probeRow?.oldStatus, probe.oldStatus), { probe: ref(probeRow), probeRequestId: probe?.oldStatus?.requestId ?? null,
  meaning: 'Automatic probe alone is not component-consumed expiry.' }, !!probe?.oldStatus && !isExpired(probe.oldStatus));
const guiExpired = rows.find(row => row.kind === 'handled' && row.channel === 'mods:maintenancePreviewStatus'
  && row.input?.previewId === first?.previewId && isExpired(row.result) && before(deadlineRow, row)
  && !!probe?.oldStatus?.requestId && row.requestId !== probe.oldStatus.requestId);
const guiExpiredDelivery = rows.find(row => row.kind === 'delivered' && row.requestId === guiExpired?.requestId
  && isExpired(row.result) && same(row.result, guiExpired?.result));
check('separate-requery-of-same-id-returns-expired', before(guiExpired, guiExpiredDelivery), {
  handled: ref(guiExpired), delivered: ref(guiExpiredDelivery),
  meaning: 'Excludes the automatic probe requestId; user gesture itself remains coordinator GUI evidence.' });
const recoveredDom = rows.find(row => {
  const file = fileRow(row);
  return before(guiExpiredDelivery, row) && file?.alerts?.some(text => /预览已过期/.test(text))
    && !activeText(file.previewText) && hasButton(file, startText, false)
    && !file.buttons?.some(button => ['取消预览', '重新查询预览'].includes(button.text?.trim()));
});
check('component-consumed-expiry-clears-old-controls', !!recoveredDom, { dom: ref(recoveredDom),
  meaning: 'Requires DOM expiry alert, enabled new preview, absent old working/query/cancel controls; handled/delivered alone insufficient.' });
const newAdmission = rows.find(row => row.kind === 'handled' && row.channel === 'mods:maintenancePreview'
  && before(recoveredDom, row) && same(row.input, first?.input) && validUuid(row.requestId) && row.requestId !== first?.requestId
  && row.result?.ok && validUuid(row.result.data.previewId) && row.result.data.previewId !== first?.previewId);
const newDelivered = rows.find(row => row.kind === 'delivered' && row.requestId === newAdmission?.requestId && same(row.result, newAdmission?.result));
check('new-request-and-preview-ids-distinct', before(newAdmission, newDelivered), { handled: ref(newAdmission), delivered: ref(newDelivered),
  oldRequestId: first?.requestId ?? null, oldPreviewId: first?.previewId ?? null,
  newRequestId: newAdmission?.requestId ?? null, newPreviewId: newAdmission?.result?.data?.previewId ?? null });
const newId = newAdmission?.result?.data?.previewId;
const newComplete = rows.find(row => row.kind === 'handled' && row.channel === 'mods:maintenancePreviewStatus' && before(newDelivered, row)
  && row.input?.previewId === newId && row.result?.ok && row.result.data.previewId === newId && row.result.data.status === 'completed'
  && row.result.data.result?.fileId === first?.input?.fileId);
const newCompleteDelivery = rows.find(row => row.kind === 'delivered' && row.requestId === newComplete?.requestId && same(row.result, newComplete?.result));
const stateWords = { ready: '本次已知声明未发现阻止因素', blocked: '存在阻止因素', unknown: '无法确定影响' };
const completedDom = rows.find(row => {
  const file = fileRow(row), word = stateWords[newComplete?.result?.data?.result?.state];
  return before(newCompleteDelivery, row) && word && file?.previewText?.includes(word) && !activeText(file.previewText)
    && !file.alerts?.some(text => /等待超时|预览已过期/.test(text)) && hasButton(file, startText, false);
});
check('new-completed-response-and-component-display', before(newComplete, newCompleteDelivery) && !!completedDom, {
  handled: ref(newComplete), delivered: ref(newCompleteDelivery), dom: ref(completedDom), state: newComplete?.result?.data?.result?.state ?? null });
const earlyOldRequery = rows.find(row => row.kind === 'handled' && row.channel === 'mods:maintenancePreviewStatus' && row !== handled
  && before(held, row) && (!deadlineRow || before(row, deadlineRow)) && row.input?.previewId === first?.previewId);
check('no-early-requery-or-remount-invalidating-scenario', !!deadlineRow && !earlyOldRequery
  && rows.filter(row => row.kind === 'loaded').length === 1, { earlyRequery: ref(earlyOldRequery) }, !!earlyOldRequery);
const closed = rows.find(row => row.kind === 'window-closed'), willQuit = rows.find(row => row.kind === 'will-quit');
const exit = rows.find(row => row.kind === 'exit');
check('normal-close-after-complete-ui-evidence', before(completedDom, closed) && before(closed, willQuit) && before(willQuit, exit) && exit.code === 0,
  { closed: ref(closed), exit: ref(exit) }, !!exit && exit.code !== 0);
const failures = rows.filter(row => ['probe-error', 'probe-incomplete', 'dom-error'].includes(row.kind));
check('no-recorded-harness-errors', !!exit && !failures.length && !parseIssues.length, {
  failures: failures.slice(0, 5).map(row => ({ line: row.line, kind: row.kind })), parseIssues: parseIssues.slice(0, 5),
}, !!failures.length);
const status = checks.some(item => item.status === 'FAIL') ? 'FAIL' : checks.every(item => item.status === 'PASS') ? 'PASS' : 'PENDING';
process.stdout.write(JSON.stringify({ status, readOnly: true, checks,
  limitations: ['No evidence is generated by this verifier; missing files/steps remain PENDING.',
    'handled=domain result, delivered=invoke release, component-consumed requires matching DOM.',
    'Non-probe IPC plus DOM supports the GUI path; coordinator screenshots/actions establish the user gesture.',
    'No product/clock/GUI/IPC is executed and no output file is written.'] }, null, 2) + '\n');
process.exitCode = status === 'FAIL' ? 1 : status === 'PENDING' ? 2 : 0;
