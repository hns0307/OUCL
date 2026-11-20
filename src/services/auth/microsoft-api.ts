
export class MicrosoftError extends Error {
  constructor(readonly code: 'UNCONFIGURED' | 'CANCELLED' | 'BUSY' | 'SIGN_IN' | 'REAUTH'
    | 'NO_LICENSE' | 'NO_PROFILE' | 'ACCESS_DENIED' | 'NETWORK' | 'STORAGE' | 'NOT_FOUND') {
    super(code);
    this.name = 'MicrosoftError';
  }
}

export type JavaEntitlement = 'owned' | 'playable' | 'none';
export interface MinecraftProfile {
  uuid: string;
  gameName: string;
  skin?: { url: string; model: 'classic' | 'slim' };
  cape?: string;
}
export interface MinecraftLicense {
  entitlement: JavaEntitlement;
  profile?: MinecraftProfile;
  accessToken: string;
  expiresAt: number;
  xuid?: string;
}

const USER_AUTH = 'https://user.auth.xboxlive.com/user/authenticate';
const XSTS = 'https://xsts.auth.xboxlive.com/xsts/authorize';
const MINECRAFT = 'https://api.minecraftservices.com';
const MAX_RESPONSE = 512 * 1024;

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new MicrosoftError('NETWORK');
  return value as Record<string, unknown>;
}
function token(value: unknown): string {
  if (typeof value !== 'string' || !/^[!-~]{8,16384}$/.test(value)) throw new MicrosoftError('NETWORK');
  return value;
}

async function json(response: Response): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new MicrosoftError('NETWORK');
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let size = 0;
  let result = '';
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) return JSON.parse(result + decoder.decode()) as unknown;
      size += chunk.value.byteLength;
      if (size > MAX_RESPONSE) throw new MicrosoftError('NETWORK');
      result += decoder.decode(chunk.value, { stream: true });
    }
  } catch {
    await reader.cancel().catch(() => {});
    throw new MicrosoftError('NETWORK');
  } finally {
    reader.releaseLock();
  }
}

function claims(value: unknown): { access: string; hash: string; xuid?: string } {
  const body = record(value);
  const display = record(body.DisplayClaims);
  if (!Array.isArray(display.xui) || display.xui.length !== 1) throw new MicrosoftError('NETWORK');
  const user = record(display.xui[0]);
  const hash = user.uhs;
  const xuid = user.xid;
  if (typeof hash !== 'string' || !/^\d{1,32}$/.test(hash)) throw new MicrosoftError('NETWORK');
  return { access: token(body.Token), hash, ...(typeof xuid === 'string' && /^\d{1,32}$/.test(xuid) ? { xuid } : {}) };
}

/** Keeps official texture origins out of the browser Session and normalizes the legacy HTTP spelling. */
export function officialTexture(input: unknown): string | undefined {
  if (typeof input !== 'string' || input.length > 256) return;
  try {
    const url = new URL(input);
    if (!['https:', 'http:'].includes(url.protocol) || url.hostname !== 'textures.minecraft.net' || url.port || url.username || url.password
      || url.search || url.hash || !/^\/texture\/[a-f\d]{32,128}$/i.test(url.pathname)) return;
    url.protocol = 'https:';
    return url.href;
  } catch { return; }
}

/** Projects only the active texture and the Java identity needed by OUCL. */
export function readJavaProfile(value: unknown): MinecraftProfile {
  const body = record(value);
  if (typeof body.id !== 'string' || !/^[a-f\d]{32}$/i.test(body.id)
    || typeof body.name !== 'string' || !/^[A-Za-z0-9_]{3,16}$/.test(body.name)) throw new MicrosoftError('NO_PROFILE');
  const id = body.id.toLowerCase();
  const uuid = [id.slice(0, 8), id.slice(8, 12), id.slice(12, 16), id.slice(16, 20), id.slice(20)].join('-');
  const active = (list: unknown): Record<string, unknown> | undefined => Array.isArray(list)
    ? list.slice(0, 128).filter((item: unknown) => item && typeof item === 'object').map(record).find(item => item.state === 'ACTIVE') : undefined;
  const skin = active(body.skins);
  const skinUrl = officialTexture(skin?.url);
  const cape = officialTexture(active(body.capes)?.url);
  return { uuid, gameName: body.name, ...(skinUrl ? { skin: { url: skinUrl, model: skin?.variant === 'SLIM' ? 'slim' : 'classic' } } : {}), ...(cape ? { cape } : {}) };
}

