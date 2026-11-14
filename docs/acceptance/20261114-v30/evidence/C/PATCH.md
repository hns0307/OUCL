# 候选产品补丁

仅以下两个产品文件；从基线 `fab0ac8` 生成。供协调方独立审查，不代表已合入。

可迁移的定向组件夹具另由 `tests/component-harness.cjs`、`tests/react-stub.cjs`、`tests/jsx-stub.cjs` 三文件组成；通过 `NODE_PATH` 使用已有 esbuild，并可通过 `OUCL_SOURCE_ROOT`、`OUCL_TEST_ROOT` 分别指定待测源码及输出目录，详见 RESULT.md。夹具不属于以下产品补丁。

```diff
--- a/src/ui/MaintenancePreviewPanel.tsx
+++ b/src/ui/MaintenancePreviewPanel.tsx
@@ -63,7 +63,10 @@
       if (!result.ok) { observationError(result.error.code, result.error.messageKey); return; }
       // Query the terminal result, because completion can win the cancellation race.
       const latest = await window.oucl.maintenancePreviewStatus(snapshot.previewId);
-      if (latest.ok && (!latest.data.result || matches(latest.data.result))) setSnapshot(latest.data);
+      if (latest.ok && (!latest.data.result || matches(latest.data.result))) {
+        setSnapshot(latest.data);
+        if (latest.data.status !== 'queued' && latest.data.status !== 'running') setError(undefined);
+      }
       else if (!latest.ok) observationError(latest.error.code, latest.error.messageKey);
       else setError('unavailable');
     } catch { setError('unavailable'); } finally { setAccepting(false); }
@@ -96,7 +99,11 @@
         {' · '}{issue.scope === 'local' ? MESSAGES.modsDeclaration : 'Modrinth'}
         {' · '}{issue.fileId ? names([issue.fileId]) : MESSAGES.modsEnvironment}
         {' · '}{MOD_ISSUE_MESSAGES[issue.code] ?? MESSAGES.modsUnknownReason}
-        {' '}<code>{issue.modId ?? issue.dependencyModId ?? issue.dependencyProjectId ?? issue.dependencyVersionId ?? issue.code}</code>
+        {issue.modId && <> · {MESSAGES.modsPreviewIssueMod} <code>{issue.modId}</code></>}
+        {issue.dependencyModId && <> · {MESSAGES.modsPreviewIssueDependency} <code>{issue.dependencyModId}</code></>}
+        {issue.dependencyProjectId && <> · {MESSAGES.modsPreviewIssueProject} <code>{issue.dependencyProjectId}</code></>}
+        {issue.dependencyVersionId && <> · {MESSAGES.modsPreviewIssueVersion} <code>{issue.dependencyVersionId}</code></>}
+        {!issue.modId && !issue.dependencyModId && !issue.dependencyProjectId && !issue.dependencyVersionId && <> · <code>{issue.code}</code></>}
         {issue.requirement && <> · {MESSAGES.modsRequirement} {issue.requirement}</>}
         {!!issue.actual.length && <> · {MESSAGES.modsActual} {issue.actual.join(', ')}</>}
         {issue.embeddedDepth > 0 && <> · {MESSAGES.modsPreviewEmbeddedDepth} {issue.embeddedDepth}</>}</li>)}</ul>}
--- a/src/shared/locales/messages.ts
+++ b/src/shared/locales/messages.ts
@@ -4,6 +4,8 @@
   modsPreviewReady: '本次已知声明未发现阻止因素', modsPreviewBlocked: '存在阻止因素', modsPreviewUnknown: '无法确定影响',
   modsPreviewDisclaimer: '这是只读预览，不会修改文件，也不保证游戏实际运行。', modsPreviewExpired: '预览已过期，可重新预览；文件有变化时请先重新检查模组列表。',
   modsPreviewEmbeddedDepth: '内嵌深度',
+  modsPreviewIssueMod: '声明模组', modsPreviewIssueDependency: '依赖模组',
+  modsPreviewIssueProject: '平台项目', modsPreviewIssueVersion: '固定版本',
   modsPreviewBefore: '变更前', modsPreviewAfter: '变更后', modsPreviewProviders: '此文件包含的声明',
   modsPreviewDirect: '直接依赖此文件', modsPreviewTransitive: '间接依赖此文件', modsPreviewRelations: '依赖关系',
   modsPreviewOptional: '可选', modsPreviewRequired: '必需', modsPreviewIncomplete: '部分证据无法展示或超过上限，请重新检查。',
```
