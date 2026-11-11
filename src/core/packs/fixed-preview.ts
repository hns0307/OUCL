/** Facts from the one reviewed P-E sample. They do not authorize an install. */
export const FIXED_PACK_SHA256 = 'e4cf7d5607a70582cfcec200a381892a83c75e122f5be6bad926de23ff7278f2';
export const FIXED_PACK_SIZE = 1355;
export const FIXED_CONFIG_SHA256 = '9df1c49a83b3c3caf03c6fbb8abc44dda9d191e0fa01161aacff385174f900c3';
export interface FixedPackPreview {
  formatVersion: 1; status: 'unknown'; reason: 'ENVIRONMENT_AND_MOD_NOT_VERIFIED';
  archive: { sha256: string; size: number; entries: number; expandedBytes: number };
  target: { minecraft: '1.20.1'; loader: 'forge'; loaderVersion: '47.4.28'; javaMajor: 17; isolated: true };
  file: { projectId: 'uXXizFIs'; versionId: 'DG5Fn9Sz'; size: 123034; sha1: string; sha512: string };
  override: { path: 'config/oucl-pe-smoke.properties'; size: 14; sha256: string; layer: 'client-overrides' };
}
/** Projects already validated fixed-sample facts; unknown cannot authorize confirmation. */
export function fixedPackPreview(expandedBytes: number): FixedPackPreview {
  if (expandedBytes !== 889) throw new Error('INVALID_FIXED_SAMPLE');
  return { formatVersion: 1, status: 'unknown', reason: 'ENVIRONMENT_AND_MOD_NOT_VERIFIED',
    archive: { sha256: FIXED_PACK_SHA256, size: FIXED_PACK_SIZE, entries: 3, expandedBytes },
    target: { minecraft: '1.20.1', loader: 'forge', loaderVersion: '47.4.28', javaMajor: 17, isolated: true },
    file: { projectId: 'uXXizFIs', versionId: 'DG5Fn9Sz', size: 123034,
      sha1: '417fb6ce8f52abf40bd9d0390371790f9576f8ba',
      sha512: 'a1960a7c03dc32d4ccaccaf28afdd9b078758bbd62d15a91d4039a83fa9397a098e89b69591f6bd5190254d9ee97e502504154b9aec764adb8c65f000b75ba2c' },
    override: { path: 'config/oucl-pe-smoke.properties', size: 14, sha256: FIXED_CONFIG_SHA256, layer: 'client-overrides' } };
}
