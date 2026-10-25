import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InstallPlanError, installRelativePath, parseAssetIndex } from '../src/core/install/assets.js';
import { planVanillaInstall } from '../src/core/install/plan.js';
import type { AssetIndexContent } from '../src/core/install/assets.js';
import type { DownloadArtifact, ResolvedClientVersion, ResolvedLibrary } from '../src/core/version/types.js';

const hashes = { base: '1'.repeat(40), child: '2'.repeat(40), client: 'a'.repeat(40), index: 'b'.repeat(40),
  library: 'c'.repeat(40), native: 'd'.repeat(40), modern: 'e'.repeat(40), asset: 'f'.repeat(40), extra: '9'.repeat(40) };
const proof = { base: hashes.base, child: hashes.child };
function artifact(sha1: string, size: number, path?: string): DownloadArtifact {
  return { sha1, size, url: `https://libraries.minecraft.net/objects/${sha1}.jar`, ...(path === undefined ? {} : { path }) };
}
function version(libraries: ResolvedLibrary[] = []): ResolvedClientVersion {
  return { id: 'Child Display Version', ancestry: ['base', 'child'], mainClass: 'net.minecraft.client.main.Main', type: 'release', javaMajor: 21,
    client: artifact(hashes.client, 10), jarVersionId: 'base', assetIndex: { ...artifact(hashes.index, 2), id: 'index-17' },
    assetIndexVersionId: 'base', libraries, gameArguments: [], jvmArguments: [] };
}
const emptyAssets = (): AssetIndexContent => ({ objects: [], virtual: false, mapToResources: false });
function library(changes: Partial<ResolvedLibrary> = {}): ResolvedLibrary {
  return { name: 'org.example:library:1.0', sourceVersionId: 'base', artifact: artifact(hashes.library, 3), nativeExcludes: [], ...changes };
}

test('Windows x64 native extraction excludes modern x86 and ARM64 archives while preserving metadata classpath', () => {
  const input = version([
    library({ name: 'org.lwjgl:lwjgl:3.3.3:natives-windows', artifact: artifact(hashes.modern, 5) }),
    library({ name: 'org.lwjgl:lwjgl:3.3.3:natives-windows-x86', artifact: artifact(hashes.extra, 6) }),
    library({ name: 'org.lwjgl:lwjgl:3.3.3:natives-windows-arm64', artifact: artifact(hashes.native, 7) })
  ]);
  const plan = planVanillaInstall(input, proof, emptyAssets());
  assert.equal(plan.classpath.length, 3); assert.equal(plan.natives.length, 1);
  assert.ok(plan.natives[0]?.archivePath.endsWith('-natives-windows.jar'));
});

test('asset index parses Unicode names, aliases and optional legacy projections without mutating input', () => {
  const input = { objects: { 'minecraft/音效.ogg': { hash: hashes.asset.toUpperCase(), size: 6, upstream: 'ignored' },
    'minecraft/alias.ogg': { hash: hashes.asset, size: 6 } }, virtual: true, map_to_resources: true, unknown: 'ignored' };
  const before = JSON.stringify(input); const result = parseAssetIndex(input);
  assert.equal(JSON.stringify(input), before); assert.equal(result.objects[0]?.sha1, hashes.asset);
  assert.equal(result.objects[0]?.name, 'minecraft/音效.ogg'); assert.equal(result.virtual, true); assert.equal(result.mapToResources, true);
  assert.deepEqual(parseAssetIndex({ objects: {} }), emptyAssets());
});

test('asset logical names reject Windows escapes, reserved entries, case collisions and file-directory conflicts', () => {
  for (const name of ['/absolute', '../escape', 'a/../b', 'a\\b', 'a//b', 'a/', 'C:/stream', 'NUL', 'con.txt', 'a/COM1.cfg', 'a.', 'a ', '.', '..', 'a;b', 'x'.repeat(256), 'x/'.repeat(513), `a${String.fromCharCode(0)}`]) {
    assert.throws(() => parseAssetIndex({ objects: { [name]: { hash: hashes.asset, size: 6 } } }), { code: 'INVALID_INSTALL_PATH' });
  }
  assert.throws(() => parseAssetIndex({ objects: { 'Textures/A.png': { hash: hashes.asset, size: 6 }, 'textures/a.png': { hash: hashes.asset, size: 6 } } }), { code: 'INVALID_ASSET_INDEX' });
  assert.throws(() => parseAssetIndex({ objects: { directory: { hash: hashes.asset, size: 6 }, 'directory/child': { hash: hashes.asset, size: 6 } } }), { code: 'INVALID_ASSET_INDEX' });
  assert.equal(installRelativePath('中文 空格/a+b.ogg'), '中文 空格/a+b.ogg');
});

