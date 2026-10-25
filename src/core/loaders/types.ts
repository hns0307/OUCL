import type { VersionArgument } from '../version/types.js';

export type LoaderKind = 'fabric' | 'quilt' | 'forge' | 'neoforge';

export interface LoaderVersionSummary {
  kind: Extract<LoaderKind, 'fabric' | 'quilt'>;
  minecraftVersion: string;
  loaderVersion: string;
  loaderCoordinate: string;
  intermediaryCoordinate: string;
  stable: boolean;
}

export interface LoaderArtifact {
  coordinate: string;
  path: string;
  url: string;
  sha1?: string;
  size?: number;
  proof: 'inline-sha1' | 'official-sidecar-required';
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
