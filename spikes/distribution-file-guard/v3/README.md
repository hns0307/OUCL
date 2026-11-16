# NT relative-handle admission prototype (v3)

No production changes. Two bounded native rounds completed:

- strong directory access/ShareRead: 7 cases, 4 PASS / 3 FAIL.
- separate Read/ShareRead|ShareWrite namespace guards plus metadata-only RootDirectory anchors: 7 cases, 4 PASS / 3 FAIL.

Both rounds demonstrate an actual WRITE_ATTRIBUTES handle successfully converting the held empty target directory into a junction. Normal guard checks reject the change; a diagnostic relative rename against the exact old target handle returns NTSTATUS C0000280 and does not write the external target. Neither round provides a usable normal rename/link: those return C0000043 sharing violations. The prototype is **NOT_READY** for production.

Source operations open each child through NtCreateFile(parent HANDLE, single component), not by reconstructing its absolute parent pathname. NtSetInformationFile uses a held target RootDirectory plus a leaf name, traditional FileRenameInformation10 / FileLinkInformation11 / FileDispositionInformation13. An initial drive-root CreateFileW bootstraps the graph; GetDriveTypeW and GetVolumeInformationW restrict this experiment to fixed NTFS and bind the root handle's volume serial. This is not a universal Windows filesystem API.

The runner `run.mjs` stores raw stdout/stderr before parsing, plus each round's source snapshot, compilation logs and hashes under `docs/execution/20261116-r2/relative-evidence`. EXEs/fixtures stay only in `D:/MC_start/OUCL/tmp/file-guard-v3-20261116`. Do not rerun these names and overwrite evidence; the two authorized rounds are exhausted.

See `docs/execution/20261116-r2/HANDLE-RELATIVE.md` for primary documentation, exact evidence, limits, and the unresolved sharing conflict. Do not copy these declarations into production and silently relax sharing flags.
