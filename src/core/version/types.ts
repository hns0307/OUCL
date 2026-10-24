export interface DownloadArtifact { url: string; sha1: string; size: number; path?: string }
export interface Rule { action: 'allow' | 'disallow'; os?: { name?: string; arch?: string; version?: string }; features?: Record<string, boolean> }
export type VersionArgument = string | { rules: Rule[]; value: string | string[] };
export interface VersionLibrary {
  name: string;
  downloads?: { artifact?: DownloadArtifact; classifiers?: Record<string, DownloadArtifact> };
  rules?: Rule[];
  natives?: Record<string, string>;
  extract?: { exclude: string[] };
}
export interface AssetIndex extends DownloadArtifact { id: string }
export interface ClientVersion {
  id: string;
  inheritsFrom?: string;
  mainClass?: string;
  type?: string;
  assets?: string;
  assetIndex?: AssetIndex;
  javaVersion?: { majorVersion: number };
  downloads?: { client?: DownloadArtifact };
  libraries?: VersionLibrary[];
  arguments?: { game?: VersionArgument[]; jvm?: VersionArgument[] };
  minecraftArguments?: string;
}
export interface VersionEnvironment { os: 'windows' | 'linux' | 'osx'; arch: 'x64' | 'x86'; osVersion: string; features: Readonly<Record<string, boolean>> }
export interface ResolvedLibrary {
  name: string;
  artifact?: DownloadArtifact;
  native?: DownloadArtifact;
  nativeClassifier?: string;
  nativeExcludes: string[];
}
export interface ResolvedClientVersion {
  id: string;
  ancestry: string[];
  mainClass: string;
  type: string;
  javaMajor: number;
  client: DownloadArtifact;
  jarVersionId: string;
  assetIndex?: AssetIndex;
  assets?: string;
  libraries: ResolvedLibrary[];
  gameArguments: string[];
  jvmArguments: string[];
}
