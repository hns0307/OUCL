import { checkLocalMods } from '../../core/mods/check.js';
import { checkPlatformMods } from '../../core/mods/platform.js';
import { platformFacts } from '../mods/facts.js';
import { modInventoryFingerprint } from '../mods/inventory.js';
import type { ModInventoryItem } from '../mods/inventory.js';
import { checkDomainSignal, inspectLocalModArtifact, readLocalModContext } from './local-mod-evidence.js';
import type { InspectedLocalModArtifact } from './local-mod-evidence.js';
import { LocalModDomainError } from './local-mod-domain-types.js';
import type { LocalModDomainCode, LocalModDomainContext, LocalModDomainOptions, LocalModDomainPorts } from './local-mod-domain-types.js';
import { ModProjectionError, projectDistributionMods } from './local-mod-projection.js';
import { parseDistributionJournal, parseDistributionPlan, transactionDigest } from './transaction-record.js';
import type { DistributionPlan } from './transaction-record.js';

interface Session {
  created: number; context: string; identity: LocalModDomainContext['gameIdentity'];
  baseline: string; final: string; fingerprint: string;
  artifacts: Map<number, InspectedLocalModArtifact>;
  cleanup?: () => void;
}
interface Seen { digest: string; rejected?: LocalModDomainCode }
function fail(code: LocalModDomainCode): never { throw new LocalModDomainError(code); }
function limit(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < 1 || value > fallback) fail('INVALID_DOMAIN_INPUT');
  return value;
}
function facts(items: readonly ModInventoryItem[]): string {
  // Inventory's public fingerprint omits declaration/platform hashes. Bind the full observations too.
  return transactionDigest([...items].sort((a, b) => a.filename.localeCompare(b.filename)));
}
function contextKey(value: LocalModDomainContext): string {
  const env = value.context.environment;
  const ordered = (entries: Record<string, string | null>): [string, string | null][] => Object.entries(entries).sort(([a], [b]) => a.localeCompare(b));
  return transactionDigest({ ...value, context: { ...value.context, environment: {
    loader: env.loader, versions: ordered(env.versions), languageVersions: ordered(env.languageVersions),
  } } });
}

/** Internal read-only gate. Its success does not grant ownership or replace transaction receipt/lease checks. */
export class LocalModDomain {
  private readonly sessions = new Map<string, Session>();
  private readonly seen = new Map<string, Seen>();
  private readonly now: () => number;
  private readonly maxSessions: number;
  private readonly maxSeen: number;
  private readonly ttl: number;
  private closed = false;
  private active: { txId: string; controller: AbortController; settled: Promise<void> } | undefined;

  constructor(private readonly ports: LocalModDomainPorts, options: LocalModDomainOptions = {}) {
    this.now = options.now ?? Date.now;
    this.maxSessions = limit(options.maxSessions, 16);
    this.maxSeen = limit(options.maxSeen, 1024);
    this.ttl = limit(options.ttlMs, 300_000);
  }

  private time(): number {
    const value = this.now();
    if (!Number.isSafeInteger(value) || value < 0) fail('INVALID_DOMAIN_INPUT');
    return value;
  }

  private expire(): void {
    const now = this.time();
    for (const [id, session] of this.sessions) if (now < session.created || now - session.created >= this.ttl) {
      this.dropSession(id, 'DOMAIN_EXPIRED');
    }
  }

  private dropSession(id: string, rejected?: LocalModDomainCode): void {
    this.sessions.get(id)?.cleanup?.();
    this.sessions.delete(id);
    const seen = this.seen.get(id);
    if (seen && rejected) seen.rejected = rejected;
  }

  private bindCancellation(id: string, session: Session, signal?: AbortSignal): void {
    if (!signal) return;
    const abort = (): void => {
      this.dropSession(id, 'CANCELLED');
      if (this.active?.txId === id) this.active.controller.abort();
    };
    session.cleanup = () => signal.removeEventListener('abort', abort);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  }

