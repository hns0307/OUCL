import path from 'node:path';
import { enforceInstallerProcessorPolicy } from '../../core/loaders/processor-policy.js';
import { requireProcessorMainClass } from '../../core/loaders/processor-manifest.js';
import type { InstallerDataValue, InstallerProfile, InstallerProcessorRole } from '../../core/loaders/types.js';

export type ProcessorPlanCode = 'INVALID_PROCESSOR_PLAN' | 'UNTRUSTED_PROCESSOR';
export class ProcessorPlanError extends Error {
  readonly category = 'validation' as const;
  constructor(readonly code: ProcessorPlanCode) { super(code); this.name = 'ProcessorPlanError'; }
}
export interface ProcessorOutputPlan { file: string; expectedSha1?: string }
export interface ProcessorCommandPlan {
  role: InstallerProcessorRole; tool: string; mainClass: string; classpath: string[]; arguments: string[]; outputs: ProcessorOutputPlan[];
}
export interface InstallerProcessorPlan { workspace: string; commands: ProcessorCommandPlan[] }
export interface ProcessorPlanInputs {
  workspace: string; installerFile: string; minecraftJar: string; mainClasses: Readonly<Record<string, string>>;
}

const OUTPUTS: Readonly<Record<InstallerProcessorRole, readonly string[]>> = {
  'extract-mappings': ['MAPPINGS'], 'download-mojang-mappings': ['MOJMAPS'], 'merge-mappings': ['MERGED_MAPPINGS'],
  'split-client': ['MC_SLIM', 'MC_EXTRA'], 'rename-client': ['MC_SRG'], 'apply-client-patches': ['PATCHED'],
};
const fail = (code: ProcessorPlanCode = 'INVALID_PROCESSOR_PLAN'): never => { throw new ProcessorPlanError(code); };

function absolute(value: string): string {
  if (typeof value !== 'string' || value.length > 32760 || value.includes('\0') || !path.isAbsolute(value)) return fail();
  return path.resolve(value);
}
function inside(root: string, value: string): string {
  const target = absolute(value); const relative = path.relative(root, target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return fail();
  return target;
}
function libraryPath(workspace: string, relative: string): string { return inside(workspace, path.join(workspace, 'libraries', ...relative.split('/'))); }

function dataValue(workspace: string, value: InstallerDataValue): string {
  if (value.kind === 'artifact') return libraryPath(workspace, value.path);
  if (value.kind === 'embedded') return inside(workspace, path.join(workspace, 'installer', ...value.entry.split('/')));
  return value.value;
}

/** Expands a policy-approved profile into path-safe, shell-free Java commands inside one private workspace. */
export function planInstallerProcessors(profile: InstallerProfile, input: ProcessorPlanInputs): InstallerProcessorPlan {
  const workspace = absolute(input.workspace); const installerFile = inside(workspace, input.installerFile); const minecraftJar = absolute(input.minecraftJar);
  const processors = enforceInstallerProcessorPolicy(profile);
  const libraries = new Map(profile.libraries.map(item => [item.coordinate, libraryPath(workspace, item.path)]));
  const values = new Map<string, string>([['SIDE', 'client'], ['MINECRAFT_JAR', minecraftJar], ['INSTALLER', installerFile], ['ROOT', workspace]]);
  for (const [key, value] of Object.entries(profile.data)) values.set(key, dataValue(workspace, value));
  const expand = (value: string): string => {
    const artifact = /^\[([^\]]+)\]$/.exec(value);
    if (artifact) return libraries.get(artifact[1]!) ?? fail();
    let unknown = false;
    const result = value.replace(/\{([A-Z][A-Z0-9_]{0,63})\}/g, (_whole, key: string) => {
      const replacement = values.get(key); if (replacement === undefined) { unknown = true; return ''; } return replacement;
    });
    if (unknown || /\{[A-Z][A-Z0-9_]{0,63}\}/.test(result) || result.includes('\0')) return fail();
    return result;
  };
  const commands = processors.map(processor => {
    const mainClass = input.mainClasses[processor.tool];
    if (mainClass === undefined) return fail('UNTRUSTED_PROCESSOR');
    try { requireProcessorMainClass(profile.kind, processor.role, mainClass); } catch { return fail('UNTRUSTED_PROCESSOR'); }
    const tool = libraries.get(processor.tool); if (tool === undefined) return fail();
    const classpath = [...new Set([...processor.classpath, processor.tool])].map(coordinate => libraries.get(coordinate) ?? fail());
    const outputs = OUTPUTS[processor.role].map(key => {
      const file = values.get(key); if (file === undefined) return fail();
      inside(workspace, file);
      const proof = values.get(`${key}_SHA`);
      if (proof !== undefined && !/^[a-f0-9]{40}$/.test(proof)) return fail();
      return { file, ...(proof === undefined ? {} : { expectedSha1: proof }) };
    });
    return { role: processor.role, tool, mainClass, classpath, arguments: processor.arguments.map(expand), outputs };
  });
  return { workspace, commands };
}
