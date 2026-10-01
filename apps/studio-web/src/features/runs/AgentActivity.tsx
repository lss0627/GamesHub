'use client';

import { useEffect, useState } from 'react';
import { DeliveryEvidence } from './DeliveryEvidence';
import { buildRunJourney, type RunJourneyEvent } from './RunJourney';

export function parseRunEvents(text: string): RunJourneyEvent[] {
  return text.split(/\r?\n\r?\n/).flatMap((block) => {
    const data = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim())
      .join('\n');
    if (!data) return [];
    try {
      const event = JSON.parse(data);
      return Number.isSafeInteger(event.sequence) &&
        typeof event.type === 'string'
        ? [
            {
              sequence: event.sequence,
              type: event.type,
              payload: event.payload,
              occurredAt: event.occurred_at,
            },
          ]
        : [];
    } catch {
      return [];
    }
  });
}

export function AgentActivity({
  projectId,
  run,
}: {
  projectId: string;
  run: {
    id: string;
    status: string;
    request_type?: 'create' | 'modify' | 'rollback';
  };
}) {
  const [events, setEvents] = useState<RunJourneyEvent[]>([]);
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    let cursor = 0;
    setEvents([]);
    setOffline(false);
    const poll = async () => {
      try {
        const response = await fetch(
          `/v1/projects/${projectId}/runs/${run.id}/events?after=${cursor}`,
          { cache: 'no-store', signal: AbortSignal.timeout(10000) },
        );
        if (!response.ok) throw new Error('EVENTS_UNAVAILABLE');
        const incoming = parseRunEvents(await response.text());
        if (disposed) return;
        setEvents((previous) =>
          [
            ...new Map(
              [...previous, ...incoming].map((event) => [
                event.sequence,
                event,
              ]),
            ).values(),
          ].sort((a, b) => a.sequence - b.sequence),
        );
        cursor = Math.max(cursor, ...incoming.map((event) => event.sequence));
        setOffline(false);
      } catch {
        if (!disposed) setOffline(true);
      }
      if (!disposed) timer = setTimeout(poll, 2500);
    };
    void poll();
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [projectId, run.id]);
  const steps = buildRunJourney({
    requestType: run.request_type ?? 'modify',
    phase: run.status,
    events,
  })
    .filter((step) => step.lastSequence !== undefined)
    .sort((a, b) => (a.lastSequence ?? 0) - (b.lastSequence ?? 0));
  const current = steps.find((step) => step.state === 'active');
  const rawContext = events.findLast(
    (event) => event.type === 'agent.context.prepared',
  )?.payload;
  const context =
    rawContext && typeof rawContext === 'object'
      ? (rawContext as Record<string, unknown>)
      : null;
  const stopped = [
    'failed',
    'cancelled',
    'timed_out',
    'partially_succeeded',
    'rejected',
    'out_of_scope',
  ].includes(run.status);
  return (
    <section className="studio-agent" aria-label="Agent 制作步骤">
      <div>
        <span className="studio-label">制作伙伴正在做什么</span>
        <h3>
          {run.status === 'succeeded'
            ? '试玩版本已就绪'
            : stopped
              ? '本次制作已停止'
              : run.status === 'paused'
                ? '进度已保留'
                : (current?.title ?? '等待下一步执行结果')}
        </h3>
      </div>
      {offline && <p role="status">步骤记录暂时未同步，正在重新连接。</p>}
      <DeliveryEvidence runId={run.id} phase={run.status} events={events} />
      {context && (
        <p>
          已参考当前制作说明与{' '}
          {Array.isArray(context.memoryIds) ? context.memoryIds.length : 0}{' '}
          条项目记忆。
          {Number(context.droppedGroups) > 0
            ? '较早对话已归档，当前任务与完整检查结果仍保留。'
            : ''}
        </p>
      )}
      {steps.length ? (
        <details open={run.status !== 'succeeded'}>
          <summary>
            已完成 {steps.filter((step) => step.state === 'complete').length}{' '}
            项实际步骤
          </summary>
          <ol>
            {steps.map((step) => (
              <li key={step.id} data-state={step.state}>
                <span>
                  {step.state === 'complete'
                    ? '✓'
                    : step.state === 'failed'
                      ? '!'
                      : '·'}
                </span>
                <div>
                  <strong>{step.title}</strong>
                  <small>
                    {step.state === 'complete'
                      ? '已完成'
                      : step.state === 'failed'
                        ? '未通过，需要处理'
                        : stopped
                          ? '已停止'
                          : run.status === 'paused'
                            ? '已暂停'
                            : '正在处理'}
                  </small>
                </div>
              </li>
            ))}
          </ol>
        </details>
      ) : (
        <p>任务开始后，这里会显示真实的制作和检查记录。</p>
      )}
    </section>
  );
}
