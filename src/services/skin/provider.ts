import { createPublicKey, randomUUID, verify } from 'node:crypto';
import { crc32 } from 'node:zlib';
import { SKIN_MAX_PNG_BYTES, SkinContractError } from '../../shared/contracts/skin.js';
import type { SkinModel, SkinPreview, SkinProvider, SkinRole } from '../../shared/contracts/skin.js';
import { readSkinResource, skinHttpsUrl } from './http.js';
import type { SkinHttpResponse, SkinTransport } from './http.js';

const ALI = 'x-authlib-injector-api-location';
const METADATA_BYTES = 6144;
const JSON_BYTES = 128 * 1024;
const DOMAIN = /^\.?[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i;
const TOKEN = /^[a-z0-9._~+/-]+={0,2}$/i;
const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
export interface StoredSkinProvider extends SkinProvider { metadata: string }
export interface SkinCredentials { accessToken: string; clientToken: string }
export interface SkinAuthentication extends SkinCredentials { roles: SkinRole[]; selected?: SkinRole }

function object(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
function json(bytes: Buffer): unknown { return JSON.parse(bytes.toString('utf8')) as unknown; }
function plain(value: unknown, maximum: number): value is string {
  return typeof value === 'string' && value.length <= maximum && value.length > 0 && !/[\p{C}]/u.test(value);
}
function uuid(value: unknown): string | undefined {
  if (typeof value !== 'string' || !/^[a-f0-9]{32}$|^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value)) return;
  const hex = value.toLowerCase().replaceAll('-', '');
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-');
}
function role(input: unknown): SkinRole | undefined {
  const value = object(input);
  const id = uuid(value?.id);
  return id && plain(value?.name, 80) ? { uuid: id, gameName: value.name } : undefined;
}

/** Checks bounded token material before accepting it from a provider or decrypting a stored record. */
export function credentials(input: unknown): SkinCredentials {
  const value = object(input);
  if (!plain(value?.accessToken, 4096) || !plain(value.clientToken, 128) || !TOKEN.test(value.accessToken) || !TOKEN.test(value.clientToken))
    throw new SkinContractError('AUTH_FAILED');
  return { accessToken: value.accessToken, clientToken: value.clientToken };
}
function metadata(value: string) {
  try {
    if (Buffer.byteLength(value) > METADATA_BYTES) return;
    const document = object(JSON.parse(value));
    const domains: unknown = document?.skinDomains;
    if (typeof document?.signaturePublickey !== 'string' || document.signaturePublickey.length > 4096
      || !Array.isArray(domains) || domains.length > 64 || !domains.every(item => typeof item === 'string' && item.length <= 253 && DOMAIN.test(item))) return;
    const key = createPublicKey(document.signaturePublickey);
    if (key.asymmetricKeyType !== 'rsa' || (key.asymmetricKeyDetails?.modulusLength ?? 0) < 2048) return;
    return { meta: object(document.meta), domains: domains as string[], key };
  } catch { return; }
}
function rootOf(url: URL): URL {
  url.search = '';
  if (!url.pathname.endsWith('/')) url.pathname += '/';
  return url;
}
function admittedHomepage(meta: Record<string, unknown> | undefined, entered: URL, api: URL): string {
  const candidate = object(meta?.links)?.homepage;
  if (plain(candidate, 2048)) {
    try {
      const homepage = skinHttpsUrl(candidate, entered);
      if (homepage.origin === entered.origin || homepage.origin === api.origin) return homepage.href;
    } catch { /* Only the known site origin is used as fallback. */ }
  }
  return entered.origin + '/';
}

/** Discovers an ALI-advertised endpoint, a pasted API root, or the Blessing Skin default mount. */
export async function discoverSkinProvider(send: SkinTransport, input: string, signal: AbortSignal): Promise<StoredSkinProvider> {
  const entered = skinHttpsUrl(input.trim());
  const candidates = [entered, new URL('/api/yggdrasil/', entered)];
  const visited = new Set<string>();
  while (candidates.length && visited.size < 5) {
    const candidate = candidates.shift()!;
    if (visited.has(candidate.href)) continue;
    visited.add(candidate.href);
    const { response, url } = await readSkinResource(send, candidate, { limit: 1024 * 1024, signal, stopAtAli: true });
    const location = response.headers.get(ALI);
    if (location) {
      const target = rootOf(skinHttpsUrl(location, url));
      if (target.href !== rootOf(new URL(url)).href) { candidates.unshift(target); continue; }
    }
    if (response.status < 200 || response.status >= 300 || response.body.length > METADATA_BYTES) continue;
    const text = response.body.toString('utf8');
    const details = metadata(text);
    if (!details) continue;
    const api = rootOf(url);
    if (api.href.length > 2048) throw new SkinContractError('INVALID_URL');
    const name = plain(details.meta?.serverName, 100) ? details.meta.serverName : api.hostname;
    if (!plain(name, 100)) throw new SkinContractError('INCOMPATIBLE_PROVIDER');
    return { providerId: randomUUID(), name, apiRoot: api.href, homepage: admittedHomepage(details.meta, entered, api), metadata: text,
      adapter: details.meta?.implementationName === 'Yggdrasil API for Blessing Skin' ? 'blessing' : 'yggdrasil',
      loginByName: details.meta?.['feature.non_email_login'] === true };
  }
  throw new SkinContractError('INCOMPATIBLE_PROVIDER');
}

async function auth(send: SkinTransport, provider: StoredSkinProvider, action: string, data: object, signal: AbortSignal): Promise<SkinHttpResponse> {
  return send(new URL('authserver/' + action, provider.apiRoot), {
    method: 'POST', limit: JSON_BYTES, signal, headers: { 'content-type': 'application/json', accept: 'application/json' }, body: Buffer.from(JSON.stringify(data)),
  });
}
function authResponse(response: SkinHttpResponse, clientToken: string, error: 'AUTH_FAILED' | 'AUTH_EXPIRED'): SkinAuthentication {
  if (response.status !== 200) {
    throw new SkinContractError(response.status === 400 || response.status === 401 || response.status === 403 ? error : 'NETWORK_FAILED');
  }
  try {
    const document = object(json(response.body));
    const token = credentials(document);
    if (token.clientToken !== clientToken) throw new Error('Mismatched client token');
    const selected = role(document?.selectedProfile);
    const available = document?.availableProfiles ?? [];
    if (!Array.isArray(available) || available.length > 64 || document?.selectedProfile && !selected) throw new Error('Invalid profiles');
    const unique = new Map<string, SkinRole>();
    for (const item of available) {
      const current = role(item);
      if (!current) throw new Error('Invalid role');
      unique.set(current.uuid, current);
    }
    if (selected) unique.set(selected.uuid, selected);
    return { ...token, roles: [...unique.values()], ...(selected ? { selected } : {}) };
  } catch { throw new SkinContractError(error); }
}

/** Posts one credential-bearing request directly to the confirmed authentication origin. */
export async function authenticateSkin(send: SkinTransport, provider: StoredSkinProvider, username: string, password: string, signal: AbortSignal): Promise<SkinAuthentication> {
  const clientToken = randomUUID();
  return authResponse(await auth(send, provider, 'authenticate', {
    agent: { name: 'Minecraft', version: 1 }, username, password, clientToken,
  }, signal), clientToken, 'AUTH_FAILED');
}

/** Binds an unselected credential or rotates one credential while checking the returned role. */
export async function refreshSkin(send: SkinTransport, provider: StoredSkinProvider, token: SkinCredentials,
  signal: AbortSignal, selected?: SkinRole): Promise<SkinAuthentication> {
  return authResponse(await auth(send, provider, 'refresh', {
    accessToken: token.accessToken, clientToken: token.clientToken,
    ...(selected ? { selectedProfile: { id: selected.uuid.replaceAll('-', ''), name: selected.gameName } } : {}),
  }, signal), token.clientToken, 'AUTH_EXPIRED');
}

/** Separates a rejected token from a temporarily unavailable service. */
export async function validateSkin(send: SkinTransport, provider: StoredSkinProvider, token: SkinCredentials, signal: AbortSignal): Promise<boolean> {
  const { status } = await auth(send, provider, 'validate', { accessToken: token.accessToken, clientToken: token.clientToken }, signal);
  if (status === 204) return true;
  if (status === 400 || status === 401 || status === 403) return false;
  throw new SkinContractError('NETWORK_FAILED');
}

/** Revokes this one role credential without asking for or storing the provider password. */
export async function revokeSkin(send: SkinTransport, provider: StoredSkinProvider, token: SkinCredentials, signal: AbortSignal): Promise<boolean> {
  return (await auth(send, provider, 'invalidate', { accessToken: token.accessToken, clientToken: token.clientToken }, signal)).status === 204;
}

function textureHost(url: URL, domains: string[]): boolean {
  const host = url.hostname.toLowerCase();
  return [...domains, '.minecraft.net', '.mojang.com'].some(pattern => pattern[0] === '.'
    ? host.endsWith(pattern.toLowerCase()) : host === pattern.toLowerCase());
}

/** Validates the complete bounded PNG container and geometry before upload or browser decoding. */
export function validateSkinPng(bytes: Buffer, type: 'skin' | 'cape', model: SkinModel = 'default'): void {
  const invalid = () => new SkinContractError('INVALID_TEXTURE');
  if (bytes.length < 45 || bytes.length > SKIN_MAX_PNG_BYTES || !bytes.subarray(0, 8).equals(PNG)
    || bytes.readUInt32BE(8) !== 13 || bytes.toString('ascii', 12, 16) !== 'IHDR') throw invalid();
  const width = bytes.readUInt32BE(16); const height = bytes.readUInt32BE(20);
  if (width === 0 || height === 0 || width > 1024 || height > 1024 || (type === 'skin'
    ? width % 64 !== 0 || height !== width && (height * 2 !== width || model === 'slim')
    : height * 2 !== width)) throw invalid();
  let offset = 8; let hasPixels = false; let chunks = 0;
  while (offset + 12 <= bytes.length && chunks++ < 1024) {
    const length = bytes.readUInt32BE(offset);
    const end = offset + length + 12;
    if (end > bytes.length) throw invalid();
    const name = bytes.toString('ascii', offset + 4, offset + 8);
    if (crc32(bytes.subarray(offset + 4, end - 4)) !== bytes.readUInt32BE(end - 4)) throw invalid();
    if (name === 'IDAT' && length > 0) hasPixels = true;
    if (name === 'IEND' && length === 0 && hasPixels && end === bytes.length) return;
    offset = end;
  }
  throw invalid();
}

async function previewTexture(send: SkinTransport, texture: Record<string, unknown> | undefined, type: 'skin' | 'cape',
  model: SkinModel, domains: string[], signal: AbortSignal): Promise<string | undefined> {
  if (!texture) return;
  if (!plain(texture.url, 2048) || !/^https:\/\//i.test(texture.url)) throw new SkinContractError('INVALID_TEXTURE');
  const url = skinHttpsUrl(texture.url);
  const { response } = await readSkinResource(send, url, { limit: SKIN_MAX_PNG_BYTES, signal }, target => textureHost(target, domains));
  if (response.status !== 200 || response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !== 'image/png') throw new SkinContractError('INVALID_TEXTURE');
  validateSkinPng(response.body, type, model);
  return 'data:image/png;base64,' + response.body.toString('base64');
}

async function getSkinProfile(send: SkinTransport, provider: StoredSkinProvider, profile: SkinRole, signal: AbortSignal) {
  const proof = metadata(provider.metadata);
  if (!proof) throw new SkinContractError('INCOMPATIBLE_PROVIDER');
  const response = await send(new URL('sessionserver/session/minecraft/profile/' + profile.uuid.replaceAll('-', '') + '?unsigned=false', provider.apiRoot),
    { limit: JSON_BYTES, signal, headers: { accept: 'application/json' } });
  if (response.status === 204 || response.status === 404) throw new SkinContractError('NOT_FOUND');
  if (response.status !== 200) throw new SkinContractError('NETWORK_FAILED');
  let model: SkinModel = 'default'; let uploadSkin = false;
  let skin: Record<string, unknown> | undefined; let cape: Record<string, unknown> | undefined;
  try {
    const document = object(json(response.body));
    const properties = document?.properties ?? [];
    if (role(document)?.uuid !== profile.uuid || !Array.isArray(properties) || properties.length > 32)
      throw new Error('Wrong profile');
    for (const entry of properties) {
      const item = object(entry);
      if (item?.name === 'uploadableTextures' && plain(item.value, 64)) uploadSkin = item.value.split(',').map(kind => kind.trim()).includes('skin');
      if (item?.name !== 'textures') continue;
      if (!plain(item.value, 16384) || !plain(item.signature, 4096)
        || !verify('RSA-SHA1', Buffer.from(item.value), proof.key, Buffer.from(item.signature, 'base64'))) throw new Error('Invalid texture signature');
      const descriptors = object(json(Buffer.from(item.value, 'base64')));
      if (uuid(descriptors?.profileId) !== profile.uuid) throw new Error('Wrong texture identity');
      const textures = object(descriptors?.textures);
      skin = object(textures?.SKIN); cape = object(textures?.CAPE);
      model = object(skin?.metadata)?.model === 'slim' ? 'slim' : 'default';
    }
  } catch { throw new SkinContractError('INVALID_TEXTURE'); }
  return { model, uploadSkin, skin, cape, domains: proof.domains };
}

/** Checks native upload capabilities without downloading the previously applied textures. */
export async function skinProfileCanUpload(send: SkinTransport, provider: StoredSkinProvider, profile: SkinRole, signal: AbortSignal): Promise<boolean> {
  return (await getSkinProfile(send, provider, profile, signal)).uploadSkin;
}

/** Loads signed, role-bound textures and exposes only verified image bytes and capability flags. */
export async function skinProfile(send: SkinTransport, provider: StoredSkinProvider, profile: SkinRole, signal: AbortSignal): Promise<SkinPreview> {
  const { model, uploadSkin, skin, cape, domains } = await getSkinProfile(send, provider, profile, signal);
  const [skinImage, capeImage] = await Promise.all([
    previewTexture(send, skin, 'skin', model, domains, signal), previewTexture(send, cape, 'cape', model, domains, signal),
  ]);
  return { model, uploadSkin, ...(skinImage ? { skin: skinImage } : {}), ...(capeImage ? { cape: capeImage } : {}) };
}

/** Uses the standard signed-in Yggdrasil multipart endpoint to upload and equip a PNG. */
export async function uploadSkin(send: SkinTransport, provider: StoredSkinProvider, profile: SkinRole,
  token: SkinCredentials, png: Uint8Array, model: SkinModel, signal: AbortSignal): Promise<void> {
  const file = Buffer.from(png);
  validateSkinPng(file, 'skin', model);
  const boundary = 'OUCL-' + randomUUID();
  const body = Buffer.concat([
    Buffer.from('--' + boundary + '\r\nContent-Disposition: form-data; name="model"\r\n\r\n' + (model === 'slim' ? 'slim' : '') + '\r\n'
      + '--' + boundary + '\r\nContent-Disposition: form-data; name="file"; filename="skin.png"\r\nContent-Type: image/png\r\n\r\n'),
    file, Buffer.from('\r\n--' + boundary + '--\r\n'),
  ]);
  const response = await send(new URL('api/user/profile/' + profile.uuid.replaceAll('-', '') + '/skin', provider.apiRoot), {
    method: 'PUT', limit: JSON_BYTES, signal, body, headers: { authorization: 'Bearer ' + token.accessToken,
      'content-type': 'multipart/form-data; boundary=' + boundary, 'content-length': String(body.length) },
  });
  if (response.status === 401) throw new SkinContractError('AUTH_EXPIRED');
  if (response.status !== 204) throw new SkinContractError(response.status >= 400 && response.status < 500 ? 'UPLOAD_REJECTED' : 'NETWORK_FAILED');
}

/** Validates persisted metadata independently of the file projection. */
export function validSkinMetadata(value: string): boolean { return metadata(value) !== undefined; }
