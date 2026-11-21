import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const packageRoot = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(packageRoot, '../../..');
const output = path.join(packageRoot, 'evidence/20261111');
await mkdir(output, { recursive: true });
const worker = path.join(output, 'fixed-worker.cjs');
const test = path.join(output, 'fixed-pack-preview.test.mjs');
await build({ entryPoints: [path.join(repoRoot, 'src/services/packs/fixed-worker.ts')], outfile: worker,
  bundle: true, platform: 'node', format: 'cjs', target: 'node24' });
await build({ entryPoints: [path.join(repoRoot, 'tests/fixed-pack-preview.test.ts')], outfile: test,
  bundle: true, platform: 'node', format: 'esm', target: 'node24' });
const result = spawnSync(process.execPath, ['--test', test], { cwd: repoRoot, stdio: 'inherit',
  env: { ...process.env, OUCL_SOURCE_ROOT: repoRoot, OUCL_FIXED_PACK_WORKER: worker, OUCL_FIXED_PACK_TMP: output } });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
