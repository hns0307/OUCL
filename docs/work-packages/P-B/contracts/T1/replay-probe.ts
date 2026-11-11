// Explicit JSON fixture replay, not product storage recovery.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { projectCandidate } from './binding-candidate.js';
import type { BindingInput } from './binding-candidate.js';
const file = path.resolve(process.argv[2] ?? '');
const base = path.resolve('docs/work-packages/P-B/validation/T1-20261110/cases');
if (!file.startsWith(base + path.sep)) throw new Error('OUTSIDE_FIXTURE');
const value: BindingInput = JSON.parse(await readFile(file, 'utf8')) as BindingInput;
process.stdout.write(JSON.stringify(projectCandidate(value)));
