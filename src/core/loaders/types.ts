import type { ClientVersion, Rule, VersionArgument } from '../version/types.js';

export type LoaderKind = 'fabric' | 'quilt' | 'forge' | 'neoforge';

export interface LoaderVersionSummary {
  kind: LoaderKind;
  minecraftVersion: string;
  loaderVersion: string;
  loaderCoordinate?: string;
  intermediaryCoordinate?: string;
  stable: boolean;
}

export interface LoaderArtifact {
  coordinate: string;
  path: string;
  url: string;
  sha1?: string;
  size?: number;
  proof: 'inline-sha1' | 'official-sidecar-required';
  rules?: Rule[];
}

export interface LoaderProfile {
  kind: Extract<LoaderKind, 'fabric' | 'quilt'>;
  minecraftVersion: string;
  loaderVersion: string;
  id: string;
  mainClass: string;
  arguments: { game: VersionArgument[]; jvm: VersionArgument[] };
  libraries: LoaderArtifact[];
}

export type InstallerLoaderKind = Extract<LoaderKind, 'forge' | 'neoforge'>;
export interface InstallerLibrary { coordinate: string; path: string; url: string; sha1: string; size: number }
export type InstallerDataValue = { kind: 'artifact'; coordinate: string; path: string }
  | { kind: 'embedded'; entry: string } | { kind: 'literal'; value: string };
export interface InstallerProcessor {
  tool: string;
  classpath: string[];
  arguments: string[];
  outputs: Record<string, string>;
}
export interface InstallerProfile {
  kind: InstallerLoaderKind;
  minecraftVersion: string;
  loaderVersion: string;
  version: ClientVersion;
  libraries: InstallerLibrary[];
  data: Record<string, InstallerDataValue>;
  processors: InstallerProcessor[];
}
