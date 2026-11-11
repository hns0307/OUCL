import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ModFileSummary, ModReport } from '../../../src/shared/contracts/mods-report.js';
import { MaintenancePreviewPanel } from '../../../src/ui/MaintenancePreviewPanel.js';

const rootId = '00000000-0000-4000-8000-000000000001';
const file: ModFileSummary = { fileId: 'a'.repeat(64), filename: 'example.jar', enabled: true, size: 1, sha1: 'b'.repeat(40),
  sha256: 'c'.repeat(64), sha512: 'd'.repeat(128), mods: [], source: null, sourceStatus: 'unknown', issues: [] };
const report: ModReport = { formatVersion: 1, instanceId: '00000000-0000-4000-8000-000000000002', instanceRevision: 1,
  fingerprint: 'e'.repeat(64), checkedAt: '2026-11-11T00:00:00.000Z', mode: 'check', localState: 'satisfied', state: 'unknown', files: [file], issues: [] };

test('initial read-only UI uses the correct physical JAR action and never offers an execution button', () => {
  const html = renderToStaticMarkup(createElement(MaintenancePreviewPanel, { rootId, report, file, disabled: false }));
  assert.match(html, /预览禁用影响/); assert.doesNotMatch(html, />禁用</);
  const disabledFile = { ...file, filename: 'example.jar.disabled', enabled: false };
  const disabledHtml = renderToStaticMarkup(createElement(MaintenancePreviewPanel, { rootId, report, file: disabledFile, disabled: true }));
  assert.match(disabledHtml, /预览启用影响/); assert.match(disabledHtml, /<button disabled=""/);
});
