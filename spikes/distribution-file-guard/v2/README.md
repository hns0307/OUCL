# Windows handle guard v2 — bounded spike

No production integration. The prior v1 files and failed evidence remain unchanged.

Two authorized native rounds only:

- round1: 11 cases, 8 PASS / 3 FAIL; preserved source snapshots and raw stdout.
- round2: 11 cases, 10 PASS / 0 FAIL / 1 NOT_EXERCISED; native exit2, NOT_READY. Reparse fixtures could not be created because CreateSymbolicLinkW returned privilege error1314.

Run from the repository root only after authorizing a new bounded validation scope; the original two rounds are complete and their files must not be overwritten:

```powershell
node spikes/distribution-file-guard/v2/run.mjs round1
node spikes/distribution-file-guard/v2/run.mjs round2
```

The runner copies source to the ASCII-only independent `D:/MC_start/OUCL/tmp/file-guard-r2-20261116`, compiles with existing .NET Framework64 csc, and captures exact UTF-8 child stdout/stderr before parsing. EXE/fixtures stay in tmp; source, statuses and evidence are retained separately. No compiler install, network, production bootstrap, or application IPC is involved.

`NativeGuard.cs` holds every ordinary directory ancestor using GENERIC_READ and ShareRead|ShareWrite without ShareDelete; source handles request GENERIC_READ|DELETE and only ShareRead. It rejects reparse/type/link/volume mismatches, hashes the held source, uses native no-replace rename and same-handle delete disposition, and supports exclusive CreateHardLinkW publication while the source and namespace remain held. Maximum accepted links is explicitly1 or2, never arbitrary counts; permitting2 is only suitable for a separately proven private stage/published pair.

See `docs/execution/20261116-r2/FILE-GUARD.md` for exact results, limits, the missing reparse evidence, and a prospective production API. The spike does not authorize enabling distribution execution.

An explicitly authorized independent junction-only supplement subsequently passed once using the unchanged round2 NativeGuard source. See JunctionProbe.cs, junction.mjs and native-evidence/junction-status.json. The original symbolic-link privilege1314 result and two-round matrix remain unchanged; this demonstrates one real REPARSE_POINT rejection path, not all reparse tags or product readiness.
