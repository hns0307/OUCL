import { JavaProbe, JavaProbeError } from '../java/probe.js';
import type { ProfileService } from '../launch/profiles.js';
import { ModInventoryError } from './inventory.js';

/** Reads current JVM facts from registered candidates only: no discovery, downloads or registration writes. */
export class InstalledJavaFacts {
  private active = false;
  constructor(private readonly profiles: Pick<ProfileService, 'list'>, private readonly probe: Pick<JavaProbe, 'probe'> = new JavaProbe()) {}
  async read(major: number, signal?: AbortSignal): Promise<string | null> {
    if (this.active) throw new ModInventoryError('SCAN_BUSY');
    this.active = true;
    const check = (): void => { if (signal?.aborted) throw new ModInventoryError('CANCELLED'); };
    try {
      check(); const saved = await this.profiles.list(); check();
      const candidates = [...saved.javas].sort((a, b) => Number(b.javaId === saved.selectedJavaId) - Number(a.javaId === saved.selectedJavaId))
        .filter(java => java.major === major);
      let version: string | null = null;
      for (const java of candidates) {
        check();
        try {
          const measured = await this.probe.probe(java.executable, { ...(signal ? { signal } : {}), timeoutMs: 2000 }); check();
          if (measured.major === major) { version = measured.version; break; }
        } catch (error) {
          check();
          if (!(error instanceof JavaProbeError)) throw error;
          if (error.code === 'CANCELLED') throw new ModInventoryError('CANCELLED');
          // Unavailable registered JVMs provide no version evidence; never reuse their saved banner.
        }
      }
      check();
      if (JSON.stringify(await this.profiles.list()) !== JSON.stringify(saved)) throw new ModInventoryError('FILES_CHANGED');
      check(); return version;
    } finally { this.active = false; }
  }
}
