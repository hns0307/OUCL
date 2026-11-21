import { exactObject, UUID_PATTERN } from '../shared/contracts/handshake.js';
import { isSkinData, isSkinPayload, SkinContractError, skinFailure } from '../shared/contracts/skin.js';
import type { SkinChannel, SkinData, SkinPayload, SkinResult } from '../shared/contracts/skin.js';
import type { SkinService } from '../services/skin/service.js';

async function dispatch<C extends SkinChannel>(channel: C, input: SkinPayload[C], service: SkinService): Promise<SkinData[C]> {
  const methods: { [K in SkinChannel]: (payload: SkinPayload[K]) => Promise<SkinData[K]> } = {
    'skin:list': () => service.list(),
    'skin:discover': payload => service.discover(payload.url),
    'skin:addProvider': payload => service.addProvider(payload.discoveryId),
    'skin:removeProvider': async payload => { await service.removeProvider(payload.providerId); return {}; },
    'skin:login': payload => service.login(payload),
    'skin:selectRole': payload => service.selectRole(payload.loginId, payload.roleUuid),
    'skin:cancelLogin': async payload => { await service.cancelLogin(payload.loginId); return {}; },
    'skin:logout': payload => service.logout(payload.accountId),
    'skin:preview': payload => service.preview(payload.accountId),
    'skin:upload': payload => service.upload(payload),
    'skin:openSite': async payload => { await service.openSite(payload.providerId); return {}; },
  };
  return methods[channel](input);
}

/** Admits only the privileged launcher document and projects exact, secret-free responses. */
export async function handleSkin<C extends SkinChannel>(channel: C, input: unknown, trusted: boolean, traceId: string, service?: SkinService): Promise<SkinResult<C>> {
  const envelope = exactObject(input, ['contractVersion', 'requestId', 'payload']);
  const requestId = envelope && typeof input.requestId === 'string' && UUID_PATTERN.test(input.requestId) ? input.requestId : traceId;
  if (!trusted) return skinFailure(requestId, 'INVALID_SENDER', traceId);
  if (envelope && typeof input.contractVersion === 'number' && input.contractVersion > 1) return skinFailure(requestId, 'UNSUPPORTED_CONTRACT', traceId);
  if (!envelope || input.contractVersion !== 1 || typeof input.requestId !== 'string' || !UUID_PATTERN.test(input.requestId)
    || !isSkinPayload(input.payload, channel)) return skinFailure(requestId, 'INVALID_ARGUMENT', traceId);
  if (!service) return skinFailure(requestId, 'UNAVAILABLE', traceId);
  try {
    const data = await dispatch(channel, input.payload, service);
    return isSkinData(data, channel) ? { contractVersion: 1, requestId, ok: true, data } : skinFailure(requestId, 'UNAVAILABLE', traceId);
  } catch (error) {
    return skinFailure(requestId, error instanceof SkinContractError ? error.code : 'UNAVAILABLE', traceId);
  }
}