/** A successful Microsoft or Xbox response does not supply either Java ownership or a Java profile. */
export function readJavaLicense(value: unknown): JavaEntitlement {
  const data = record(value);
  if (!Array.isArray(data.items) || data.items.length > 1024) throw new MicrosoftError('NETWORK');
  const products = new Set(data.items.map((entry: unknown) => {
    const name = record(entry).name;
    if (typeof name !== 'string') throw new MicrosoftError('NETWORK');
    return name;
  }));
  if (products.has('product_minecraft')) return 'owned';
  return products.has('game_minecraft') ? 'playable' : 'none';
}

/** Uses official services with separate tokens for each step, over a bounded cookieless transport. */
export class MicrosoftMinecraftApi {
  constructor(private readonly fetcher: typeof fetch) {}

  private async send(url: string, request: RequestInit, signal: AbortSignal, profile = false): Promise<unknown> {
    const deadline = AbortSignal.any([signal, AbortSignal.timeout(15_000)]);
    try {
      const response = await this.fetcher(url, { ...request, signal: deadline, redirect: 'error' });
      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        if (response.status === 404 && profile) return undefined;
        if (response.status === 401 || response.status === 403) throw new MicrosoftError('ACCESS_DENIED');
        throw new MicrosoftError('NETWORK');
      }
      return await json(response);
    } catch (error) {
      if (signal.aborted) throw new MicrosoftError('CANCELLED');
      throw error instanceof MicrosoftError ? error : new MicrosoftError('NETWORK');
    }
  }

  async exchange(microsoftToken: string, requestId: string, signal: AbortSignal): Promise<MinecraftLicense> {
    const post = (body: object, xbox = false): RequestInit => ({
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json', ...(xbox ? { 'x-xbl-contract-version': '1' } : {}) },
      body: JSON.stringify(body),
    });
    const user = claims(await this.send(USER_AUTH, post({
      Properties: { AuthMethod: 'RPS', SiteName: 'user.auth.xboxlive.com', RpsTicket: 'd=' + token(microsoftToken) },
      RelyingParty: 'http://auth.xboxlive.com',
      TokenType: 'JWT',
    }, true), signal));
    const xsts = claims(await this.send(XSTS, post({
      Properties: { SandboxId: 'RETAIL', UserTokens: [user.access] },
      RelyingParty: 'rp://api.minecraftservices.com/',
      TokenType: 'JWT',
    }, true), signal));
    if (xsts.hash !== user.hash) throw new MicrosoftError('ACCESS_DENIED');
    const body = record(await this.send(MINECRAFT + '/launcher/login', post({
      xtoken: 'XBL3.0 x=' + xsts.hash + ';' + xsts.access,
      platform: 'PC_LAUNCHER',
    }), signal));
    const accessToken = token(body.access_token);
    const lifetime = body.expires_in;
    if (typeof lifetime !== 'number' || !Number.isSafeInteger(lifetime) || lifetime < 1 || lifetime > 86400 * 7) throw new MicrosoftError('NETWORK');
    const expiresAt = Date.now() + lifetime * 1000;
    const bearer = { headers: { 'accept': 'application/json', 'authorization': 'Bearer ' + accessToken } };
    const entitlement = readJavaLicense(await this.send(MINECRAFT + '/entitlements/license?requestId=' + encodeURIComponent(requestId), bearer, signal));
    const profile = await this.send(MINECRAFT + '/minecraft/profile', bearer, signal, true);
    return { entitlement, accessToken, expiresAt, ...(profile === undefined ? {} : { profile: readJavaProfile(profile) }), ...(xsts.xuid ? { xuid: xsts.xuid } : {}) };
  }
}
