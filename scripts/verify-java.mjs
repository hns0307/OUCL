import { mkdir, writeFile } from 'node:fs/promises';
import { JavaProbe } from '../.test-build/src/services/java/probe.js';

// The operator supplies a previously trusted executable; no disk scan or Java download occurs.
let report;
try {
  const runtime = await new JavaProbe().probe(process.argv[2]);
  const { major, version, vendor, architecture, os } = runtime;
  report = { status: 'PASS', timestamp: new Date().toISOString(), major, version, vendor, architecture, os,
    shell: false, runtimeInstalled: false, systemSettingsChanged: false, gameLaunched: false };
} catch (error) {
  report = { status: 'FAIL', timestamp: new Date().toISOString(), code: error && typeof error === 'object' && 'code' in error ? error.code : 'VERIFICATION_FAILED' };
  process.exitCode = 1;
}
await mkdir('docs/validation/A1-06-java-probe', { recursive: true });
await writeFile('docs/validation/A1-06-java-probe/local-java.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report));
