interface TraceEvent {
  sequence: number;
  type: string;
  payload: unknown;
}

export interface RunTraceSnapshot {
  traceId: string;
  runId: string;
  status: string;
  durationMs: number;
  components: Array<{
    name: string;
    durationMs: number;
    spanCount: number;
  }>;
  spans: Array<{
    spanId: string | null;
    sequence: number;
    name: string;
    component: string;
    status: string;
    occurredAt: string;
  }>;
}

const traceLabels: Record<string, { label: string; state: string }> = {
  'agent.run.started': { label: 'Agent 会话启动', state: 'active' },
  'agent.plan.action_ready': { label: '计划下一步', state: 'planned' },
  'agent.act.started': { label: '调用受控工具', state: 'active' },
  'agent.observe.completed': { label: '验证结果通过', state: 'success' },
  'agent.observe.failed': { label: '观察到执行故障', state: 'danger' },
  'agent.reflect.retrying': { label: '反思并受限重试', state: 'warning' },
  'agent.reflect.stopped': { label: '安全停止', state: 'danger' },
  'agent.recovery.resuming': { label: '从检查点恢复', state: 'warning' },
  'agent.action.replayed': { label: '重放已验证结果', state: 'success' },
  'agent.run.completed': { label: 'Agent 运行完成', state: 'success' },
  'agent.run.failed': { label: 'Agent 运行失败', state: 'danger' },
  'agent.run.cancelled': { label: 'Agent 运行已取消', state: 'warning' },
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function traceSummary(event: TraceEvent): string {
  const payload = record(event.payload);
  const task =
    typeof payload.taskType === 'string'
      ? payload.taskType
      : typeof payload.actionId === 'string'
        ? payload.actionId
        : undefined;
  const tool =
    typeof payload.toolName === 'string' ? payload.toolName : undefined;
  const code = typeof payload.code === 'string' ? payload.code : undefined;
  const attempt =
    typeof payload.attempt === 'number' ? `尝试 ${payload.attempt}` : undefined;
  return [task, tool, attempt, code].filter(Boolean).join(' · ') || event.type;
}

const componentLabels: Record<string, string> = {
  'api-postgresql': 'API + SQL',
  redis: 'Redis',
  orchestrator: 'Orchestrator',
  agent: 'Agent',
  unity: 'Unity',
  preview: 'Preview',
};

export function RunTrace(props: {
  events: TraceEvent[];
  trace?: RunTraceSnapshot;
}) {
  const latest = props.events.at(-1);
  return (
    <section className="panel agent-trace" aria-label="全链路执行轨迹">
      <header className="agent-trace__header">
        <span>
          <small>END-TO-END / DISTRIBUTED TRACE</small>
          <strong>全链路执行轨迹</strong>
        </span>
        <span className="agent-trace__identity">
          <code>
            {props.trace
              ? `TRACE ${props.trace.traceId.slice(0, 12)}…`
              : latest
                ? `SEQ ${latest.sequence}`
                : 'STANDBY'}
          </code>
          {props.trace ? (
            <small>
              {props.trace.status.toUpperCase()} · {props.trace.durationMs} MS
            </small>
          ) : null}
        </span>
      </header>
      {props.trace ? (
        <ol className="trace-mesh" aria-label="已追踪的系统组件">
          {props.trace.components.map((component) => (
            <li key={component.name}>
              <span className="trace-mesh__pulse" aria-hidden="true" />
              <small>{componentLabels[component.name] ?? component.name}</small>
              <strong>
                {component.spanCount.toString().padStart(2, '0')} SPANS
              </strong>
              <code>{component.durationMs} MS</code>
            </li>
          ))}
        </ol>
      ) : null}
      {props.events.length > 0 ? (
        <ol className="agent-trace__timeline" aria-live="polite">
          {props.events.map((event) => (
            <li
              key={event.sequence}
              data-state={traceLabels[event.type]?.state ?? 'planned'}
            >
              <span className="agent-trace__sequence">
                {event.sequence.toString().padStart(2, '0')}
              </span>
              <span className="agent-trace__node" aria-hidden="true" />
              <span className="agent-trace__content">
                <strong>{traceLabels[event.type]?.label ?? event.type}</strong>
                <span>{traceSummary(event)}</span>
                <details>
                  <summary>查看结构化观察</summary>
                  <pre>{JSON.stringify(event.payload, null, 2)}</pre>
                </details>
              </span>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}
