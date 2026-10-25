export type Compatibility = 'satisfied' | 'unsatisfied' | 'unknown';
export type RangeDialect = 'fabric' | 'quilt' | 'maven';
interface NumericVersion { parts: number[]; prerelease: string[] }
function numeric(value: string): NumericVersion | undefined {
  const match = /^(0|[1-9]\d*)(?:\.(\d+))?(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(value);
  if (!match) return undefined;
  const parts = match.slice(1, 5).filter(part => part !== undefined).map(Number);
  if (parts.some(part => !Number.isSafeInteger(part))) return undefined;
  return { parts, prerelease: match[5]?.split('.') ?? [] };
}
function compare(a: NumericVersion, b: NumericVersion): number {
  for (let i = 0; i < Math.max(a.parts.length, b.parts.length); i++) {
    const delta = (a.parts[i] ?? 0) - (b.parts[i] ?? 0); if (delta) return Math.sign(delta);
  }
  if (!a.prerelease.length || !b.prerelease.length) return a.prerelease.length === b.prerelease.length ? 0 : a.prerelease.length ? -1 : 1;
  for (let i = 0; i < Math.max(a.prerelease.length, b.prerelease.length); i++) {
    const x = a.prerelease[i]; const y = b.prerelease[i]; if (x === y) continue;
    if (x === undefined || y === undefined) return x === undefined ? -1 : 1;
    if (/^\d+$/.test(x) && /^\d+$/.test(y)) {
      if (x.length !== y.length) return Math.sign(x.length - y.length);
    } else if (/^\d+$/.test(x) !== /^\d+$/.test(y)) return /^\d+$/.test(x) ? -1 : 1;
    return x < y ? -1 : 1;
  }
  return 0;
}
/** Three-valued AND: an unsupported constraint cannot accidentally become a successful check. */
export function allCompatibility(values: readonly Compatibility[]): Compatibility {
  return values.includes('unsatisfied') ? 'unsatisfied' : values.includes('unknown') ? 'unknown' : 'satisfied';
}
/** Three-valued OR for metadata alternatives, preserving each original condition. */
export function anyCompatibility(values: readonly Compatibility[]): Compatibility {
  return values.includes('satisfied') ? 'satisfied' : values.includes('unknown') ? 'unknown' : 'unsatisfied';
}
function result(value: boolean): Compatibility { return value ? 'satisfied' : 'unsatisfied'; }
function predicate(value: string, version: string): Compatibility {
  if (value === '*') return 'satisfied';
  const match = /^(>=|<=|>|<|=|~|\^)?([^\s]+)$/.exec(value); if (!match) return 'unknown';
  const operator = match[1] ?? '='; const base = match[2]!;
  if (operator === '=' && base === version) return 'satisfied';
  const wild = /^(\d+(?:\.\d+)*)\.([x*])(?:\.[x*])*$/i.exec(base);
  if (wild) {
    const actual = numeric(version); if (!actual || operator !== '=') return 'unknown';
    return result(wild[1]!.split('.').every((part, i) => Number(part) === actual.parts[i]));
  }
  const actual = numeric(version); const expected = numeric(base);
  if (!actual || !expected) return 'unknown';
  const order = compare(actual, expected);
  switch (operator) {
    case '=': return result(order === 0);
    case '>': return result(order > 0);
    case '>=': return result(order >= 0);
    case '<': return result(order < 0);
    case '<=': return result(order <= 0);
    case '~': case '^': {
      const parts = [...expected.parts];
      const nonzero = parts.findIndex(part => part !== 0);
      const index = operator === '~' ? Math.min(1, parts.length - 1) : nonzero < 0 ? parts.length - 1 : nonzero;
      const upper = parts.slice(0, index + 1); upper[index] = upper[index]! + 1;
      return result(order >= 0 && compare(actual, { parts: upper, prerelease: [] }) < 0);
    }
    default: return 'unknown';
  }
}
function maven(range: string, version: string): Compatibility {
  const actual = numeric(version); if (!actual) return 'unknown';
  // A bare Maven version is a recommendation, not a minimum bound. Do not invent a policy for it.
  if (!/^[[(]/.test(range)) return 'unknown';
  const intervals = range.match(/[[(][^()[\]]*[)\]]/g);
  if (!intervals || intervals.join(',').replace(/\s/g, '') !== range.replace(/\s/g, '')) return 'unknown';
  return anyCompatibility(intervals.map(interval => {
    const body = interval.slice(1, -1).trim();
    if (!body.includes(',')) {
      if (!interval.startsWith('[') || !interval.endsWith(']')) return 'unknown';
      const expected = numeric(body); return expected ? result(compare(actual, expected) === 0) : 'unknown';
    }
    const bounds = body.split(',').map(bound => bound.trim());
    if (bounds.length !== 2 || bounds.every(bound => !bound)) return 'unknown';
    const low = bounds[0] ? numeric(bounds[0]) : undefined; const high = bounds[1] ? numeric(bounds[1]) : undefined;
    if (bounds[0] && !low || bounds[1] && !high || low && high && compare(low, high) > 0) return 'unknown';
    return result((!low || compare(actual, low) > 0 || compare(actual, low) === 0 && interval.startsWith('['))
      && (!high || compare(actual, high) < 0 || compare(actual, high) === 0 && interval.endsWith(']')));
  }));
}
/** Evaluates bounded loader-specific constraints without IO or guessing unknown version syntax.
 * Unknown formats remain unknown. Maven interval endpoints are never widened to fix upstream typos.
 */
export function matchesModRange(range: unknown, version: string, dialect: RangeDialect, depth = 0): Compatibility {
  if (depth > 16 || !version || version.length > 160) return 'unknown';
  if (Array.isArray(range)) {
    if (!range.length || range.length > 128 || dialect === 'maven') return 'unknown';
    return anyCompatibility(range.map(item => matchesModRange(item, version, dialect, depth + 1)));
  }
  if (dialect === 'quilt' && typeof range === 'object' && range !== null) {
    const keys = Object.keys(range); if (keys.length !== 1 || !['any', 'all'].includes(keys[0]!)) return 'unknown';
    const raw: unknown = (range as Record<string, unknown>)[keys[0]!];
    if (!Array.isArray(raw) || !raw.length || raw.length > 128) return 'unknown';
    const values = raw.map(item => matchesModRange(item, version, dialect, depth + 1));
    return keys[0] === 'all' ? allCompatibility(values) : anyCompatibility(values);
  }
  if (typeof range !== 'string' || !range.trim() || range.length > 2048) return 'unknown';
  const text = range.trim(); if (text === '*') return 'satisfied';
  if (dialect === 'maven') return maven(text, version);
  if (text.includes('||')) return anyCompatibility(text.split('||').map(part => matchesModRange(part, version, dialect, depth + 1)));
  if (text.includes('&&')) return allCompatibility(text.split('&&').map(part => matchesModRange(part, version, dialect, depth + 1)));
  const tokens = text.replace(/(>=|<=|>|<|=|~|\^)\s+/g, '$1').split(/\s+/);
  return allCompatibility(tokens.map(token => predicate(dialect === 'quilt' && numeric(token) ? '^' + token : token, version)));
}
