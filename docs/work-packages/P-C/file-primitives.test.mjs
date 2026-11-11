import assert from 'node:assert/strict';
import test from 'node:test';
import { constants } from 'node:fs';
import { copyFile, lstat, mkdir, mkdtemp, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const base = fileURLToPath(new URL('./evidence/v2a/.test-build/primitives/', import.meta.url));
await mkdir(base, { recursive: true });
// All files are inert bytes under this work package; retain them for inspection.
test('Windows Node rename is not a no-clobber move', async () => {
  const directory = await mkdtemp(path.join(base, 'rename-'));
  const source = path.join(directory, 'source.jar'); const target = path.join(directory, 'target.jar');
  await writeFile(source, 'original'); await writeFile(target, 'foreign');
  await rename(source, target);
  assert.equal(await readFile(target, 'utf8'), 'original');
});
test('COPYFILE_EXCL preserves an occupied target byte for byte', async () => {
  const directory = await mkdtemp(path.join(base, 'copy-'));
  const source = path.join(directory, 'source.jar'); const target = path.join(directory, 'target.jar');
  await writeFile(source, 'original'); await writeFile(target, 'foreign');
  await assert.rejects(copyFile(source, target, constants.COPYFILE_EXCL), { code: 'EEXIST' });
  assert.equal(await readFile(target, 'utf8'), 'foreign');
  assert.equal(await readFile(source, 'utf8'), 'original');
});
test('an identity check followed by path unlink cannot exclude an injected external replacement', async () => {
  const directory = await mkdtemp(path.join(base, 'identity-'));
  const source = path.join(directory, 'source.jar'); const retained = path.join(directory, 'retained.jar');
  await writeFile(source, 'original'); const observed = await lstat(source, { bigint: true });
  const checked = await lstat(source, { bigint: true }); assert.equal(checked.ino, observed.ino);
  // A deterministic external actor boundary, not a claim about an observed player-data incident.
  await rename(source, retained); await writeFile(source, 'foreign');
  assert.notEqual((await lstat(source, { bigint: true })).ino, observed.ino);
  await unlink(source);
  await assert.rejects(readFile(source), { code: 'ENOENT' });
  assert.equal(await readFile(retained, 'utf8'), 'original');
});
