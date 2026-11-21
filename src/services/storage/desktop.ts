import { isDesktopState, DEFAULT_APPEARANCE } from '../../shared/contracts/desktop.js';
import type { DesktopState } from '../../shared/contracts/desktop.js';
import { StorageError } from './files.js';
/** Parses only the approved fixed desktop preferences and local drafts record. */
export function parseDesktop(x: unknown): DesktopState { if (!isDesktopState(x)) throw new StorageError('INVALID_RECORD'); return structuredClone(x); }
/** Fresh defaults do not share mutable card arrays between windows or tests. */
export function defaultDesktop(): DesktopState { return { appearance: structuredClone(DEFAULT_APPEARANCE), drafts: [] }; }
