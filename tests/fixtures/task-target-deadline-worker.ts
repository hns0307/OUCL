import { build } from 'esbuild';
import type { Plugin } from 'esbuild';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

function once(source: string, before: string, after: string): string {
  if (source.split(before).length !== 2) throw new Error(`INSTRUMENTATION_MISMATCH: ${before}`);
  return source.replace(before, after);
}
const plugin: Plugin = { name: 'test-only-deterministic-inventory-clock', setup(api) {
  api.onLoad({ filter: /[\\/]src[\\/]services[\\/](?:storage[\\/]tasks|workers[\\/]mod-targets|workers[\\/]entry)\.ts$/ }, async args => {
    let source = (await readFile(args.path, 'utf8')).replaceAll('\r\n', '\n');
    if (args.path.endsWith(`${path.sep}tasks.ts`)) {
      source = once(source, "    identity(ownerId); identity(taskId);\n    const row = this.db.prepare('SELECT owner_id, kind, execution FROM tasks WHERE id=? AND owner_id=?').get(taskId, ownerId);",
        "    identity(ownerId); identity(taskId);\n    if (globalThis.__b02Active) globalThis.__b02Gets++;\n    const row = this.db.prepare('SELECT owner_id, kind, execution FROM tasks WHERE id=? AND owner_id=?').get(taskId, ownerId);");
    } else if (args.path.endsWith(`${path.sep}mod-targets.ts`)) {
      source = source.replaceAll('Date.now()', 'b02Now()');
      source = `const b02Now = () => globalThis.__b02Active ? 100000 + (globalThis.__b02Gets >= 3 ? 2001 : 0) : Date.now();\n${source}`;
    } else {
      source = `import { appendFileSync as b02Append } from 'node:fs';\n${source}`;
      source = once(source, "        else if (command.kind === 'mod-targets:read') modTargets = await readModTargets(store, command);",
        `        else if (command.kind === 'mod-targets:read') {
          globalThis.__b02Active = !globalThis.__b02Completed; globalThis.__b02Gets = 0;
          try { modTargets = await readModTargets(store, command); }
          finally { b02Append(path.join(directory, 'b02-trace.log'), JSON.stringify({ active: globalThis.__b02Active, gets: globalThis.__b02Gets }) + '\\n'); globalThis.__b02Completed = true; globalThis.__b02Active = false; }
        }`);
    }
    return { contents: source, loader: 'ts', resolveDir: path.dirname(args.path) };
  });
} };

/** Test-only clock/count injection; never used to build the product worker. */
export async function buildTaskTargetDeadlineWorker(sourceRoot: string, output: string): Promise<string> {
  await mkdir(output, { recursive: true });
  const file = path.join(output, 'deadline-worker.cjs');
  await build({ absWorkingDir: sourceRoot, entryPoints: [path.join(sourceRoot, 'src/services/workers/entry.ts')], bundle: true, platform: 'node', format: 'cjs', target: 'node24', outfile: file, plugins: [plugin] });
  return file;
}
