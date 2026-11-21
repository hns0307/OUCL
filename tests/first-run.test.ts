import { test } from 'node:test';
import assert from 'node:assert/strict';
import { firstRunStatus } from '../src/ui/first-run.js';
import type { FirstRunInput } from '../src/ui/first-run.js';

const fixture = (): FirstRunInput => ({ settings: { revision: 7, rootId: 'root-existing', javaId: 'java-existing', memoryMiB: 4096, isolationDefault: false, theme: 'system' },
  rootId: 'root-existing', accountId: 'account-existing', accounts: [{ accountId: 'account-existing', kind: 'offline', displayName: 'Existing', gameName: 'Existing', ready: true }] });

test('unread settings do not classify a returning player as configured or new', () => {
  const input = fixture(); input.settings = undefined;
  assert.deepEqual(firstRunStatus(input), { loaded: false, rootSelected: false, accountSelected: false, javaRegistered: false, canContinue: false });
});
test('guide preserves existing root, profile, Java and preferences exactly', () => {
  const input = fixture(); const before = structuredClone(input);
  assert.deepEqual(firstRunStatus(input), { loaded: true, rootSelected: true, accountSelected: true, javaRegistered: true, canContinue: true });
  assert.deepEqual(input, before);
});
test('automatic Java preparation remains optional and is never represented as registered Java', () => {
  const input = fixture(); delete input.settings!.javaId;
  assert.equal(firstRunStatus(input).javaRegistered, false);
  assert.equal(firstRunStatus(input).canContinue, true);
});
test('stale selected account and unavailable profile do not complete preparation', () => {
  const input = fixture(); input.accountId = 'removed';
  assert.equal(firstRunStatus(input).accountSelected, false);
  input.accountId = 'account-existing'; input.accounts = [{ ...input.accounts[0]!, ready: false }];
  assert.equal(firstRunStatus(input).canContinue, false);
});
test('stored root preference does not substitute for the current selected root', () => {
  const input = fixture(); input.rootId = undefined;
  assert.equal(firstRunStatus(input).rootSelected, false);
  assert.equal(firstRunStatus(input).canContinue, false);
});
