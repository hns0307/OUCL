import { chmod, lstat, mkdir, open, readdir, rename, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { UUID_PATTERN } from '../../shared/contracts/handshake.js';
import { verifyArtifact } from '../../core/download/integrity.js';
import type { ExpectedArtifact } from '../../core/download/integrity.js';
import { guardDirectory, hasCode, ownsLease, readRegular } from '../storage/files.js';
import type { IndexedObject } from '../storage/object-index.js';
import type { HashOptions } from '../workers/hash-pool.js';
import type { HashResult } from '../workers/protocol.js';
import { definition, ObjectError, parseProvenance, sourceKey } from './provenance.js';
import type { Provenance, TrustAnchor } from './provenance.js';

interface Index {
  lookup(key: string): Promise<IndexedObject | undefined>;
  remember(key: string, object: IndexedObject): Promise<void>;
  clear(): Promise<void>;
}
interface Hasher { hash(file: string, options: HashOptions): Promise<HashResult> }
export interface ObjectRef extends IndexedObject { sourceKey: string }
export type ObjectCheckpoint = 'object-committed' | 'proof-committed';

async function directory(parent: string, name: string): Promise<string> {
  await guardDirectory(parent);
  const target = path.join(parent, name);
  try { await mkdir(target); } catch (error) { if (!hasCode(error, 'EEXIST')) throw error; }
  return guardDirectory(target);
}
async function exists(file: string): Promise<boolean> {
  try {
    const info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink()) throw new ObjectError('NEEDS_RECOVERY');
    return true;
  } catch (error) { if (hasCode(error, 'ENOENT')) return false; throw error; }
}

/** Append-only shared bytes and independent provenance. No GC, reference-count deletion or player paths. */
export class ObjectStore {
  private tail: Promise<void> = Promise.resolve();
  private closed = false;
  private constructor(private readonly root: string, private readonly token: string, private readonly index: Index, private readonly hasher: Hasher) {}

