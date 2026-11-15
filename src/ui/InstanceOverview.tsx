import { useEffect, useState } from 'react';
import type { InstanceSummary, TaskSnapshot } from '../shared/contracts/instances.js';
import type { SessionSnapshot } from '../shared/contracts/game.js';
import { MESSAGES } from '../shared/locales/messages.js';
import type { MessageKey } from '../shared/locales/messages.js';
import { InstanceOverviewReader, overviewIsolation, overviewSession, overviewTaskRows } from './instance-overview.js';
import type { OverviewTasks } from './instance-overview.js';
import { rendererTaskReads } from './task-query.js';

const TASK_STATES: Record<TaskSnapshot['state'], MessageKey> = {
  queued: 'overviewTaskQueued', running: 'overviewTaskRunning', verifying: 'overviewTaskVerifying', committing: 'overviewTaskCommitting',
  pausing: 'overviewTaskPausing', paused: 'overviewTaskPaused', cancelling: 'overviewTaskCancelling', cancelled: 'overviewTaskCancelled',
  completed: 'overviewTaskCompleted', failing: 'overviewTaskFailing', failed: 'overviewTaskFailed', needsRecovery: 'overviewTaskNeedsRecovery',
};
const INSTANCE_STATES: Record<InstanceSummary['state'], MessageKey> = {
  ready: 'stateReady', installing: 'stateInstalling', failed: 'overviewTaskFailed', cancelled: 'stageCancelled', needsRecovery: 'stageRecovery',
};

export interface InstanceOverviewProps {
  instance: InstanceSummary;
  rootId: string | undefined;
  targetsEnabled: boolean;
  sessions: readonly SessionSnapshot[];
  tasks: readonly TaskSnapshot[];
  onOpenTasks(): void;
}

/** Read-only public facts; Java checks and task control remain with their existing dedicated flows. */
export function InstanceOverview({ instance, rootId, targetsEnabled, sessions, tasks, onOpenTasks }: InstanceOverviewProps) {
  const identity = `${rootId ?? ''}:${instance.instanceId}`;
  const [query, setQuery] = useState<{ identity: string; value: OverviewTasks }>();
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const bridge = window.oucl;
    if (!bridge || !targetsEnabled || !rootId) return;
    let active = true;
    const reader = new InstanceOverviewReader(instance.instanceId, {
      listInstanceTaskTargets: async input => {
        const result = await rendererTaskReads.run(() => bridge.listInstanceTaskTargets(input), () => active && !document.hidden);
        if (!result) throw new Error('READ_ABANDONED'); return result;
      },
    }, value => { if (active) setQuery({ identity, value }); });
    void reader.refresh();
    return () => { active = false; reader.close(); };
  }, [identity, instance.instanceId, rootId, targetsEnabled, refresh]);

  const current = query?.identity === identity && targetsEnabled ? query.value : undefined;
  const session = overviewSession(instance.instanceId, sessions);
  const rows = overviewTaskRows(current?.rows ?? [], tasks);
  return <div className="instance-overview" data-instance-overview={instance.instanceId}>
    <dl className="instance-overview-facts">
      <div><dt>{MESSAGES.overviewIdentity}</dt><dd><code>{instance.instanceId}</code></dd></div>
      <div><dt>{MESSAGES.overviewStatus}</dt><dd>{MESSAGES[INSTANCE_STATES[instance.state]]}</dd></div>
      <div><dt>{MESSAGES.uiIsolation}</dt><dd>{MESSAGES[overviewIsolation(instance)]}</dd></div>
      <div><dt>{MESSAGES.overviewSession}</dt><dd>{session ? MESSAGES[session.state === 'running' ? 'gameRunning' : session.state === 'stopping' ? 'gameStopping' : session.state === 'unknown' ? 'gameUnknown' : 'gameExited'] : MESSAGES.overviewNoSession}
        {session?.state === 'exited' && session.exitCode !== undefined && <> · {MESSAGES.exitCode} {session.exitCode}</>}</dd></div>
    </dl>
    <p className="storage-note">{MESSAGES.overviewJavaHint}</p>
    <div className="section-heading"><h4>{MESSAGES.overviewTasks}</h4><button className="secondary" onClick={onOpenTasks}>{MESSAGES.overviewTasksOpen}</button></div>
    <p className="storage-note">{MESSAGES.overviewTasksScope}</p>
    {targetsEnabled && rootId && <button className="secondary" disabled={current?.connection === 'loading'} onClick={() => { setRefresh(value => value + 1); }}>{MESSAGES.overviewRefresh}</button>}
    <p role="status" data-overview-connection={current?.connection ?? 'unavailable'}>{current?.connection === 'confirmed' ? MESSAGES.taskObservationConfirmed
      : current?.connection === 'loading' ? MESSAGES.taskObservationChecking : MESSAGES.overviewTasksUnavailable}</p>
    {current?.error && <p className="form-error" role="alert">{MESSAGES[current.error]}</p>}
    {current?.connection === 'confirmed' && rows.length === 0 && <p>{MESSAGES.overviewNoTasks}</p>}
    {current?.partial && current.connection === 'confirmed' && <p className="storage-note">{MESSAGES.overviewTasksPartial}</p>}
    {rows.length > 0 && <ul className="instance-overview-tasks">{rows.map(row => <li key={row.task.taskId} data-task-id={row.task.taskId} data-task-state={row.task.state}>
      <strong>{MESSAGES[row.task.kind === 'mod-check' ? 'modsCheck' : 'taskKindModInstall']}</strong> · {MESSAGES[TASK_STATES[row.task.state]]}
      <small><code>{row.task.taskId}</code></small>
      {row.task.error && <p className="form-error">{MESSAGES[row.task.error.messageKey]}</p>}
    </li>)}</ul>}
  </div>;
}
