# D-02 portable regression fixture

Run with Node.js and an existing compatible esbuild installation. `OUCL_SOURCE_ROOT` identifies the source tree under test; `OUCL_TEST_ROOT` is a disposable output directory. Optionally set `OUCL_TOOLCHAIN_ROOT` to a separate existing tree whose node_modules contains esbuild. No dependencies are installed or changed. Example in PowerShell:

```powershell
$env:OUCL_SOURCE_ROOT = '<candidate source root>'
$env:OUCL_TEST_ROOT = '<disposable output root>'
$env:OUCL_TOOLCHAIN_ROOT = '<existing toolchain root>' # optional
node <portable-directory>/run.mjs
```

The runner builds the real GameAdapter and LaunchControls with controlled React/bridge fixtures, then asserts recovery mapping, blocked repeat launch, ordinary failure and queued/running behavior, and failed task query. It does not exercise Electron, persistence, or real gameplay. Existing evidence logs are not touched; only `d02-portable-built` in the specified output root is used. The component-local block ends on unmount/restart.
