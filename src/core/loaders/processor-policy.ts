import { requireMetadata } from '../version/validation.js';
import type { ControlledInstallerProcessor, InstallerLibrary, InstallerLoaderKind, InstallerProcessor,
  InstallerProcessorRole, InstallerProfile } from './types.js';

const ROLES: readonly InstallerProcessorRole[] = [
  'extract-mappings', 'download-mojang-mappings', 'merge-mappings',
  'split-client', 'rename-client', 'apply-client-patches',
];

const TOOL_PATTERNS: Record<InstallerLoaderKind, readonly RegExp[]> = {
  forge: [
    /^net\.minecraftforge:installertools:[A-Za-z0-9_.+-]+$/,
    /^net\.minecraftforge:installertools:[A-Za-z0-9_.+-]+$/,
    /^net\.minecraftforge:installertools:[A-Za-z0-9_.+-]+$/,
    /^net\.minecraftforge:jarsplitter:[A-Za-z0-9_.+-]+$/,
    /^net\.minecraftforge:ForgeAutoRenamingTool:[A-Za-z0-9_.+-]+:all$/,
    /^net\.minecraftforge:binarypatcher:[A-Za-z0-9_.+-]+$/,
  ],
  neoforge: [
    /^net\.neoforged\.installertools:installertools:[A-Za-z0-9_.+-]+$/,
    /^net\.neoforged\.installertools:installertools:[A-Za-z0-9_.+-]+$/,
    /^net\.neoforged\.installertools:installertools:[A-Za-z0-9_.+-]+$/,
    /^net\.neoforged\.installertools:jarsplitter:[A-Za-z0-9_.+-]+$/,
    /^net\.neoforged:AutoRenamingTool:[A-Za-z0-9_.+-]+:all$/,
    /^net\.neoforged\.installertools:binarypatcher:[A-Za-z0-9_.+-]+:fatjar$/,
  ],
};

function same(actual: readonly string[], expected: readonly string[]): boolean {
  return actual.length === expected.length && actual.every((value, index) => value === expected[index]);
}

function outputPolicy(kind: InstallerLoaderKind, index: number, outputs: Readonly<Record<string, string>>): boolean {
  const entries = Object.entries(outputs);
  if (kind === 'forge' && index === 3) return entries.length === 2
    && outputs['{MC_SLIM}'] === '{MC_SLIM_SHA}' && outputs['{MC_EXTRA}'] === '{MC_EXTRA_SHA}';
  return entries.length === 0;
}

function expectedArguments(kind: InstallerLoaderKind, minecraft: string, input: string): readonly (readonly string[])[] {
  return [
    ['--task', 'MCP_DATA', '--input', input, '--output', '{MAPPINGS}', '--key', 'mappings'],
    ['--task', 'DOWNLOAD_MOJMAPS', '--version', minecraft, '--side', '{SIDE}', '--output', '{MOJMAPS}'],
    ['--task', 'MERGE_MAPPING', '--left', '{MAPPINGS}', '--right', '{MOJMAPS}', '--output', '{MERGED_MAPPINGS}',
      '--classes', ...(kind === 'neoforge' ? ['--fields', '--methods'] : []), '--reverse-right'],
    ['--input', '{MINECRAFT_JAR}', '--slim', '{MC_SLIM}', '--extra', '{MC_EXTRA}', '--srg', '{MERGED_MAPPINGS}'],
    ['--input', '{MC_SLIM}', '--output', '{MC_SRG}', '--names', '{MERGED_MAPPINGS}',
      '--ann-fix', '--ids-fix', '--src-fix', '--record-fix'],
    ['--clean', '{MC_SRG}', '--output', '{PATCHED}', '--apply', '{BINPATCH}'],
  ];
}

function mappingInput(kind: InstallerLoaderKind, minecraft: string, processor: InstallerProcessor,
  libraries: readonly InstallerLibrary[]): string {
  const value = processor.arguments[3];
  requireMetadata(value !== undefined && /^\[[^\]]+@zip\]$/.test(value));
  const coordinate = value.slice(1, -1);
  const prefix = kind === 'forge' ? `de.oceanlabs.mcp:mcp_config:${minecraft}-` : `net.neoforged:neoform:${minecraft}-`;
  requireMetadata(coordinate.startsWith(prefix) && libraries.some(item => item.coordinate === coordinate));
  return value;
}

/** Turns inert installer declarations into the only six client processor shapes OUCL may execute. */
export function enforceInstallerProcessorPolicy(profile: InstallerProfile): ControlledInstallerProcessor[] {
  requireMetadata(profile.processors.length === ROLES.length);
  const input = mappingInput(profile.kind, profile.minecraftVersion, profile.processors[0]!, profile.libraries);
  const expected = expectedArguments(profile.kind, profile.minecraftVersion, input);
  return profile.processors.map((processor, index) => {
    requireMetadata(TOOL_PATTERNS[profile.kind][index]!.test(processor.tool)
      && same(processor.arguments, expected[index]!)
      && processor.classpath.length >= 1 && processor.classpath.length <= 32
      && new Set(processor.classpath).size === processor.classpath.length
      && outputPolicy(profile.kind, index, processor.outputs));
    return { ...processor, classpath: [...processor.classpath], arguments: [...processor.arguments],
      outputs: { ...processor.outputs }, role: ROLES[index]! };
  });
}
