import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DEFAULT_APPEARANCE, isAppearance, isDesktopData, isDesktopPayload, isDesktopResult, isForumDraft } from '../src/shared/contracts/desktop.js';
import { DesktopService } from '../src/services/desktop/service.js';
import { StorageClient } from '../src/services/workers/storage-client.js';
import { parseReply, parseStorageRequest } from '../src/services/workers/protocol.js';
import { handleDesktop } from '../src/ipc/desktop.js';
import { ModrinthClient } from '../src/services/resources/modrinth.js';

const id = '00000000-0000-4000-8000-000000000001';
const draft = { id, title: '本地草稿', category: 'mods' as const, body: '第一行\n第二行 <script>不作为HTML</script>', updatedAt: '2026-10-28T00:00:00.000Z' };
test('appearance schema forbids CSS/remote paths, malformed icons and inconsistent layout identities', () => {
  assert.ok(isAppearance(DEFAULT_APPEARANCE));
  for (const patch of [{ accent: 'url(https://evil)' }, { icon: 'https://example.org/icon.png' }, { icon: 'data:image/svg+xml;base64,PHN2Zz4=' }, { homeOrder: ['game', 'game', 'banner'] }, { homeHidden: ['game'] }, { arbitrary: true }]) assert.equal(isAppearance({ ...DEFAULT_APPEARANCE, ...patch }), false);
  assert.ok(isForumDraft(draft)); assert.equal(isForumDraft({ ...draft, body: '\x00' }), false); assert.equal(isForumDraft({ ...draft, title: '' }), false);
  assert.equal(isDesktopPayload({ expectedRevision: 0, appearance: DEFAULT_APPEARANCE, file: '/secret' }, 'desktop:appearance'), false);
});
test('desktop sender/envelope validation precedes native/image side effects, exact outputs remain correlated', async () => {
  let effects = 0; const trace = randomUUID(); const input = { contractVersion: 1, requestId: id, payload: {} };
  const readIcon = async (): Promise<string> => { effects++; return ''; };
  const denied = await handleDesktop('desktop:chooseIcon', input, false, trace, undefined, readIcon, readIcon);
  assert.ok(!denied.ok); assert.equal(denied.error.code, 'INVALID_SENDER'); assert.equal(effects, 0); assert.ok(isDesktopResult(denied, id, 'desktop:chooseIcon'));
  const invalid = await handleDesktop('desktop:get', { ...input, payload: { path: 'private' } }, true, trace, undefined, readIcon, readIcon); assert.ok(!invalid.ok); assert.equal(invalid.error.code, 'INVALID_ARGUMENT');
  assert.equal(isDesktopData({ revision: 0, appearance: DEFAULT_APPEARANCE, drafts: [], path: 'private' }, 'desktop:get'), false);
  assert.throws(() => parseStorageRequest({ version: 1, id, command: { kind: 'desktop:set', expectedRevision: 0, data: { appearance: DEFAULT_APPEARANCE, drafts: [] }, file: 'arbitrary' } }));
  assert.throws(() => parseReply({ version: 1, kind: 'response', id, ok: true, desktop: { schemaVersion: 2, revision: 1, data: { appearance: DEFAULT_APPEARANCE, drafts: [] } } }));
});
test('desktop worker persists themes, exact icons, layout and local drafts without mutating launch defaults', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'oucl-desktop-')); const entry = new URL('../src/services/workers/entry.js', import.meta.url); let storage: StorageClient | undefined;
  try {
    storage = await StorageClient.open(entry, root); const service = new DesktopService(storage);
    assert.equal((await service.get()).revision, 0); assert.equal(await storage.readSettings(), undefined);
    const appearance = { ...structuredClone(DEFAULT_APPEARANCE), accent: '#4466aa', sidebarCollapsed: true, layout: 'profile-left' as const, homeOrder: ['game', 'banner', 'community'] as ('game' | 'banner' | 'community')[] };
    const changed = await service.appearance(0, appearance); assert.equal(changed.revision, 1);
    await assert.rejects(service.appearance(0, appearance), { code: 'REVISION_CONFLICT' });
    const saved = await service.saveDraft(1, draft); assert.equal(saved.drafts[0]?.body, draft.body); assert.deepEqual(saved.appearance, appearance);
    await storage.close(); storage = await StorageClient.open(entry, root); const reopened = new DesktopService(storage); assert.deepEqual((await reopened.get()).appearance, appearance); assert.equal((await reopened.get()).drafts[0]?.id, id);
    assert.equal((await reopened.deleteDraft(2, id)).drafts.length, 0); assert.equal(await storage.readSettings(), undefined);
    const response = await handleDesktop('desktop:get', { contractVersion: 1, requestId: id, payload: {} }, true, id, reopened, async () => '', async () => ''); assert.ok(response.ok); assert.ok(isDesktopResult(response, id, 'desktop:get'));
  } finally { await storage?.close(); assert.ok(path.basename(root).startsWith('oucl-desktop-')); await rm(root, { recursive: true, force: true }); }
});
test('official icon resolution rejects alternate origins, unrelated projects and SVG without renderer networking', async () => {
  for (const icon of ['https://example.com/icon.png', 'https://cdn.modrinth.com/data/zzzzzzzz/icon.png', 'https://cdn.modrinth.com/data/abcdefgh/icon.svg', 'https://cdn.modrinth.com/data/abcdefgh/icon.png?secret=x']) {
    const client = new ModrinthClient(async () => new Response(JSON.stringify({ id: 'abcdefgh', icon_url: icon }))); assert.equal(await client.iconUrl('abcdefgh'), '');
  }
  const client = new ModrinthClient(async () => new Response(JSON.stringify({ id: 'abcdefgh', icon_url: 'https://cdn.modrinth.com/data/abcdefgh/icon.png' }))); assert.equal(await client.iconUrl('abcdefgh'), 'https://cdn.modrinth.com/data/abcdefgh/icon.png');
});