  private async run<T>(input: DistributionPlan, signal: AbortSignal | undefined,
    work: (plan: DistributionPlan, signal: AbortSignal) => Promise<T>): Promise<T> {
    if (this.closed) fail('DOMAIN_CLOSED');
    if (this.active) fail('DOMAIN_BUSY');
    checkDomainSignal(signal);
    let plan: DistributionPlan;
    try { plan = parseDistributionPlan(structuredClone(input)); } catch { return fail('INVALID_DOMAIN_INPUT'); }
    this.expire();
    const digest = transactionDigest(plan); const old = this.seen.get(plan.txId);
    if (old && old.digest !== digest) fail('INVALID_DOMAIN_INPUT');
    if (old?.rejected) fail(old.rejected);
    if (!old) {
      if (this.seen.size >= this.maxSeen) fail('DOMAIN_CAPACITY');
      this.seen.set(plan.txId, { digest });
    }
    const controller = new AbortController();
    const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    let finish!: () => void;
    const settled = new Promise<void>(resolve => { finish = resolve; });
    this.active = { txId: plan.txId, controller, settled };
    try { const value = await work(plan, combined); checkDomainSignal(combined); return value; }
    catch (error) {
      const code = combined.aborted ? 'CANCELLED' : error instanceof LocalModDomainError ? error.code
        : error instanceof ModProjectionError ? error.code === 'UNSUPPORTED_OPERATION' ? 'UNSUPPORTED_OPERATION'
          : error.code === 'UNKNOWN_FACTS' ? 'MODS_UNDETERMINED' : 'INVALID_DOMAIN_INPUT' : 'FILES_CHANGED';
      this.dropSession(plan.txId, code);
      throw new LocalModDomainError(code);
    } finally { this.active = undefined; finish(); }
  }

  private async inventory(plan: DistributionPlan, signal: AbortSignal): Promise<ModInventoryItem[]> {
    checkDomainSignal(signal);
    const value = await this.ports.inventory.scan(plan.instanceId, plan.instanceRevision, signal);
    checkDomainSignal(signal);
    if (value.instanceId !== plan.instanceId || value.revision !== plan.instanceRevision || !Array.isArray(value.items)
      || value.items.length > 256 || Buffer.byteLength(JSON.stringify(value.items)) > 8 * 1024 ** 2
      || value.fingerprint !== modInventoryFingerprint(plan.instanceId, plan.instanceRevision, value.items)) fail('FILES_CHANGED');
    return structuredClone(value.items);
  }

  private async phase(plan: DistributionPlan, session: Session | undefined, signal: AbortSignal): Promise<'pre' | 'post'> {
    const envelope = await this.ports.readJournal(plan.txId); checkDomainSignal(signal);
    if (envelope === undefined) return 'pre';
    try {
      if (!Number.isSafeInteger(envelope.revision) || envelope.revision < 1 || !session) fail('JOURNAL_UNAVAILABLE');
      const journal = parseDistributionJournal(envelope.data);
      if (journal.planDigest !== transactionDigest(plan) || transactionDigest(journal.plan) !== transactionDigest(plan)
        || transactionDigest(journal.gameIdentity) !== transactionDigest(session.identity)
        || journal.phase !== 'applying' || journal.pending !== null
        || journal.files.some(file => file.stage !== (file.fresh === null ? 'backedUp' : 'published'))) fail('JOURNAL_UNAVAILABLE');
      return 'post';
    } catch { return fail('JOURNAL_UNAVAILABLE'); }
  }

  private async artifacts(plan: DistributionPlan, session: Session | undefined, signal: AbortSignal): Promise<Map<number, InspectedLocalModArtifact>> {
    const result = new Map<number, InspectedLocalModArtifact>();
    let scanBytes = 0;
    for (const [index, operation] of plan.manifest.operations.entries()) if (operation.kind === 'add' || operation.kind === 'replace') {
      const inspected = await inspectLocalModArtifact(structuredClone(plan), index, this.ports, signal);
      scanBytes += Buffer.byteLength(JSON.stringify(inspected.scan));
      if (scanBytes > 8 * 1024 ** 2) fail('DOMAIN_CAPACITY');
      const old = session?.artifacts.get(index);
      if (session && (!old || transactionDigest({ evidence: old.evidence, stamp: old.stamp, scan: old.scan })
        !== transactionDigest(inspected))) fail('FILES_CHANGED');
      result.set(index, inspected);
    }
    return result;
  }

