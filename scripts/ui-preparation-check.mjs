import { build } from 'esbuild';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

// Controlled hook/JSX fixtures exercise handlers and rendered props from the real components.
// They intentionally do not model React effects, DOM events, native disabled inheritance or IPC.
// Passing here is a component-handler check, not browser, keyboard or native-picker acceptance.
const sourceRoot = process.cwd();
const testRoot = path.resolve(process.env.OUCL_TEST_ROOT ?? path.join(sourceRoot, 'tmp', 'ui-preparation-check'));
await mkdir(testRoot, { recursive: true });
const target = await mkdtemp(path.join(testRoot, 'preparation-'));
const hooks = `
let values = [], cursor = 0;
export function reset() { values = []; cursor = 0; }
export function render(component, props) { cursor = 0; return component(props); }
export function useState(initial) { const index = cursor++; if (!(index in values)) values[index] = initial; return [values[index], value => { values[index] = value; }]; }
export function useEffect() {}
export const desktop = { loaded: true, busy: false, preview: undefined, error: undefined,
 snapshot: { appearance: { accent:'#50765a',background:'#f6f8f4',surface:'#ffffff',ink:'#293c30',icon:'',sidebarCollapsed:false,density:'comfortable',layout:'balanced',homeOrder:['banner','game','community'],homeHidden:[] } },
 setPreview(value) { desktop.preview = value; },
 saveAppearance: async () => true,
};
export const useDesktop = Object.assign(() => desktop, {getState:()=>desktop});
export function jsx(type, props) { return {type, props}; } export const jsxs = jsx;
`;
await build({ absWorkingDir: sourceRoot, stdin: { contents: `export { AppearanceSettings } from './src/ui/AppearanceSettings.tsx'; export { FirstRunGuide } from './src/ui/FirstRunGuide.tsx'; export { reset, render, desktop } from 'hook-fixture'; export { MESSAGES } from './src/shared/locales/messages.ts';`, resolveDir: sourceRoot },
  bundle: true, platform: 'node', format: 'esm', outfile: path.join(target, 'components.mjs'), plugins: [{ name: 'controlled-hooks', setup(builder) {
    builder.onResolve({ filter: /^(react|react\/jsx-runtime|hook-fixture)$|desktop-state\.js$/ }, () => ({ path: 'hooks', namespace: 'fixture' }));
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: hooks, loader: 'js' }));
  } }] });
