/** Fixed mirror routes accelerate bytes only. Official metadata remains the trust anchor. */
export function bmclapiArtifactUrl(value: string): string | undefined {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash) return undefined;
  if (url.hostname === 'resources.download.minecraft.net') return `https://bmclapi2.bangbang93.com/assets${url.pathname}`;
  if (['libraries.minecraft.net', 'maven.fabricmc.net', 'maven.quiltmc.org', 'maven.minecraftforge.net'].includes(url.hostname)) return `https://bmclapi2.bangbang93.com/maven${url.pathname}`;
  if (['piston-data.mojang.com', 'launcher.mojang.com'].includes(url.hostname) && url.pathname.startsWith('/objects/')) return `https://bmclapi2.bangbang93.com${url.pathname}`;
  return undefined;
}
const MIRROR_HOSTS = ['bmclapi2.bangbang93.com', 'mirrors.cernet.edu.cn', 'mirrors.qlu.edu.cn'];
/** Unknown CDN nodes are refused and the caller may fall back to the original official URL. */
export function isMirrorArtifactUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return value.length <= 2048 && url.protocol === 'https:' && !url.username && !url.password && !url.port && !url.hash && !url.search
      && MIRROR_HOSTS.includes(url.hostname) && (url.hostname === 'bmclapi2.bangbang93.com'
        ? ['/maven/', '/assets/', '/objects/'].some(prefix => url.pathname.startsWith(prefix)) : url.pathname.startsWith('/bmclapi/'));
  } catch { return false; }
}