test('asset index bounds facts and rejects inconsistent sizes for the same content identity', () => {
  for (const value of [null, {}, { objects: [] }, { objects: {}, virtual: 'yes' }, { objects: {}, map_to_resources: null },
    ...[{ hash: 'bad', size: 1 }, { hash: hashes.asset, size: -1 }, { hash: hashes.asset, size: 0.1 }, { hash: hashes.asset, size: Infinity },
      { hash: hashes.asset, size: 64 * 1024 ** 3 + 1 }, { size: 1 }].map(entry => ({ objects: { a: entry } }))]) {
    assert.throws(() => parseAssetIndex(value), InstallPlanError);
  }
  assert.throws(() => parseAssetIndex({ objects: Object.fromEntries(Array.from({ length: 100001 }, (_, index) => [`a${index}`, { hash: hashes.asset, size: 1 }])) }), { code: 'INVALID_ASSET_INDEX' });
  assert.throws(() => parseAssetIndex({ objects: { a: { hash: hashes.asset, size: 1 }, b: { hash: hashes.asset, size: 2 } } }), { code: 'ARTIFACT_CONFLICT' });
});

test('vanilla install plans shared assets, Maven classpath and private native inputs using actual source proofs', () => {
  const input = version([library({ artifact: artifact(hashes.library, 3), native: artifact(hashes.native, 4), nativeClassifier: 'natives-windows-64', nativeExcludes: ['META-INF/'] }),
    library({ name: 'org.lwjgl:lwjgl:3.3.3:natives-windows', sourceVersionId: 'child', artifact: artifact(hashes.modern, 5) })]);
  const assets = parseAssetIndex({ objects: { 'minecraft/sound.ogg': { hash: hashes.asset, size: 6 }, 'minecraft/alias.ogg': { hash: hashes.asset, size: 6 },
    'minecraft/extra.ogg': { hash: hashes.extra, size: 7 } }, virtual: true, map_to_resources: true });
  const before = JSON.stringify({ input, assets, proof }); const plan = planVanillaInstall(input, proof, assets);
  assert.equal(JSON.stringify({ input, assets, proof }), before); assert.equal(plan.artifacts.length, 7); assert.equal(plan.totalBytes, 37);
  assert.equal(plan.views.length, 13); assert.equal(plan.natives.length, 2);
  assert.deepEqual(plan.classpath, ['org/example/library/1.0/library-1.0.jar', 'org/lwjgl/lwjgl/3.3.3/lwjgl-3.3.3-natives-windows.jar']);
  assert.ok(plan.natives.some(item => item.archivePath === 'org/example/library/1.0/library-1.0-natives-windows-64.jar'));
  assert.ok(plan.natives.every(item => item.exclude.includes('META-INF/')));
  assert.equal(plan.artifacts.find(item => item.sha1 === hashes.client)?.source.sha1, hashes.base);
  assert.equal(plan.artifacts.find(item => item.sha1 === hashes.modern)?.source.sha1, hashes.child);
  assert.deepEqual(plan.artifacts.find(item => item.sha1 === hashes.asset)?.source, { kind: 'mojang-assets', sha1: hashes.index });
  assert.ok(plan.views.some(item => item.area === 'version' && item.path === 'client.jar'));
  assert.ok(plan.views.some(item => item.area === 'assets' && item.path === 'virtual/index-17/minecraft/sound.ogg'));
  assert.ok(plan.views.some(item => item.area === 'resources' && item.path === 'minecraft/alias.ogg'));
  assert.ok(!plan.views.some(item => item.path.includes(input.id)));
});

test('content dedup keeps distinct official anchors and transport addresses instead of discarding source identity', () => {
  const alternate = { ...artifact(hashes.client, 10), url: 'https://piston-data.mojang.com/other-client.jar', path: 'different/library.jar' };
  const input = version([library({ artifact: alternate, sourceVersionId: 'child' }), library({ name: 'org.other:alias:2', artifact: alternate, sourceVersionId: 'child' })]);
  const assets = parseAssetIndex({ objects: { alias: { hash: hashes.client, size: 10 } } });
  const plan = planVanillaInstall(input, proof, assets); const shared = plan.artifacts.find(item => item.sha1 === hashes.client)!;
  assert.equal(plan.artifacts.length, 2); assert.equal(plan.totalBytes, 12); assert.equal(shared.proofs.length, 3);
  assert.equal(shared.alternateUrls.length, 2); assert.equal(plan.classpath.length, 1);
  assert.equal(shared.source.sha1, hashes.base); assert.ok(shared.proofs.some(item => item.source.sha1 === hashes.child));
});

