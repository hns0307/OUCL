import assert from 'node:assert/strict';
import test from 'node:test';
import { isModReport, isModFileSummary, isModReportIssue } from '../src/shared/contracts/mods-report.js';
import { publicModReport } from '../src/services/mods/report.js';
import type { ModInventory } from '../src/services/mods/inventory.js';
const fileId = 'a'.repeat(64); const instanceId = '00000000-0000-4000-8000-000000000001';
function inventory(): ModInventory {
  return { instanceId, revision: 1, fingerprint: 'b'.repeat(64), items: [{ fileId, filename: 'example.jar', enabled: true, size: 100,
    sha1: 'c'.repeat(40), sha256: 'd'.repeat(64), sha512: 'e'.repeat(128), issues: [], archives: [{ entries: [], jarJar: false, declarations: [{
      format: 'fabric', nested: [], language: null, issues: [], mods: [{ id: 'example_mod', version: '1', name: 'Example', client: 'yes', provides: [], dependencies: [], issues: [] }] }] }] }],
    local: { state: 'unknown', providers: [], issues: [{ code: 'UNKNOWN_DEPENDENCY_RANGE', severity: 'unknown', fileId,
      modId: 'example_mod', dependencyId: 'some_mod', expected: { all: ['>=1', '<2'] }, actual: ['1'], via: ['nested.jar'] }] } };
}
test('public Mod reports retain evidence while omitting raw declarations and private machine data', () => {
  const input = Object.assign(inventory(), { privatePath: 'private-root-token', rawDeclarationBody: 'private-raw-token' });
  const report = publicModReport(input, undefined, '2026-10-26T00:00:00.000Z');
  assert.ok(isModReport(report)); assert.equal(report.mode, 'list'); assert.equal(report.files[0]!.source, null);
  assert.equal(report.files[0]!.mods[0]!.name, 'Example'); assert.equal(report.files[0]!.sha512, 'e'.repeat(128));
  assert.equal(report.issues[0]!.requirement, '{"all":[">=1","<2"]}');
  assert.ok(!JSON.stringify(report).includes('private-')); assert.ok(!JSON.stringify(report).includes('declarations'));
});
test('strict report schemas reject paths, extra execution data, inconsistent source/hash facts and false success', () => {
  const report = publicModReport(inventory()); const file = report.files[0]!; const issue = report.issues[0]!;
  for (const value of [{ ...report, formatVersion: 2 }, { ...report, command: 'run' }, { ...report, state: 'satisfied' },
    { ...report, instanceId: '../path' }, { ...report, issues: [{ ...issue, fileId: 'f'.repeat(64) }] },
    { ...report, files: [file, file] }, { ...report, localState: { toString: () => 'unknown' } }]) assert.equal(isModReport(value), false);
  for (const value of [{ ...file, filename: '../example.jar' }, { ...file, enabled: false }, { ...file, sha512: null },
    { ...file, sourceStatus: 'matched' }, { ...file, sourceStatus: { toString: () => 'unknown' } },
    { ...file, mods: [{ ...file.mods[0]!, version: '${version}' }] },
    { ...file, sourceStatus: 'matched', source: { projectId: 'project1', versionId: 'version1', versionName: 'v1', url: 'https://evil.invalid' } }]) assert.equal(isModFileSummary(value), false);
  for (const value of [{ ...issue, via: ['../bad.jar'] }, { ...issue, actual: Array(17).fill('1') }, { ...issue, raw: 'body' },
    { ...issue, severity: { toString: () => 'unknown' } }, { ...issue, targetProjectId: '../path' }]) assert.equal(isModReportIssue(value), false);
});
test('report projection preserves unknown reasons and enforces finite issue/metadata budgets', () => {
  const input = inventory(); input.local.state = 'unsatisfied'; input.local.issues = Array(1000).fill(input.local.issues[0]);
  const report = publicModReport(input); assert.equal(report.issues.length, 512); assert.equal(report.issues.at(-1)!.code, 'REPORT_LIMIT');
  assert.ok(isModReport(report));
  const huge = { ...report, issues: report.issues.map(issue => ({ ...issue, requirement: 'r'.repeat(8192) })) };
  assert.equal(isModReport(huge), false);
  input.items[0]!.archives[0]!.declarations[0]!.mods = Array(257).fill(input.items[0]!.archives[0]!.declarations[0]!.mods[0]);
  assert.throws(() => publicModReport(input), { code: 'MOD_LIMIT' });
});
