import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import electron from 'electron';
import { build } from 'esbuild';

assert.equal(process.platform + '-' + process.arch, 'win32-x64');
const repo = fileURLToPath(new URL('../', import.meta.url));
const scratch = path.join(repo, '.test-build');
await mkdir(scratch, { recursive: true });
const base = await mkdtemp(path.join(scratch, 'distribution-configured-'));
const dist = path.join(base, 'dist');
const fixture = path.join(base, 'fixture.cjs');
const report = path.join(base, 'verified-result.json');
const env = { ...process.env, OUCL_BUILD_ROOT: dist, OUCL_CONFIGURED_FIXTURE_ROOT: base };
delete env.ELECTRON_RUN_AS_NODE;
delete env.OUCL_CONFIGURED_FIXTURE_RESTART;

async function run(command, args, options = {}) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: repo, env: { ...env, ...options }, stdio: 'inherit', windowsHide: true });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(path.basename(command) + ' failed: ' + (code ?? signal)));
    });
  });
}

console.log('Isolated fixture: ' + base);
await run(process.execPath, ['scripts/build.mjs']);
const common = { bundle: true, platform: 'node', format: 'cjs', target: 'node24', external: ['electron'] };
await build({ ...common, entryPoints: [path.join(repo, 'tests/runtime/distribution-configured-fixture.ts')], outfile: fixture });
const runtime = path.join(repo, 'src', 'main', 'distribution-runtime.ts');
const original = 'export function configuredDistributionRuntime(): DistributionRuntimeConfiguration | undefined {\n  return undefined;\n}';
const replacement = 'export function configuredDistributionRuntime(): DistributionRuntimeConfiguration | undefined {\n  return createConfiguredFixture();\n}';
await build({
  ...common, entryPoints: [path.join(repo, 'src/main/index.ts')], outfile: path.join(dist, 'main', 'index.cjs'),
  plugins: [{ name: 'configured-distribution-fixture-only', setup(bundle) {
    bundle.onLoad({ filter: /distribution-runtime\.ts$/ }, async entry => {
      if (path.normalize(entry.path) !== runtime) return;
      const source = (await readFile(runtime, 'utf8')).replaceAll('\r\n', '\n');
      assert.equal(source.split(original).length, 2, 'Expected exactly one production configuration stub');
      const contents = "import { createConfiguredFixture } from '../../tests/runtime/distribution-configured-fixture.js';\n" + source.replace(original, replacement);
      return { contents, loader: 'ts', resolveDir: path.dirname(runtime) };
    });
  } }],
});
await run(process.execPath, ['-e', "require(process.argv[1]).seed().catch(error => { console.error(error); process.exitCode = 1; });", fixture]);
const harness = path.join(repo, 'scripts', 'electron-distribution-configured-smoke.cjs');
await run(electron, [harness]);
await run(electron, [harness], { OUCL_CONFIGURED_FIXTURE_RESTART: 'yes' });
await run(process.execPath, ['-e', [
  "(async () => {",
  "  const f = require('node:fs/promises'); const p = require('node:path');",
  "  const first = JSON.parse(await f.readFile(p.join(process.argv[2], 'electron-result.json'), 'utf8'));",
  "  const restart = JSON.parse(await f.readFile(p.join(process.argv[2], 'restart-result.json'), 'utf8'));",
  "  const stores = await require(process.argv[1]).inspect(first);",
  "  await f.writeFile(process.argv[3], JSON.stringify({ status: 'PASS', externalNetwork: false,",
  "    syntheticPublisherKeyAndArtifacts: true, productionBuildExceptConfigurationStub: true, first, restart, stores }, null, 2) + '\\n');",
  "})().catch(error => { console.error(error); process.exitCode = 1; });",
].join('\n'), fixture, base, report]);

if (process.argv[2] === '--record') {
  const directory = path.join(repo, 'docs/execution/20261119-coordination/configured-evidence');
  await mkdir(directory, { recursive: true });
  for (const name of ['verified-result.json', 'prepared.png', 'task-completed.png', 'task-reopened.png']) {
    await cp(path.join(base, name), path.join(directory, name));
  }
}
console.log(await readFile(report, 'utf8'));
