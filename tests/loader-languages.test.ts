import assert from 'node:assert/strict';
import test from 'node:test';
import { loaderLanguageCandidates } from '../src/core/loaders/languages.js';
const forge = 'net/minecraftforge/javafmllanguage/1.20.1-47.4.28/javafmllanguage-1.20.1-47.4.28.jar';
const neo = 'net/neoforged/fancymodloader/loader/4.0.45/loader-4.0.45.jar';
test('provider facts distinguish Forge major from the independent NeoForge FML artifact version', () => {
  assert.deepEqual(loaderLanguageCandidates('forge', '1.20.1', '47.4.28', [forge]), [{ path: forge, versions: { javafml: '47' } }]);
  const low = forge.replaceAll('javafmllanguage', 'lowcodelanguage');
  assert.equal(loaderLanguageCandidates('forge', '1.20.1', '47.4.28', [forge, low])[1]!.versions.lowcodefml, '47');
  assert.deepEqual(loaderLanguageCandidates('neoforge', '1.21.1', '21.1.265', [neo]), [{ path: neo, versions: { javafml: '4.0.45', lowcodefml: '4.0.45' } }]);
  for (const paths of [[], [neo, neo], [neo.replace('loader-4.0.45', 'loader-4.0.44')], [neo.replaceAll('4.0.45', '5.0.0')], Array(257).fill(neo)]) {
    assert.deepEqual(loaderLanguageCandidates('neoforge', '1.21.1', '21.1.265', paths), []);
  }
  assert.deepEqual(loaderLanguageCandidates('forge', '1.20.1', '47.4.28', [forge, forge]), []);
  assert.deepEqual(loaderLanguageCandidates('forge', '1.20.2', '48.0.0', [forge]), []);
  assert.deepEqual(loaderLanguageCandidates('neoforge', '1.21.4', '21.4.1', [neo]), []);
});
