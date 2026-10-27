import assert from 'node:assert/strict';
import test from 'node:test';
import { canInstallLoaderMinecraft, LOADER_INSTALL_TARGETS, preferredLoaderVersion } from '../src/shared/contracts/loader-targets.js';

test('four loader targets preserve approved Minecraft and Java identities without claiming runtime support', () => {
  for (const kind of ['fabric', 'quilt', 'forge', 'neoforge'] as const) {
    const target = LOADER_INSTALL_TARGETS[kind]; assert.equal(target.minecraftVersion, kind === 'neoforge' ? '1.21.1' : '1.20.1');
    assert.equal(target.javaMajor, kind === 'neoforge' ? 21 : 17); assert.ok(Object.isFrozen(target));
    assert.equal(canInstallLoaderMinecraft(kind, target.minecraftVersion), true);
    assert.equal('verified' in target, false);
  }
  assert.equal(canInstallLoaderMinecraft('forge', '1.20.10'), false); assert.equal(canInstallLoaderMinecraft('forge', '1.21.1'), false);
  assert.equal(canInstallLoaderMinecraft('neoforge', '1.20.1'), false);
  assert.equal(canInstallLoaderMinecraft('fabric', '1.21.1'), true); assert.equal(canInstallLoaderMinecraft('quilt', '1.21.1'), true);
});
test('stable representative wins over an earlier returned newer loader only for its own Minecraft target', () => {
  for (const kind of ['fabric', 'quilt', 'forge', 'neoforge'] as const) {
    const target = LOADER_INSTALL_TARGETS[kind]; const versions = [{ loaderVersion: 'newer', stable: true }, { loaderVersion: target.loaderVersion, stable: true }];
    const before = JSON.stringify(versions);
    assert.equal(preferredLoaderVersion(kind, target.minecraftVersion, versions), target.loaderVersion);
    assert.equal(preferredLoaderVersion(kind, 'different-minecraft', versions), 'newer'); assert.equal(JSON.stringify(versions), before);
  }
});
test('missing or no-longer-stable target is never invented or selected over another stable version', () => {
  const target = LOADER_INSTALL_TARGETS.fabric;
  assert.equal(preferredLoaderVersion('fabric', target.minecraftVersion, [{ loaderVersion: 'other', stable: true }]), 'other');
  assert.equal(preferredLoaderVersion('fabric', target.minecraftVersion, [{ loaderVersion: target.loaderVersion, stable: false }, { loaderVersion: 'other', stable: true }]), 'other');
  assert.equal(preferredLoaderVersion('fabric', target.minecraftVersion, [{ loaderVersion: target.loaderVersion, stable: false }]), '');
  assert.equal(preferredLoaderVersion('fabric', target.minecraftVersion, []), '');
});
