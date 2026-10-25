import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const MAX_JSON_BYTES = 2 * 1024 * 1024;
const SAFE_VALUE = /^[A-Za-z0-9_.+@:'{}\[\]/,$=-]{1,2048}$/;

const TARGETS = [
  {
    kind: 'forge', minecraft: '1.20.1', loader: '47.4.28', profile: 'forge',
    version: '1.20.1-forge-47.4.28', size: 8_859_760,
    sha1: '585dd6071897becaed3b09bff4c3d9559e0cbc75',
    hosts: new Set(['maven.minecraftforge.net', 'libraries.minecraft.net']),
  },
  {
    kind: 'neoforge', minecraft: '1.21.1', loader: '21.1.258', profile: 'NeoForge',
    version: 'neoforge-21.1.258', size: 6_972_022,
    sha1: '4e873ba909cd4d2c0818517f479a69a655097691',
    hosts: new Set(['maven.neoforged.net', 'libraries.minecraft.net']),
  },
];

function fail(code) { throw new Error(code); }
function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }

async function entry(file, name) {
  const result = await execute('tar.exe', ['-xOf', file, name], {
    encoding: 'buffer', windowsHide: true, timeout: 15_000, maxBuffer: MAX_JSON_BYTES + 1,
  });
  if (result.stdout.length === 0 || result.stdout.length > MAX_JSON_BYTES) fail('PROFILE_SIZE');
  try { return JSON.parse(result.stdout.toString('utf8')); } catch { fail('PROFILE_JSON'); }
}

function library(value, target) {
  if (!object(value) || typeof value.name !== 'string' || !object(value.downloads) || !object(value.downloads.artifact)) fail('LIBRARY_SCHEMA');
  const artifact = value.downloads.artifact;
  if (typeof artifact.path !== 'string' || !SAFE_VALUE.test(artifact.path) || artifact.path.startsWith('/') || artifact.path.includes('..')) fail('LIBRARY_PATH');
  if (typeof artifact.sha1 !== 'string' || !/^[a-f0-9]{40}$/.test(artifact.sha1)
    || !Number.isSafeInteger(artifact.size) || artifact.size < 1 || artifact.size > 1024 ** 3) fail('LIBRARY_PROOF');
  let url;
  try { url = new URL(artifact.url); } catch { fail('LIBRARY_URL'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash || !target.hosts.has(url.hostname)) fail('LIBRARY_URL');
  return value.name;
}

function processor(value, libraryNames) {
  if (!object(value) || typeof value.jar !== 'string' || !libraryNames.has(value.jar)
    || !Array.isArray(value.classpath) || value.classpath.length > 32 || !value.classpath.every(item => typeof item === 'string' && libraryNames.has(item))
    || !Array.isArray(value.args) || value.args.length > 128 || !value.args.every(item => typeof item === 'string' && SAFE_VALUE.test(item))) fail('PROCESSOR_SCHEMA');
  if (value.sides !== undefined && (!Array.isArray(value.sides) || value.sides.length > 2
    || !value.sides.every(side => side === 'client' || side === 'server'))) fail('PROCESSOR_SIDES');
  if (value.outputs !== undefined && (!object(value.outputs) || Object.keys(value.outputs).length > 16
    || !Object.entries(value.outputs).every(([key, digest]) => SAFE_VALUE.test(key) && typeof digest === 'string' && SAFE_VALUE.test(digest)))) fail('PROCESSOR_OUTPUTS');
  return {
    jar: value.jar,
    classpath: value.classpath.length,
    args: value.args,
    sides: value.sides ?? ['client', 'server'],
    outputs: value.outputs === undefined ? [] : Object.keys(value.outputs),
  };
}

async function analyze(target, file) {
  const bytes = await readFile(file);
  if (bytes.length !== target.size || createHash('sha1').update(bytes).digest('hex') !== target.sha1) fail('INSTALLER_PROOF');
  const [profile, version] = await Promise.all([entry(file, 'install_profile.json'), entry(file, 'version.json')]);
  if (!object(profile) || profile.spec !== 1 || profile.profile !== target.profile || profile.version !== target.version
    || profile.minecraft !== target.minecraft || !object(profile.data) || !Array.isArray(profile.libraries)
    || profile.libraries.length > 256 || !Array.isArray(profile.processors) || profile.processors.length > 32) fail('PROFILE_IDENTITY');
  if (!object(version) || version.id !== target.version || version.inheritsFrom !== target.minecraft
    || version.mainClass !== 'cpw.mods.bootstraplauncher.BootstrapLauncher' || !Array.isArray(version.libraries)) fail('VERSION_IDENTITY');
  const libraryNames = new Set(profile.libraries.map(value => library(value, target)));
  const processors = profile.processors.map(value => processor(value, libraryNames));
  const client = processors.filter(value => value.sides.includes('client'));
  const placeholders = [...new Set(client.flatMap(value => value.args.flatMap(arg => arg.match(/\{[A-Z_]+\}/g) ?? [])))].sort();
  const data = Object.fromEntries(Object.entries(profile.data).map(([key, value]) => {
    if (!/^[A-Z][A-Z0-9_]{0,63}$/.test(key) || !object(value) || typeof value.client !== 'string' || !SAFE_VALUE.test(value.client)) fail('PROFILE_DATA');
    return [key, value.client];
  }));
  return {
    kind: target.kind, minecraft: target.minecraft, loader: target.loader,
    installer: { size: target.size, sha1: target.sha1 },
    profile: { version: target.version, libraries: profile.libraries.length, versionLibraries: version.libraries.length },
    processors: { total: processors.length, client: client.length, steps: client }, placeholders, data,
  };
}

const directory = path.resolve(process.argv[2] ?? '.test-build/installer-spike-20261026');
try {
  const report = [];
  for (const target of TARGETS) report.push(await analyze(target, path.join(directory, `${target.kind}.jar`)));
  process.stdout.write(`${JSON.stringify({ status: 'PASS', report }, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : 'SPIKE_FAILED'}\n`);
  process.exitCode = 1;
}