test('missing, inherited or out-of-ancestry proofs never substitute the child for parent bytes', () => {
  for (const input of [version(), { ...version(), assetIndexVersionId: undefined } as unknown as ResolvedClientVersion]) {
    assert.throws(() => planVanillaInstall(input, { child: hashes.child }, emptyAssets()), { code: 'MISSING_METADATA_PROOF' });
  }
  const absentIndexOrigin = version(); delete absentIndexOrigin.assetIndexVersionId;
  assert.throws(() => planVanillaInstall(absentIndexOrigin, proof, emptyAssets()), { code: 'MISSING_METADATA_PROOF' });
  const absentIndexProof = version(); absentIndexProof.jarVersionId = 'child';
  assert.throws(() => planVanillaInstall(absentIndexProof, { child: hashes.child }, emptyAssets()), { code: 'MISSING_METADATA_PROOF' });
  assert.throws(() => planVanillaInstall(version([library({ sourceVersionId: 'outside' })]), { ...proof, outside: hashes.extra }, emptyAssets()), { code: 'MISSING_METADATA_PROOF' });
  assert.throws(() => planVanillaInstall(version(), Object.create(proof) as Record<string, string>, emptyAssets()), { code: 'MISSING_METADATA_PROOF' });
  assert.throws(() => planVanillaInstall(version(), { base: 'bad', child: hashes.child }, emptyAssets()), { code: 'MISSING_METADATA_PROOF' });
});

test('same digest with conflicting size, same URL with different facts and native recipe conflicts reject', () => {
  assert.throws(() => planVanillaInstall(version([library({ artifact: artifact(hashes.client, 11) })]), proof, emptyAssets()), { code: 'ARTIFACT_CONFLICT' });
  assert.throws(() => planVanillaInstall(version([library({ artifact: { ...artifact(hashes.library, 3), url: artifact(hashes.client, 10).url } })]), proof, emptyAssets()), { code: 'ARTIFACT_CONFLICT' });
  const nativeA = library({ name: 'org.lwjgl:lib:1:natives-windows', artifact: artifact(hashes.modern, 5, 'same/native.jar'), nativeExcludes: ['one/'] });
  const nativeB = library({ name: 'org.other:lib:1:natives-windows', artifact: artifact(hashes.modern, 5, 'same/native.jar'), nativeExcludes: ['two/'] });
  assert.throws(() => planVanillaInstall(version([nativeA, nativeB]), proof, emptyAssets()), { code: 'ARTIFACT_CONFLICT' });
});

test('library views reject case, file-directory and differing-content collisions', () => {
  for (const [first, second] of [['Same.jar', 'same.jar'], ['parent.jar', 'parent.jar/child.jar'], ['parent.jar/child.jar', 'parent.jar'], ['same.jar', 'same.jar']]) {
    const input = version([library({ artifact: artifact(hashes.library, 3, first) }), library({ name: 'org.other:library:2', artifact: artifact(hashes.native, 4, second) })]);
    assert.throws(() => planVanillaInstall(input, proof, emptyAssets()), { code: 'VIEW_CONFLICT' });
  }
});

test('invalid archives, coordinates, unsafe exclusions and unsupported asset-less versions fail explicitly', () => {
  const withoutIndex = version(); delete withoutIndex.assetIndex;
  assert.throws(() => planVanillaInstall(withoutIndex, proof, emptyAssets()), { code: 'ASSET_INDEX_REQUIRED' });
  for (const name of ['invalid', 'com..bad:lib:1', 'org.good:CON:1']) assert.throws(() => planVanillaInstall(version([library({ name })]), proof, emptyAssets()), InstallPlanError);
  assert.throws(() => planVanillaInstall(version([library({ artifact: { ...artifact(hashes.library, 3), url: 'http://example.com/' } })]), proof, emptyAssets()), { code: 'INVALID_ARTIFACT' });
  const nativeOnly = library({ native: artifact(hashes.native, 4), nativeClassifier: 'natives-windows' }); delete nativeOnly.artifact;
  const nativePlan = planVanillaInstall(version([nativeOnly]), proof, emptyAssets()); assert.equal(nativePlan.classpath.length, 0); assert.equal(nativePlan.natives.length, 1);
  const missingClassifier = { ...nativeOnly }; delete missingClassifier.nativeClassifier;
  assert.throws(() => planVanillaInstall(version([missingClassifier]), proof, emptyAssets()), { code: 'INVALID_LIBRARY' });
  const empty = library(); delete empty.artifact;
  assert.throws(() => planVanillaInstall(version([empty]), proof, emptyAssets()), { code: 'INVALID_LIBRARY' });
  assert.throws(() => planVanillaInstall(version([library({ name: 'org.lwjgl:lib:1:natives-windows', nativeExcludes: ['../bad'] })]), proof, emptyAssets()), { code: 'INVALID_INSTALL_PATH' });
  assert.throws(() => planVanillaInstall(version([library({ name: 'org.lwjgl:lib:1:natives-windows', nativeExcludes: Array(65).fill('safe/') as string[] })]), proof, emptyAssets()), { code: 'INSTALL_LIMIT' });
  assert.throws(() => planVanillaInstall(version(Array(10001).fill(library()) as ResolvedLibrary[]), proof, emptyAssets()), { code: 'INSTALL_LIMIT' });
  assert.throws(() => planVanillaInstall({ ...version(), client: artifact(hashes.client, 64 * 1024 ** 3 + 1) }, proof, emptyAssets()), { code: 'INSTALL_LIMIT' });
});