  private async compatible(plan: DistributionPlan, items: ModInventoryItem[], context: LocalModDomainContext, signal: AbortSignal): Promise<void> {
    const local = checkLocalMods(items, context.context.environment);
    const changedNames = new Set(plan.manifest.operations.filter(op => op.kind === 'add' || op.kind === 'replace').map(op => op.path.toLowerCase()));
    if (items.some(item => changedNames.has(item.filename.toLowerCase()) && local.issues.some(issue => issue.fileId === item.fileId && issue.code === 'SERVER_ONLY_MOD'))) fail('MODS_INCOMPATIBLE');
    const versions = await this.ports.versionsByHash(structuredClone(items), signal); checkDomainSignal(signal);
    const checked = checkPlatformMods(local.state, platformFacts(items), context.context.environment, versions);
    if (checked.state === 'unsatisfied') fail('MODS_INCOMPATIBLE');
    if (checked.state !== 'satisfied') fail('MODS_UNDETERMINED');
  }

  /** Validates either the unchanged baseline or the journal-proven published final inventory. */
  async validate(input: DistributionPlan, signal?: AbortSignal): Promise<void> {
    return this.run(input, signal, async (plan, combined) => {
      const session = this.sessions.get(plan.txId);
      const phase = await this.phase(plan, session, combined);
      if (!session && this.sessions.size >= this.maxSessions) fail('DOMAIN_CAPACITY');
      const before = await readLocalModContext(structuredClone(plan), this.ports, combined);
      if (session && contextKey(before) !== session.context) fail('FILES_CHANGED');
      const items = await this.inventory(plan, combined);
      if (session && facts(items) !== (phase === 'pre' ? session.baseline : session.final)) fail('FILES_CHANGED');
      const artifacts = await this.artifacts(plan, session, combined);
      const expected = phase === 'pre' ? projectDistributionMods({ plan, baseline: items,
        scans: [...artifacts].map(([operationIndex, value]) => ({ operationIndex, scan: value.scan })) })
        : { items, fingerprint: modInventoryFingerprint(plan.instanceId, plan.instanceRevision, items) };
      if (session && (expected.fingerprint !== session.fingerprint || facts(expected.items) !== session.final)) fail('FILES_CHANGED');
      await this.compatible(plan, expected.items, before, combined);
      const afterItems = await this.inventory(plan, combined);
      const after = await readLocalModContext(structuredClone(plan), this.ports, combined);
      if (contextKey(before) !== contextKey(after) || facts(items) !== facts(afterItems)
        || phase !== await this.phase(plan, session, combined)) fail('FILES_CHANGED');
      const now = this.time();
      if (session && (now < session.created || now - session.created >= this.ttl)) fail('DOMAIN_EXPIRED');
      if (phase === 'post') {
        this.dropSession(plan.txId, 'JOURNAL_UNAVAILABLE');
      } else if (!session) {
        const fresh: Session = { created: this.time(), context: contextKey(before), identity: before.gameIdentity,
          baseline: facts(items), final: facts(expected.items), fingerprint: expected.fingerprint, artifacts };
        this.sessions.set(plan.txId, fresh);
        this.bindCancellation(plan.txId, fresh, signal);
      }
    });
  }

  /** Returns only a previously validated, freshly rechecked main-owned local source. */
  async artifact(input: DistributionPlan, index: number, signal?: AbortSignal): Promise<string> {
    return this.run(input, signal, async (plan, combined) => {
      const session = this.sessions.get(plan.txId);
      if (!session || !session.artifacts.has(index)) fail('ARTIFACT_UNVERIFIED');
      if (await this.phase(plan, session, combined) !== 'pre') fail('JOURNAL_UNAVAILABLE');
      const before = await readLocalModContext(structuredClone(plan), this.ports, combined);
      if (contextKey(before) !== session.context || facts(await this.inventory(plan, combined)) !== session.baseline) fail('FILES_CHANGED');
      const inspected = await inspectLocalModArtifact(structuredClone(plan), index, this.ports, combined);
      if (transactionDigest(inspected) !== transactionDigest(session.artifacts.get(index))) fail('FILES_CHANGED');
      const after = await readLocalModContext(structuredClone(plan), this.ports, combined);
      if (contextKey(after) !== session.context || facts(await this.inventory(plan, combined)) !== session.baseline
        || await this.phase(plan, session, combined) !== 'pre') fail('FILES_CHANGED');
      const now = this.time();
      if (now < session.created || now - session.created >= this.ttl) fail('DOMAIN_EXPIRED');
      return inspected.evidence.path;
    });
  }

  /** Aborts current work and waits for actual port settlement before discarding cached observations. */
  async close(): Promise<void> {
    this.closed = true;
    const active = this.active; active?.controller.abort();
    await active?.settled;
    for (const id of this.sessions.keys()) this.dropSession(id);
    this.seen.clear();
  }
}

