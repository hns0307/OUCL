import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ESLint } from 'eslint';

test('pure path imports remain allowed while actual Node and UI capabilities stay prohibited', async () => {
  const lint = new ESLint({ cwd: process.env.OUCL_SOURCE_ROOT ?? process.cwd() });
  const allowed = await lint.lintText("export { validateComponent } from '../path/layout.js';", { filePath: 'src/core/install/boundary.ts' });
  assert.equal(allowed[0]?.errorCount, 0);
  for (const module of ['path', 'node:path', 'fs/promises', 'electron', 'react', 'react/jsx-runtime', 'zustand']) {
    const messages = await lint.lintText(`export * from '${module}';`, { filePath: 'src/core/install/boundary.ts' });
    assert.ok(messages[0]?.messages.some(message => message.ruleId === 'no-restricted-imports'), module);
  }
  const renderer = await lint.lintText("export * from '../core/path/layout.js';", { filePath: 'src/ui/boundary.ts' });
  assert.ok(renderer[0]?.messages.some(message => message.ruleId === 'no-restricted-imports'));
});
