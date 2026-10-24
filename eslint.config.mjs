import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import { builtinModules } from 'node:module';

const forbiddenNode = { group: ['node:*', ...builtinModules, 'electron', 'react', 'zustand'], message: 'Pure/shared layers cannot import runtime or UI capabilities.' };

export default [
  { ignores: ['dist/**', 'node_modules/**', '.test-build/**', 'spikes/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { files: ['**/*.mjs', '**/*.cjs'], languageOptions: { globals: { process: 'readonly', console: 'readonly', Buffer: 'readonly', URL: 'readonly', WebSocket: 'readonly', fetch: 'readonly', AbortSignal: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly', __dirname: 'readonly', require: 'readonly', module: 'readonly' } } },
  { files: ['**/*.cjs'], rules: { '@typescript-eslint/no-require-imports': 'off' } },
  { files: ['**/*.ts', '**/*.tsx'], rules: { '@typescript-eslint/no-explicit-any': 'error' } },
  { files: ['src/core/**/*.ts', 'src/shared/**/*.ts'], rules: { 'no-restricted-imports': ['error', { patterns: [forbiddenNode, { group: ['**/services/**', '**/main/**', '**/ipc/**', '**/ui/**'], message: 'Keep dependency direction towards core/shared.' }] }] } },
  { files: ['src/ui/**/*.{ts,tsx}'], rules: { 'no-restricted-imports': ['error', { patterns: [{ group: ['node:*', ...builtinModules, 'electron', '**/main/**', '**/services/**', '**/ipc/**', '**/core/**'], message: 'Renderer may use only shared contracts and the limited preload API.' }] }] } },
  { files: ['src/services/**/*.ts'], rules: { 'no-restricted-imports': ['error', { patterns: [{ group: ['electron', 'react', '**/main/**', '**/ui/**'], message: 'Services receive platform adapters rather than importing Electron/UI.' }] }] } },
];
