import { modText } from './declarations.js';

/** Reads only one unambiguous main-section Implementation-Version; later entry sections cannot override it. */
export function modManifestVersion(body: string | undefined): string | null {
  if (body === undefined || body.length > 64 * 1024 || body.includes('\0')) return null;
  const lines: string[] = [];
  for (const line of body.split(/\r\n|\n|\r/)) {
    if (!line) break;
    if (line.startsWith(' ')) {
      if (!lines.length) return null;
      lines[lines.length - 1] += line.slice(1);
    } else lines.push(line);
  }
  const attributes = new Map<string, string>();
  for (const line of lines) {
    const separator = line.indexOf(': '); if (separator < 1) return null;
    const key = line.slice(0, separator).toLowerCase();
    if (!/^[a-z0-9][a-z0-9_-]{0,69}$/.test(key) || attributes.has(key)) return null;
    attributes.set(key, line.slice(separator + 2));
  }
  const version = attributes.get('implementation-version');
  return modText(version) && !version.includes('${') ? version : null;
}
