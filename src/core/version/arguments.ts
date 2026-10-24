import type { Rule, VersionArgument, VersionEnvironment } from './types.js';
import { requireMetadata, VersionError } from './validation.js';

/** Limits rule regex complexity before using the built-in engine on short facts. */
function patternMatches(pattern: string, value: string): boolean {
  if (pattern.length > 128 || value.length > 128 || /\\[1-9]|\)[*+{]/.test(pattern)
    || (pattern.match(/[*+{]/g)?.length ?? 0) > 2) throw new VersionError('INVALID_RULE_PATTERN');
  try { return new RegExp(pattern).test(value); } catch { throw new VersionError('INVALID_RULE_PATTERN'); }
}

/** Mojang rules are ordered; with rules present the initial state is disallowed. */
export function rulesAllow(rules: readonly Rule[] | undefined, environment: VersionEnvironment): boolean {
  if (!rules) return true;
  let allowed = false;
  for (const rule of rules) {
    if (rule.os?.name !== undefined && rule.os.name !== environment.os) continue;
    if (rule.os?.arch !== undefined && !patternMatches(rule.os.arch, environment.arch)) continue;
    if (rule.os?.version !== undefined && !patternMatches(rule.os.version, environment.osVersion)) continue;
    if (rule.features && Object.entries(rule.features).some(([name, expected]) => (Object.hasOwn(environment.features, name) ? environment.features[name] : false) !== expected)) continue;
    allowed = rule.action === 'allow';
  }
  return allowed;
}

/** Selects conditional arguments, preserving each value as one spawn-array item. */
export function selectArguments(argumentsList: readonly VersionArgument[], environment: VersionEnvironment): string[] {
  return argumentsList.flatMap(entry => typeof entry === 'string' ? [entry]
    : rulesAllow(entry.rules, environment) ? typeof entry.value === 'string' ? [entry.value] : [...entry.value] : []);
}

/** Tokenizes historical launcher arguments without executing shell syntax. */
export function tokenizeLegacyArguments(input: string): string[] {
  requireMetadata(input.length <= 32768);
  const output: string[] = [];
  let token = ''; let quote: string | undefined; let started = false;
  for (let index = 0; index < input.length; index++) {
    const character = input[index] ?? '';
    if (character === '\\' && quote !== undefined && input[index + 1] === quote) { token += quote; index++; started = true; }
    else if (character === '"' || character === "'") {
      if (quote === character) quote = undefined;
      else if (quote === undefined) quote = character;
      else token += character;
      started = true;
    } else if (/\s/.test(character) && quote === undefined) {
      if (started) { output.push(token); token = ''; started = false; }
    } else { token += character; started = true; }
  }
  if (quote !== undefined) throw new VersionError('INVALID_LEGACY_ARGUMENTS');
  if (started) output.push(token);
  requireMetadata(output.length <= 4096);
  return output;
}

/** Performs one literal substitution pass; missing values never fall back to env. */
export function substituteArguments(tokens: readonly string[], bindings: Readonly<Record<string, string>>): string[] {
  return tokens.map(token => {
    const result = token.replace(/\$\{([a-zA-Z0-9_]+)\}/g, (_match: string, name: string) => {
      if (!Object.hasOwn(bindings, name)) throw new VersionError('UNKNOWN_PLACEHOLDER');
      const value = bindings[name]; requireMetadata(typeof value === 'string'); return value;
    });
    if (result.includes('${')) throw new VersionError('UNKNOWN_PLACEHOLDER');
    requireMetadata(result.length <= 32768);
    return result;
  });
}