const { AppearanceSettings, FirstRunGuide, reset, render, desktop, MESSAGES } = await import(pathToFileURL(path.join(target, 'components.mjs')));
function all(tree) { if (!tree || typeof tree !== 'object') return []; return [tree, ...[tree.props?.children].flat(Infinity).flatMap(all)]; }
function button(tree, text) {
  assert.equal(typeof text, 'string', 'button lookup requires a real localized label');
  const result = all(tree).find(node => node.type === 'button' && node.props.children === text);
  assert.ok(result, `missing button: ${text}`); return result;
}
function fieldset(tree) { const result = all(tree).find(node => node.type === 'fieldset'); assert.ok(result, 'appearance fieldset missing'); return result; }
function alerts(tree) { return all(tree).filter(node => node.props.role === 'alert'); }
let checks = 0;
function check(condition, name) { assert.ok(condition, name); checks++; console.log(`PASS ${checks}: ${name}`); }
const oldWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
try {
  reset(); desktop.loaded = false;
  check(fieldset(render(AppearanceSettings)).props.disabled === true, 'loading disables appearance edits');
  desktop.loaded = true; desktop.busy = true;
  check(fieldset(render(AppearanceSettings)).props.disabled === true, 'saving disables appearance edits');
  desktop.busy = false; desktop.preview = undefined;
  check(button(render(AppearanceSettings), MESSAGES.uiSave).props.disabled === true, 'no preview cannot be saved');
  button(render(AppearanceSettings), MESSAGES.uiResetAppearance).props.onClick();
  check(desktop.preview !== undefined, 'defaults create a preview');
  check(button(render(AppearanceSettings), MESSAGES.uiSave).props.disabled === false, 'pending preview can be saved explicitly');
  let tree = render(AppearanceSettings); let prevented = false; const panel = {};
  tree.props.onKeyDown({ key: 'Escape', target: {}, currentTarget: panel, preventDefault() { prevented = true; } });
  check(desktop.preview !== undefined && !prevented, 'child Escape does not cancel the panel');
  tree.props.onKeyDown({ key: 'Escape', target: panel, currentTarget: panel, preventDefault() { prevented = true; } });
  check(desktop.preview === undefined && prevented, 'panel Escape cancels its preview');
  reset(); desktop.preview = undefined; desktop.busy = false; desktop.loaded = true;
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { oucl: { chooseDesktopIcon: async () => { throw new Error('synthetic'); } } } });
  button(render(AppearanceSettings), MESSAGES.uiChooseIcon).props.onClick(); await nextTurn();
  check(alerts(render(AppearanceSettings)).some(node => node.props.children === MESSAGES.unavailable), 'picker rejection renders a controlled error');
  reset(); let reads = 0;
  const props = { settings: undefined, rootId: 'existing', accounts: [], accountId: undefined, enabled: true, error: undefined,
    onOpenSettings() { throw new Error('unexpected navigation'); }, onOpenAccounts() { throw new Error('unexpected navigation'); }, onRetry: async () => { reads++; } };
  tree = render(FirstRunGuide, props);
  check(!all(tree).some(node => node.type === 'ol') && reads === 0, 'unread settings do not show a missing-configuration checklist or trigger reads');
  button(tree, MESSAGES.firstRunSkip).props.onClick(); tree = render(FirstRunGuide, props);
  check(tree.type === 'button', 'skip collapses the guide'); tree.props.onClick();
  tree = render(FirstRunGuide, props); check(tree.type === 'section', 'guide can be reopened');
  button(tree, MESSAGES.firstRunRetry).props.onClick(); await nextTurn(); check(reads === 1, 'explicit retry runs exactly one read callback');

  props.error = 'timeout'; tree = render(FirstRunGuide, props);
  check(alerts(tree).some(node => node.props.children === MESSAGES.timeout), 'old read error is shown as its controlled message');
  check(!all(tree).some(node => node.props.role === 'status' && node.props.children === MESSAGES.firstRunLoading), 'read error does not also report ongoing initial loading');
  props.onRetry = async () => { reads++; props.error = undefined; };
  tree = render(FirstRunGuide, props);
  button(tree, MESSAGES.firstRunRetry).props.onClick(); await nextTurn(); tree = render(FirstRunGuide, props);
  check(reads === 2 && alerts(tree).length === 0, 'successful retry clears the parent-controlled old error');
  props.onRetry = async () => { reads++; throw new Error('synthetic retry failure'); };
  tree = render(FirstRunGuide, props);
  button(tree, MESSAGES.firstRunRetry).props.onClick(); await nextTurn(); tree = render(FirstRunGuide, props);
  check(alerts(tree).some(node => node.props.children === MESSAGES.unavailable), 'retry rejection renders a controlled fallback error');
  check(button(tree, MESSAGES.firstRunRetry).props.disabled === false, 'rejected retry releases its busy state');
  props.onRetry = async () => { reads++; };
  tree = render(FirstRunGuide, props);
  button(tree, MESSAGES.firstRunRetry).props.onClick(); await nextTurn(); tree = render(FirstRunGuide, props);
  check(reads === 4 && alerts(tree).length === 0, 'retry after a rejection remains usable and clears its local error');
  console.log(JSON.stringify({ checks, failed: 0, kind: 'controlled hook/JSX fixture; no React effects, real browser or IPC' }));
} finally {
  if (oldWindow) Object.defineProperty(globalThis, 'window', oldWindow); else Reflect.deleteProperty(globalThis, 'window');
}
