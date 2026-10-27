import { createHash, randomUUID } from 'node:crypto';
import type { InstanceRecord } from '../../src/services/storage/instance-records.js';
import { parseInstanceRecord } from '../../src/services/storage/instance-records.js';

/** Inert metadata fixture, not an actual Minecraft installation or launcher acceptance. */
export function modReadyInstance(rootId: string, instanceId: string): InstanceRecord {
  const sha1 = (body: string): string => createHash('sha1').update(body).digest('hex');
  const assetIndexBody = JSON.stringify({ objects: {} });
  const body = JSON.stringify({ id: '1.20.1', mainClass: 'net.minecraft.client.main.Main', libraries: [], javaVersion: { majorVersion: 17 },
    downloads: { client: { url: 'https://piston-data.mojang.com/objects/fixture/client.jar', sha1: 'a'.repeat(40), size: 8 } },
    assetIndex: { id: '5', url: `https://piston-meta.mojang.com/v1/packages/${sha1(assetIndexBody)}/5.json`, sha1: sha1(assetIndexBody), size: Buffer.byteLength(assetIndexBody) } });
  const profile = JSON.stringify({ id: 'fabric-loader-0.16.14-1.20.1', inheritsFrom: '1.20.1', mainClass: 'net.fabricmc.loader.impl.launch.knot.KnotClient',
    libraries: [{ name: 'net.fabricmc:fabric-loader:0.16.14', url: 'https://maven.fabricmc.net/' }], arguments: { game: [], jvm: [] } });
  const artifactId = `sha1-${'a'.repeat(40)}`;
  return parseInstanceRecord({ formatVersion: 2, loader: { kind: 'fabric', version: '0.16.14' }, phase: 'ready',
    summary: { instanceId, rootId, taskId: randomUUID(), displayName: 'Mod transaction fixture', mcVersionId: '1.20.1', isolation: 'on', state: 'ready', revision: 1 },
    metadata: { versionDocuments: { '1.20.1': body }, metadataSha1ByVersion: { '1.20.1': sha1(body) }, assetIndexBody,
      environment: { os: 'windows', arch: 'x64', osVersion: '10.0', features: {} }, loader: { kind: 'fabric', version: '0.16.14', profileBody: profile,
        profileSourceUrl: 'https://meta.fabricmc.net/v2/versions/loader/1.20.1/0.16.14/profile/json',
        profileSha256: createHash('sha256').update(profile).digest('hex'), libraries: [{ path: 'net/fabricmc/fabric-loader/0.16.14/fabric-loader-0.16.14.jar',
          spec: { url: 'https://maven.fabricmc.net/net/fabricmc/fabric-loader/0.16.14/fabric-loader-0.16.14.jar',
            expected: { algorithm: 'sha1', digest: 'd'.repeat(40), size: 32, provenanceId: `loader:fabric:${'d'.repeat(40)}` },
            anchor: { kind: 'loader-maven', algorithm: 'sha256', digest: 'e'.repeat(64) } } }] } },
    objects: { [artifactId]: { digest: 'b'.repeat(64), size: 8, sourceKey: 'c'.repeat(64) } },
    receipts: [{ area: 'version', path: 'client.jar', artifactId, mode: 'copy' }],
  });
}
