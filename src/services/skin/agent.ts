import { createHash } from 'node:crypto';
import path from 'node:path';
import { SkinContractError } from '../../shared/contracts/skin.js';
import { guardDirectory, readRegular } from '../storage/files.js';
import { readSkinResource } from './http.js';
import type { SkinTransport } from './http.js';
import { saveSkinFile } from './records.js';

const AGENT = 'authlib-injector-1.2.8.jar';
const LIMIT = 1024 * 1024;
const SHA256 = '9c7f4343e6c82034958ffb48c14a2cb0c85928be7283103ce17da00c6d5a7b10';
const SOURCE = new URL('https://github.com/yushijinhun/authlib-injector/releases/download/v1.2.8/' + AGENT);
const ALLOWED = new Set(['github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com']);
const valid = (bytes: Buffer | undefined): boolean => !!bytes && createHash('sha256').update(bytes).digest('hex') === SHA256;

/** Admits precisely the upstream release bytes and rehashes an existing cached agent. */
export async function resolveSkinAgent(directory: string, send: SkinTransport, signal: AbortSignal): Promise<string> {
  try {
    const parent = await guardDirectory(directory);
    const file = path.join(parent, AGENT);
    if (/[=\p{C}]/u.test(file)) throw new SkinContractError('AGENT_UNAVAILABLE');
    if (valid(await readRegular(file, LIMIT))) return file;
    const { response } = await readSkinResource(send, SOURCE, { limit: LIMIT, signal }, url => ALLOWED.has(url.hostname));
    if (response.status !== 200 || !valid(response.body)) throw new SkinContractError('AGENT_UNAVAILABLE');
    signal.throwIfAborted();
    await saveSkinFile(parent, AGENT, response.body);
    if (!valid(await readRegular(file, LIMIT))) throw new SkinContractError('AGENT_UNAVAILABLE');
    return file;
  } catch {
    throw new SkinContractError(signal.aborted ? 'CANCELLED' : 'AGENT_UNAVAILABLE');
  }
}

/** Rechecks the exact service-owned Agent path and digest without any network request. */
export async function verifySkinAgent(directory: string, file: string): Promise<boolean> {
  try {
    const expected = path.join(await guardDirectory(directory), AGENT);
    return file === expected && valid(await readRegular(expected, LIMIT));
  } catch { return false; }
}
