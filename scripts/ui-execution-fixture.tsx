import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Toolbox } from '../src/ui/Toolbox.js';
import { FirstRunGuide } from '../src/ui/FirstRunGuide.js';
import { InstanceOverview } from '../src/ui/InstanceOverview.js';
import type { TargetBridge } from '../src/shared/contracts/task-targets.js';
import '../src/ui/desktop.css';
import '../src/ui/interaction.css';

const ROOT_ID = '00000000-0000-4000-8000-000000000001';
const INSTANCE_ID = '00000000-0000-4000-8000-000000000002';
const SECOND_INSTANCE_ID = '00000000-0000-4000-8000-000000000004';
const FIRST_TASK_ID = '00000000-0000-4000-8000-000000000003';
const SECOND_TASK_ID = '00000000-0000-4000-8000-000000000005';
const TASK = { taskId: SECOND_TASK_ID, kind: 'mod-check', state: 'running', stage: 'preparing', revision: 1, bytesDone: 0 } as const;
type TargetReply = Awaited<ReturnType<TargetBridge['listInstanceTaskTargets']>>;
let releaseFirstRead: (() => void) | undefined;
let secondReads = 0;
function targetReply(instanceId: string, taskId: string): TargetReply {
  return { contractVersion: 1, requestId: ROOT_ID, ok: true,
    data: { items: [{ instanceId, instanceRevision: 1, task: { ...TASK, taskId } }] } };
}
// Explicit synthetic read-only DTO fixture; this does not run production main or task services.
const bridge: TargetBridge = {
  listInstanceTaskTargets: async ({ instanceId }) => {
    if (instanceId === INSTANCE_ID) {
      await new Promise<void>(resolve => { releaseFirstRead = resolve; });
      return targetReply(instanceId, FIRST_TASK_ID);
    }
    if (++secondReads > 1) throw new Error('FIXTURE_READ_UNAVAILABLE');
    return targetReply(instanceId, SECOND_TASK_ID);
  },
};
Object.defineProperty(window, 'oucl', { value: bridge, configurable: true });

function ExecutionFixture() {
  const [actions, setActions] = useState<string[]>([]);
  const [instanceId, setInstanceId] = useState(INSTANCE_ID);
  const action = (value: string): void => { setActions(previous => [...previous, value]); };
  return <main style={{ padding: 24, maxWidth: 1100, margin: '0 auto', minWidth: 0 }}>
    <h1>OUCL 本地 UI 验证夹具</h1><p>真实 React 组件；合成实例、会话与任务；未连接玩家目录、生产服务或网络。</p>
    <output id="fixture-actions">{actions.join(',')}</output>
    <FirstRunGuide enabled settings={{ revision: 1, memoryMiB: 2048, isolationDefault: true, theme: 'system' }}
      rootId={undefined} accounts={[]} accountId={undefined} error={undefined}
      onOpenSettings={() => { action('settings'); }} onOpenAccounts={() => { action('accounts'); }} onRetry={async () => { action('retry'); }} />
    <section className="panel selected-instance" id="fixture-instance"><h2>合成隔离实例 · 1.20.1</h2>
      <button id="fixture-switch-instance" onClick={() => {
        if (!releaseFirstRead) throw new Error('FIRST_READ_NOT_STARTED');
        setInstanceId(SECOND_INSTANCE_ID);
      }}>切换测试实例</button>
      <button id="fixture-release-overview" onClick={() => { releaseFirstRead?.(); }}>返回旧实例查询</button>
      <InstanceOverview rootId={ROOT_ID} targetsEnabled instance={{ instanceId, displayName: '合成隔离实例', mcVersionId: '1.20.1', isolation: 'on', state: 'ready', revision: 1 }}
        sessions={[{ sessionId: ROOT_ID, instanceId, state: 'running', revision: 1, startedAt: '2026-11-15T10:00:00.000Z' }]}
        tasks={[TASK]} onOpenTasks={() => { action('tasks'); }} />
    </section>
    <Toolbox />
  </main>;
}
const root = document.getElementById('root');
if (root) createRoot(root).render(<ExecutionFixture />);
