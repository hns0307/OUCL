import { test } from 'node:test';
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';

const execute = promisify(execFile);

test('launch recovery preserves errors and bounds restart reconciliation', async () => {
  const source = path.resolve(process.env.OUCL_SOURCE_ROOT ?? process.cwd());
  const { build } = createRequire(path.join(source, 'package.json'))('esbuild') as typeof import('esbuild');
  const temporary = await mkdtemp(path.join(tmpdir(), 'oucl-d01-recovery-'));
  const bundle = path.join(temporary, 'launch-service.mjs');
  try {
    await build({
      absWorkingDir: source, entryPoints: ['src/services/launch/service.ts'], outfile: bundle,
      bundle: true, platform: 'node', format: 'esm', target: 'node24',
      nodePaths: [path.join(source, 'node_modules')],
      plugins: [{ name: 'pure-launch-plan-double', setup(builder) {
        builder.onResolve({ filter: /core\/launch\/plan\.js$/ }, () => ({ path: 'plan', namespace: 'fixture' }));
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
          contents: 'export class LaunchPlanError extends Error {} ; export function planLaunch(){return {args:[],cwd:"fixture",executableRef:"fixture",redactedPreview:[]}}',
          loader: 'js',
        }));
      } }],
    });
    for (const fixture of ['probe.mjs', 'budget-probe.mjs']) {
      await execute(process.execPath, [path.join(source, 'tests', 'fixtures', 'launch-storage-recovery', fixture)], {
        env: { ...process.env, OUCL_D01_BUNDLE: bundle }, timeout: 30000,
      });
    }
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
