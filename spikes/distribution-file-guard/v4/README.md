# v4 metadata-anchor ShareWrite diagnostic

**One authorized run: 7 PASS /0 FAIL /0 NOT_EXERCISED, native exit0.** This is a bounded fixed-NTFS primitive result, not a production transaction or all-platform acceptance claim.

v3 remains unchanged. v4 copies v3 and changes only the metadata RootDirectory anchors' two open sites from ShareRead1 to explicit ShareRead|ShareWrite3 (no ShareDelete). Independent namespace protection handles remain Read/share3; source files remain READ|DELETE/share1. The fixture root changes from v3 to v4; the seven native assertions and FSCTL attack are unchanged. `run.mjs` hardcodes metadata mode and rejects extra arguments; strong mode was not run.

## Evidence

- [Raw native stdout](native-stats/anchor-share3.stdout.json), captured as bytes before parsing.
- [Status and Node/native proof comparison](native-stats/anchor-share3-status.json), including compiler/runtime exit codes and source/EXE SHA256.
- [Exact two-line native mask diff](native-stats/native-mask-diff.patch).
- Source snapshots and compile/stdout/stderr files under `native-stats/`.

Temporary EXE and fixtures only: `D:/MC_start/OUCL/tmp/file-guard-v4-20261116`. No v1/v2/v3, production code, bootstrap, dependency, or Git change was made by this task.

## Causal comparison

| Configuration | Normal rename/link | Occupied target | Live parent-junction attack |
| --- | --- | --- | --- |
| v3 strong READ|ADD_FILE/share1 directories | C0000043 /32; failed |32; failed expected collision | Actual WRITE_ATTRIBUTES FSCTL set succeeds; guard rejects, diagnostic relative rename C0000280 /1921; external unchanged |
| v3 separate namespace guard share3, metadata anchor share1 | Same sharing failures | Same sharing failures | Same safe rejection evidence |
| v4 separate namespace guard share3, metadata anchor share3 | NtRename10/NtLink11 return0; exact inode/hash retained | C0000035 /183; both original files retained | Same actual FSCTL success, checked refusal and native relative rejection; external unchanged |

The only native behavioral change from v3 metadata is the anchor's missing ShareWrite. This directly establishes that the previous v3 metadata test did **not** rule out metadata+relative operation; its anchor was still denying write sharing. The detailed hypothesis that FILE_TRAVERSE/FILE_EXECUTE participates in sharing is not a traced-kernel conclusion here.

The [Microsoft FILE_RENAME_INFORMATION RootDirectory documentation](https://learn.microsoft.com/en-us/windows-hardware/drivers/ddi/ntifs/ns-ntifs-_file_rename_information) explicitly discusses the original TRAVERSE|READ_ATTRIBUTES directory open and the kernel's relative FILE_WRITE_DATA|SYNCHRONIZE open. The v4 result is consistent with requiring their share masks to be compatible; the document alone was not substituted for actual testing.

## Exact seven results

1. Relative child opens and NtSetInformationFile(FileRenameInformation10) succeed with exact source proof.
2. No-replace rename returns183 on an occupied target; source/foreign destination remain intact.
3. FileLinkInformation11 returns183 when occupied, then0 on a missing target; source and new target share inode/hash with nlink2.
4. Same-handle FileDispositionInformation13 returns0; close deletes the intended object and later explicit recreation is retained.
5. Separate source-process write/delete/rename attempts return32, replacement5; empty guarded parent rename returns32.
6. A real preexisting junction is refused by the relative-open plus explicit handle-attribute check.
7. A competitor WRITE_ATTRIBUTES256 handle successfully sets the already-held empty parent junction (attrs1040). Normal graph validation refuses it. Diagnostic NtRename against the old exact target HANDLE/leaf returnsC0000280/1921, with no external file or sentinel changes.

This last case does not infer safety from ShareRead blocking metadata writes: the attack actually succeeds. It does not prove every reparse tag/ancestor placement or Windows build. OBJ_DONT_REPARSE is combined with FILE_OPEN_REPARSE_POINT and actual handle inspection; the existing-junction result is not attributed to the object flag alone.

Node/native comparison in the same successful renamed target: dev2162252404, ino281474978248361, size5 and SHA256 f5e6d024c05c9cc2746a3e127408b91a8b7a7f2a30da0c259bc54265502ddef4 all match exactly. D: is checked by GetDriveTypeW as fixed and GetVolumeInformationW as NTFS; root handle volume serial is matched. Network, UNC, unknown filesystem and different-volume paths are not silently accepted.

## Next integration boundary

This result permits reviewing a private platform implementation using this **explicit metadata-anchor share3** mode. It is not a public execution authorization or a ready-made stdin helper. Production still must bind trusted root/gameDir directory identities and the caller's existing FileProof, open lease/source through the exact held parent, enforce strict bounded stdin schema/fixed relative leaf destinations, fail closed on reparse/type/link/volume changes, redact errors, and preserve uncertain mutation results for journal recovery. No Node path-operation fallback is acceptable.

No second v4 run or additional flag search was performed. Existing v3 failures remain evidence; their root-directory share mismatch is now precisely explained by this new one-change contrast.
