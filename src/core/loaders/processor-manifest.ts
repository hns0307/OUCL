import { requireMetadata } from '../version/validation.js';
import type { InstallerLoaderKind, InstallerProcessorRole } from './types.js';

const MAIN_CLASSES: Record<InstallerLoaderKind, Readonly<Record<InstallerProcessorRole, string>>> = {
  forge: {
    'extract-mappings': 'net.minecraftforge.installertools.ConsoleTool',
    'download-mojang-mappings': 'net.minecraftforge.installertools.ConsoleTool',
    'merge-mappings': 'net.minecraftforge.installertools.ConsoleTool',
    'split-client': 'net.minecraftforge.jarsplitter.ConsoleTool',
    'rename-client': 'net.minecraftforge.fart.Main',
    'apply-client-patches': 'net.minecraftforge.binarypatcher.ConsoleTool',
  },
  neoforge: {
    'extract-mappings': 'net.neoforged.installertools.ConsoleTool',
    'download-mojang-mappings': 'net.neoforged.installertools.ConsoleTool',
    'merge-mappings': 'net.neoforged.installertools.ConsoleTool',
    'split-client': 'net.neoforged.jarsplitter.ConsoleTool',
    'rename-client': 'net.neoforged.art.Main',
    'apply-client-patches': 'net.neoforged.binarypatcher.ConsoleTool',
  },
};

/** Parses the main manifest section, including continuation lines, without trusting later named sections. */
export function parseProcessorMainClass(body: Buffer): string {
  requireMetadata(body.length >= 1 && body.length <= 64 * 1024 && !body.includes(0));
  let text: string; try { text = new TextDecoder('utf-8', { fatal: true }).decode(body); } catch { requireMetadata(false); }
  const logical: string[] = [];
  for (const line of text!.split(/\r?\n/)) {
    if (line === '') break;
    if (line.startsWith(' ')) { requireMetadata(logical.length > 0); logical[logical.length - 1] += line.slice(1); }
    else logical.push(line);
  }
  const values = logical.flatMap(line => {
    const separator = line.indexOf(': '); requireMetadata(separator >= 1);
    return line.slice(0, separator).toLowerCase() === 'main-class' ? [line.slice(separator + 2)] : [];
  });
  requireMetadata(values.length === 1 && /^[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)+$/.test(values[0]!));
  return values[0]!;
}

export function requireProcessorMainClass(kind: InstallerLoaderKind, role: InstallerProcessorRole, value: string): string {
  requireMetadata(value === MAIN_CLASSES[kind][role]); return value;
}