  /** Claims a dedicated registered store directory; stale/foreign owners remain fail-closed. */
  static async open(root: string, index: Index, hasher: Hasher): Promise<ObjectStore> {
    let canonical: string;
    try { canonical = await guardDirectory(root); } catch { throw new ObjectError('OBJECT_IO'); }
    const token = randomUUID();
    let handle;
    try { handle = await open(path.join(canonical, 'objects.owner.lock'), 'wx'); }
    catch (error) { throw new ObjectError(hasCode(error, 'EEXIST') ? 'STORE_BUSY' : 'OBJECT_IO'); }
    try {
      await handle.writeFile(token); await handle.sync(); await handle.close();
      await directory(canonical, 'staging');
      await directory(await directory(canonical, 'objects'), 'sha256');
      return new ObjectStore(canonical, token, index, hasher);
    } catch (error) {
      await handle.close().catch(() => {});
      if (await ownsLease(path.join(canonical, 'objects.owner.lock'), token)) await unlink(path.join(canonical, 'objects.owner.lock'));
      throw error instanceof ObjectError ? error : new ObjectError('OBJECT_IO');
    }
  }
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const pending = this.tail.then(async () => {
      if (this.closed) throw new ObjectError('OBJECT_IO');
      try { await guardDirectory(this.root); return await work(); }
      catch (error) { throw error instanceof ObjectError ? error : new ObjectError(hasCode(error, 'NEEDS_RECOVERY') || hasCode(error, 'UNSAFE_PATH') ? 'NEEDS_RECOVERY' : 'OBJECT_IO'); }
    });
    this.tail = pending.then(() => {}, () => {}); return pending;
  }
  private staging(id: string): string {
    if (!UUID_PATTERN.test(id)) throw new ObjectError('INVALID_ARTIFACT');
    return path.join(this.root, 'staging', `${id}.part`);
  }
  private objectFile(digest: string): string {
    if (!/^[a-f0-9]{64}$/.test(digest)) throw new ObjectError('INVALID_ARTIFACT');
    return path.join(this.root, 'objects', 'sha256', digest.slice(0, 2), digest);
  }
  /** Allocates a private writable file for the downloader; this path must never cross renderer IPC. */
  createStaging(): Promise<{ id: string; file: string }> {
    return this.serial(async () => {
      await guardDirectory(path.join(this.root, 'staging'));
      const id = randomUUID(); const file = this.staging(id); const handle = await open(file, 'wx'); await handle.close();
      return { id, file };
    });
  }
  /** Resolves only a known durable staging UUID; unknown or linked entries never become writable targets. */
  resumeStaging(id: string): Promise<string> {
    return this.serial(async () => {
      const file = this.staging(id); await guardDirectory(path.dirname(file));
      if (!await exists(file)) throw new ObjectError('NEEDS_RECOVERY');
      return file;
    });
  }
  private async verify(file: string, expected: ExpectedArtifact, digest?: string): Promise<HashResult> {
    const bytes = await this.hasher.hash(file, { maximumBytes: 64 * 1024 ** 3 });
    const result = verifyArtifact(expected, bytes);
    if (!result.ok) throw new ObjectError('HASH_MISMATCH');
    if (digest !== undefined && bytes.sha256 !== digest) throw new ObjectError('NEEDS_RECOVERY');
    return bytes;
  }
  private async proof(objectDigest: string, key: string): Promise<Provenance | undefined> {
    const folder = `${this.objectFile(objectDigest)}.sources`;
    try { await guardDirectory(folder); } catch (error) { if (hasCode(error, 'ENOENT')) return undefined; throw error; }
    const bytes = await readRegular(path.join(folder, `${key}.json`), 65536);
    if (bytes === undefined) return undefined;
    const value = parseProvenance(bytes);
    if (value.objectDigest !== objectDigest || sourceKey(value.expected, value.anchor) !== key) throw new ObjectError('NEEDS_RECOVERY');
    return value;
  }
  /** Uses hints only after verifying their exact provenance sidecar and actual object bytes. */
  lookup(expected: ExpectedArtifact, anchor: TrustAnchor): Promise<ObjectRef | undefined> {
    return this.serial(async () => {
      const facts = definition(expected, anchor); const key = sourceKey(facts.expected, facts.anchor);
      const found = await this.index.lookup(key);
      if (!found) return undefined;
      const proof = await this.proof(found.digest, key);
      if (!proof) return undefined;
      if (proof.expected.size !== found.size || found.size !== facts.expected.size) throw new ObjectError('NEEDS_RECOVERY');
      await this.verify(this.objectFile(found.digest), facts.expected, found.digest);
      return { ...found, sourceKey: key };
    });
  }
  private async saveProof(digest: string, facts: ReturnType<typeof definition>): Promise<string> {
    const key = sourceKey(facts.expected, facts.anchor); const target = this.objectFile(digest);
    const proof: Provenance = { schemaVersion: 1, objectDigest: digest, ...facts };
    const sources = await directory(path.dirname(target), path.basename(target) + '.sources');
    const old = await this.proof(digest, key);
    if (!old) {
      const temporary = path.join(sources, `${randomUUID()}.tmp`); const handle = await open(temporary, 'wx');
      try { await handle.writeFile(JSON.stringify(proof) + '\n'); await handle.sync(); } finally { await handle.close(); }
      await rename(temporary, path.join(sources, `${key}.json`));
    }
    return key;
  }
  /** Rechecks existing content against another independently trusted source before recording its own proof. */
  adopt(digest: string, expected: ExpectedArtifact, anchor: TrustAnchor): Promise<ObjectRef> {
    return this.serial(async () => {
      const facts = definition(expected, anchor); const bytes = await this.verify(this.objectFile(digest), facts.expected, digest);
      const key = await this.saveProof(digest, facts); const object = { digest, size: bytes.size };
      await this.index.remember(key, object); return { ...object, sourceKey: key };
    });
  }
  /** Commits only fully verified staging bytes; equal existing content is checked and shared, never overwritten. */
  commit(id: string, expected: ExpectedArtifact, anchor: TrustAnchor,
    checkpoint: (point: ObjectCheckpoint) => Promise<void> = async () => {}): Promise<ObjectRef> {
    return this.serial(async () => {
      const facts = definition(expected, anchor); const key = sourceKey(facts.expected, facts.anchor);
      const staging = this.staging(id); await guardDirectory(path.dirname(staging));
      if (!await exists(staging)) throw new ObjectError('INVALID_ARTIFACT');
      const observed = await this.verify(staging, facts.expected);
      const target = this.objectFile(observed.sha256);
      await directory(path.dirname(path.dirname(target)), observed.sha256.slice(0, 2));
      if (await exists(target)) {
        await this.verify(target, facts.expected, observed.sha256);
        await unlink(staging);
      } else {
        const handle = await open(staging, 'r+'); try { await handle.sync(); } finally { await handle.close(); }
        await rename(staging, target);
      }
      await chmod(target, 0o444);
      await checkpoint('object-committed');
      await this.saveProof(observed.sha256, facts);
      await checkpoint('proof-committed');
      const object = { digest: observed.sha256, size: observed.size };
      await this.index.remember(key, object);
      return { ...object, sourceKey: key };
    });
  }
  /** Rebuilds search hints from sidecars plus actual bytes. Orphan bytes are retained without acquiring trust. */
  rebuildIndex(): Promise<number> {
    return this.serial(async () => {
      await this.index.clear(); let count = 0;
      const objects = path.join(this.root, 'objects', 'sha256'); await guardDirectory(objects);
      for (const prefix of await readdir(objects)) {
        if (!/^[a-f0-9]{2}$/.test(prefix)) throw new ObjectError('NEEDS_RECOVERY');
        const folder = path.join(objects, prefix); await guardDirectory(folder);
        for (const name of await readdir(folder)) {
          if (!/^[a-f0-9]{64}\.sources$/.test(name)) continue;
          const digest = name.slice(0, 64);
          if (!digest.startsWith(prefix)) throw new ObjectError('NEEDS_RECOVERY');
          const sources = path.join(folder, name); await guardDirectory(sources);
          for (const entry of await readdir(sources)) {
            if (entry.endsWith('.tmp')) continue; // Keep incomplete evidence; never infer source trust from it.
            if (!/^[a-f0-9]{64}\.json$/.test(entry)) throw new ObjectError('NEEDS_RECOVERY');
            const key = entry.slice(0, 64); const proof = await this.proof(digest, key);
            if (!proof) throw new ObjectError('NEEDS_RECOVERY');
            await this.verify(this.objectFile(digest), proof.expected, digest);
            await this.index.remember(key, { digest, size: proof.expected.size }); count++;
          }
        }
      }
      return count;
    });
  }
  /** Deletes one known staging entry, never an object or a linked target. */
  discardStaging(id: string): Promise<void> {
    return this.serial(async () => { const file = this.staging(id); await guardDirectory(path.dirname(file)); if (await exists(file)) await unlink(file); });
  }
  /** Releases this owner after all admitted commits finish. Does not close externally owned index/hasher. */
  close(): Promise<void> {
    return this.serial(async () => {
      const lease = path.join(this.root, 'objects.owner.lock');
      if (!await ownsLease(lease, this.token)) throw new ObjectError('NEEDS_RECOVERY');
      await unlink(lease); this.closed = true;
    });
  }
}
