import type { SettingsSummary } from '../shared/contracts/profiles.js';
import type { LauncherAccount } from './launcher-state.js';

export interface FirstRunInput {
  settings: SettingsSummary | undefined;
  rootId: string | undefined;
  accounts: readonly LauncherAccount[];
  accountId: string | undefined;
}
export interface FirstRunStatus {
  loaded: boolean;
  rootSelected: boolean;
  accountSelected: boolean;
  javaRegistered: boolean;
  canContinue: boolean;
}

/** Projects existing selections without changing them or claiming that registered Java was revalidated. */
export function firstRunStatus(input: FirstRunInput): FirstRunStatus {
  const loaded = input.settings !== undefined;
  const rootSelected = loaded && input.rootId !== undefined;
  const accountSelected = loaded && input.accounts.some(account => account.accountId === input.accountId && account.ready);
  return { loaded, rootSelected, accountSelected, javaRegistered: loaded && input.settings?.javaId !== undefined,
    canContinue: rootSelected && accountSelected };
}
