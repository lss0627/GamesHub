'use client';

import { useEffect, useRef, useState } from 'react';
import { StudioNav } from '../../components/StudioNav';
import { UiIcon } from '../../components/UiIcon';
import { AssetLibrary } from '../assets/AssetLibrary';
import { RevisionMessage } from '../chat/RevisionMessage';
import { RunTrace, type RunTraceSnapshot } from '../developer/RunTrace';
import { GamePreview } from '../preview/GamePreview';
import { RunJourney, type RunJourneyEvent } from '../runs/RunJourney';
import { RunOutcome } from '../runs/RunOutcome';
import { RunProgress } from '../runs/RunProgress';
import { describeRunFailure } from '../runs/run-failure';
import {
  RuntimeReadiness,
  type RuntimeSnapshot,
  runtimeSnapshotFromUnknown,
} from '../system/RuntimeReadiness';
import { UndoAction } from '../versions/UndoAction';
import { VersionHistory } from '../versions/VersionHistory';

function parseSseEvents(value: string): unknown[] {
  return value.split(/\n\n+/).flatMap((block) => {
    const data = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim())
      .join('\n');
    if (!data) return [];
    try {
      return [JSON.parse(data) as unknown];
    } catch {
      return [];
    }
  });
}

function traceSnapshotFromUnknown(
  value: unknown,
): RunTraceSnapshot | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const source = value as Record<string, unknown>;
  if (
    typeof source.trace_id !== 'string' ||
    typeof source.run_id !== 'string' ||
    typeof source.status !== 'string' ||
    typeof source.duration_ms !== 'number' ||
    !Array.isArray(source.components) ||
    !Array.isArray(source.spans)
  )
    return undefined;
  return {
    traceId: source.trace_id,
    runId: source.run_id,
    status: source.status,
    durationMs: source.duration_ms,
    components: source.components.flatMap((item) => {
      if (!item || typeof item !== 'object') return [];
      const component = item as Record<string, unknown>;
      if (
        typeof component.name !== 'string' ||
        typeof component.duration_ms !== 'number' ||
        typeof component.span_count !== 'number'
      )
        return [];
      return [
        {
          name: component.name,
          durationMs: component.duration_ms,
          spanCount: component.span_count,
        },
      ];
    }),
    spans: source.spans.flatMap((item) => {
      if (!item || typeof item !== 'object') return [];
      const span = item as Record<string, unknown>;
      if (
        typeof span.sequence !== 'number' ||
        typeof span.name !== 'string' ||
        typeof span.component !== 'string' ||
        typeof span.status !== 'string' ||
        typeof span.occurred_at !== 'string'
      )
        return [];
      return [
        {
          spanId: typeof span.span_id === 'string' ? span.span_id : null,
          sequence: span.sequence,
          name: span.name,
          component: span.component,
          status: span.status,
          occurredAt: span.occurred_at,
        },
      ];
    }),
  };
}

export function CreatorWorkspace(props: { projectId?: string }) {
  const [clientReady, setClientReady] = useState(false);
  const [serviceReady, setServiceReady] = useState<boolean | undefined>();
  const [runtimeSnapshot, setRuntimeSnapshot] = useState<RuntimeSnapshot>();
  const [prompt, setPrompt] = useState('');
  const [phase, setPhase] = useState<
    'queued' | 'planning' | 'testing' | 'succeeded' | 'failed'
  >('queued');
  const [message, setMessage] = useState('等待你的游戏想法');
  const [submitted, setSubmitted] = useState(false);
  const [runId, setRunId] = useState<string | undefined>();
  const [runRequestType, setRunRequestType] = useState<
    'create' | 'modify' | 'rollback'
  >('create');
  const [activeProjectId, setActiveProjectId] = useState(props.projectId);
  const [previewUrl, setPreviewUrl] = useState<string | undefined>();
  const [failure, setFailure] = useState<string | undefined>();
  const [failureIntent, setFailureIntent] = useState<'out_of_scope' | 'error'>(
    'error',
  );
  const [versions, setVersions] = useState<
    Array<{ id: string; summary: string; status: string; createdAt: string }>
  >([]);
  const [assets, setAssets] = useState<
    Array<{ id: string; name: string; importStatus: string }>
  >([]);
  const [resourceRevision, setResourceRevision] = useState(0);
  const [completedTaskIds, setCompletedTaskIds] = useState<string[]>([]);
  const [totalTasks, setTotalTasks] = useState(0);
  const [runControl, setRunControl] = useState<
    'running' | 'pausing' | 'paused' | 'cancelled'
  >('running');
  const [agentEvents, setAgentEvents] = useState<
    Array<{ sequence: number; type: string; payload: unknown }>
  >([]);
  const [runEvents, setRunEvents] = useState<RunJourneyEvent[]>([]);
  const [runTrace, setRunTrace] = useState<RunTraceSnapshot>();

  const activePoll = useRef<AbortController | undefined>(undefined);
  const mutationPending = useRef(false);
  const [loadingProject, setLoadingProject] = useState(
    Boolean(props.projectId),
  );
  const eventCursor = useRef(0);
  const completedTaskIdsRef = useRef<string[]>([]);
  const totalTasksRef = useRef(0);

  useEffect(() => {
    setClientReady(true);
    let disposed = false;
    let timer: number | undefined;
    const check = async (): Promise<void> => {
      try {
        const response = await fetch('/api/gamerhub/health', {
          cache: 'no-store',
        });
        const body: unknown = await response.json();
        const snapshot = runtimeSnapshotFromUnknown(body);
        if (!disposed) {
          setRuntimeSnapshot(snapshot);
          setServiceReady(response.ok && snapshot?.status !== 'blocked');
        }
      } catch {
        if (!disposed) {
          setRuntimeSnapshot(undefined);
          setServiceReady(false);
        }
      }
      if (!disposed) timer = window.setTimeout(() => void check(), 10_000);
    };
    void check();
    return () => {
      disposed = true;
      if (timer) window.clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    if (!props.projectId) return;
    let disposed = false;
    void fetch(`/v1/projects/${encodeURIComponent(props.projectId)}`)
      .then((response) => {
        if (!disposed && response.status === 404) {
          setActiveProjectId(undefined);
          setLoadingProject(false);
          setMessage('原项目不在当前数据源中，已切换到新建模式');
        }
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
    };
  }, [props.projectId]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      !prompt.trim() ||
      submitted ||
      mutationPending.current ||
      loadingProject
    )
      return;
    mutationPending.current = true;
    activePoll.current?.abort();
    const requestType =
      activeProjectId &&
      (versions.some((version) => version.status === 'active') || previewUrl)
        ? 'modify'
        : 'create';
    setSubmitted(true);
    setPhase('planning');
    setMessage('正在理解你的游戏想法…');
    setFailure(undefined);
    setFailureIntent('error');
    setRunId(undefined);
    setRunControl('running');
    setCompletedTaskIds([]);
    setTotalTasks(0);
    setAgentEvents([]);
    setRunEvents([]);
    setRunTrace(undefined);
    eventCursor.current = 0;
    completedTaskIdsRef.current = [];
    totalTasksRef.current = 0;
    try {
      let project = activeProjectId;
      if (!project) {
        const projectResponse = await fetch('/v1/projects', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: 'Runner 游戏' }),
        });
        setServiceReady(projectResponse.status < 500);
        if (!projectResponse.ok)
          throw new Error(`PROJECT_CREATE_FAILED_${projectResponse.status}`);
        const projectBody: unknown = await projectResponse.json();
        project =
          projectBody &&
          typeof projectBody === 'object' &&
          'id' in projectBody &&
          typeof projectBody.id === 'string'
            ? projectBody.id
            : undefined;
        if (!project) throw new Error('PROJECT_ID_MISSING');
        setActiveProjectId(project);
        window.history.replaceState(null, '', `/projects/${project}`);
      }
      const response = await fetch(
        `/v1/projects/${encodeURIComponent(project)}/runs`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'Idempotency-Key': crypto.randomUUID(),
          },
          body: JSON.stringify({
            request_type: requestType,
            prompt,
          }),
        },
      );
      setServiceReady(response.status < 500);
      if (!response.ok) {
        const problem = (await response.json().catch(() => ({}))) as {
          code?: string;
        };
        throw new Error(problem.code ?? `RUN_CREATE_FAILED_${response.status}`);
      }
      const body: unknown = await response.json();
      const createdRunId =
        body &&
        typeof body === 'object' &&
        'id' in body &&
        typeof body.id === 'string'
          ? body.id
          : undefined;
      if (!createdRunId) throw new Error('RUN_ID_MISSING');
      setRunRequestType(requestType);
      setRunId(createdRunId);
    } catch (error) {
      const rawMessage =
        error instanceof Error ? error.message : '创作请求提交失败';
      const presentation = describeRunFailure({
        code: rawMessage,
        message: rawMessage,
      });
      setPhase('failed');
      setFailure(presentation.message);
      setFailureIntent(presentation.intent);
      setMessage(presentation.title);
      setSubmitted(false);
      if (/FETCH|_(?:502|503|504)$/.test(rawMessage)) setServiceReady(false);
    } finally {
      mutationPending.current = false;
    }
  }

  useEffect(() => {
    if (!activeProjectId || !runId) return;
    const controller = new AbortController();
    activePoll.current = controller;
    let disposed = false;
    let timer: number | undefined;
    const poll = async (): Promise<void> => {
      try {
        const response = await fetch(
          `/v1/projects/${encodeURIComponent(activeProjectId)}/runs/${encodeURIComponent(runId)}`,
          { signal: controller.signal, cache: 'no-store' },
        );
        if (disposed || controller.signal.aborted) return;
        setServiceReady(response.status < 500);
        if (!response.ok)
          throw new Error(`RUN_STATUS_FAILED_${response.status}`);
        const body: unknown = await response.json();
        let observedFailure: { code?: string; message?: string } | undefined;
        const eventsResponse = await fetch(
          `/v1/projects/${encodeURIComponent(activeProjectId)}/runs/${encodeURIComponent(runId)}/events?after=${eventCursor.current}`,
          {
            signal: controller.signal,
            headers: {
              Accept: 'text/event-stream',
              'Last-Event-ID': String(eventCursor.current),
            },
          },
        );
        if (eventsResponse.ok) {
          const contentType = eventsResponse.headers.get('content-type') ?? '';
          const eventsBody: unknown = contentType.includes('text/event-stream')
            ? { items: parseSseEvents(await eventsResponse.text()) }
            : await eventsResponse.json();
          if (disposed || controller.signal.aborted) return;
          const events =
            eventsBody &&
            typeof eventsBody === 'object' &&
            'items' in eventsBody &&
            Array.isArray(eventsBody.items)
              ? eventsBody.items
              : [];
          const completed = new Set(completedTaskIdsRef.current);
          let observedTotal = totalTasksRef.current;
          let observedCursor = eventCursor.current;
          const observedAgentEvents: Array<{
            sequence: number;
            type: string;
            payload: unknown;
          }> = [];
          const observedRunEvents: RunJourneyEvent[] = [];
          for (const event of events) {
            if (!event || typeof event !== 'object') continue;
            const sequence =
              'sequence' in event && typeof event.sequence === 'number'
                ? event.sequence
                : 0;
            observedCursor = Math.max(observedCursor, sequence);
            const payload =
              'payload' in event &&
              event.payload &&
              typeof event.payload === 'object'
                ? (event.payload as Record<string, unknown>)
                : {};
            const type =
              'type' in event && typeof event.type === 'string'
                ? event.type
                : '';
            const occurredAt =
              'occurred_at' in event && typeof event.occurred_at === 'string'
                ? event.occurred_at
                : undefined;
            if (type)
              observedRunEvents.push({
                sequence,
                type,
                payload,
                ...(occurredAt ? { occurredAt } : {}),
              });
            if (type.startsWith('agent.'))
              observedAgentEvents.push({ sequence, type, payload });
            if (
              'totalTasks' in payload &&
              typeof payload.totalTasks === 'number'
            )
              observedTotal = Math.max(observedTotal, payload.totalTasks);
            if (
              type === 'task.progress' &&
              payload.status === 'completed' &&
              typeof payload.taskId === 'string'
            )
              completed.add(payload.taskId);
            if (type === 'run.failed') {
              observedFailure = {
                ...('code' in payload && typeof payload.code === 'string'
                  ? { code: payload.code }
                  : {}),
                ...('message' in payload && typeof payload.message === 'string'
                  ? { message: payload.message }
                  : {}),
              };
            }
          }
          eventCursor.current = observedCursor;
          if (!disposed) {
            const completedList = [...completed];
            completedTaskIdsRef.current = completedList;
            totalTasksRef.current = observedTotal;
            setCompletedTaskIds(completedList);
            setTotalTasks(observedTotal);
            if (observedAgentEvents.length > 0)
              setAgentEvents((current) => {
                const merged = new Map(
                  current.map((event) => [event.sequence, event]),
                );
                for (const event of observedAgentEvents)
                  merged.set(event.sequence, event);
                return [...merged.values()]
                  .sort((left, right) => left.sequence - right.sequence)
                  .slice(-100);
              });
            if (observedRunEvents.length > 0)
              setRunEvents((current) => {
                const merged = new Map(
                  current.map((event) => [event.sequence, event]),
                );
                for (const event of observedRunEvents)
                  merged.set(event.sequence, event);
                return [...merged.values()].sort(
                  (left, right) => left.sequence - right.sequence,
                );
              });
          }
        }
        const traceResponse = await fetch(
          `/v1/projects/${encodeURIComponent(activeProjectId)}/runs/${encodeURIComponent(runId)}/trace`,
          { cache: 'no-store', signal: controller.signal },
        ).catch(() => undefined);
        if (traceResponse?.ok) {
          const trace = traceSnapshotFromUnknown(await traceResponse.json());
          if (!disposed && trace) setRunTrace(trace);
        }
        const status =
          body &&
          typeof body === 'object' &&
          'status' in body &&
          typeof body.status === 'string'
            ? body.status
            : 'queued';
        if (disposed || controller.signal.aborted) return;
        setFailure(undefined);
        setRunControl(
          status === 'paused'
            ? 'paused'
            : status === 'pause_requested'
              ? 'pausing'
              : status === 'cancelled'
                ? 'cancelled'
                : 'running',
        );
        if (status === 'succeeded') {
          const resultSummary =
            body &&
            typeof body === 'object' &&
            'result_summary' in body &&
            typeof body.result_summary === 'string'
              ? body.result_summary
              : undefined;
          if (!resultSummary?.startsWith('http'))
            throw new Error('PREVIEW_EVIDENCE_MISSING');
          setPreviewUrl(resultSummary);
          setPhase('succeeded');
          setMessage('可试玩：Preview 已通过当前环境检查');
          setSubmitted(false);
          setResourceRevision((current) => current + 1);
          return;
        }
        if (
          ['failed', 'cancelled', 'timed_out', 'partially_succeeded'].includes(
            status,
          )
        ) {
          const resultSummary =
            body &&
            typeof body === 'object' &&
            'result_summary' in body &&
            typeof body.result_summary === 'string'
              ? body.result_summary
              : undefined;
          const failureMessage = observedFailure?.message ?? resultSummary;
          const presentation = describeRunFailure(
            {
              ...(observedFailure?.code ? { code: observedFailure.code } : {}),
              ...(failureMessage ? { message: failureMessage } : {}),
            },
            status,
          );
          setPhase('failed');
          setFailure(presentation.message);
          setFailureIntent(presentation.intent);
          setMessage(presentation.title);
          setSubmitted(false);
          return;
        }
        const unityWorkStarted = completedTaskIdsRef.current.length > 0;
        const validating =
          unityWorkStarted ||
          ['playtesting', 'evaluating', 'fixing'].includes(status);
        setPhase(validating ? 'testing' : 'planning');
        setMessage(
          status === 'paused'
            ? '已在安全边界暂停，可恢复运行'
            : status === 'pause_requested'
              ? '正在等待当前操作完成后暂停…'
              : validating
                ? 'Agent 正在调用 Unity 工具并验证构建…'
                : '正在准备游戏计划…',
        );
        if (!disposed) timer = window.setTimeout(() => void poll(), 1000);
      } catch (error) {
        if (disposed || controller.signal.aborted) return;
        const rawMessage =
          error instanceof Error ? error.message : '无法读取运行状态';
        const presentation = describeRunFailure({
          code: rawMessage,
          message: rawMessage,
        });
        if (
          !/RUN_STATUS_FAILED_(?:404|401|403)$|PREVIEW_EVIDENCE_MISSING/.test(
            rawMessage,
          )
        ) {
          setMessage('连接暂时中断，正在重新获取任务状态…');
          setServiceReady(false);
          timer = window.setTimeout(() => void poll(), 3000);
          return;
        }
        setPhase('failed');
        setFailure(presentation.message);
        setFailureIntent(presentation.intent);
        setMessage(presentation.title);
        setSubmitted(false);
      }
    };
    void poll();
    return () => {
      disposed = true;
      controller.abort();
      if (timer) window.clearTimeout(timer);
    };
  }, [activeProjectId, runId]);

  useEffect(() => {
    if (!activeProjectId || submitted || runId || mutationPending.current)
      return;
    let disposed = false;
    void fetch(
      `/v1/projects/${encodeURIComponent(activeProjectId)}/runs?refresh=${resourceRevision}`,
    )
      .then(async (response) => {
        if (!response.ok) throw new Error('RUNS_LOAD_FAILED');
        const body: unknown = await response.json();
        if (disposed) return;
        setLoadingProject(false);
        const items =
          body &&
          typeof body === 'object' &&
          'items' in body &&
          Array.isArray(body.items)
            ? body.items.filter(
                (
                  item,
                ): item is {
                  id: string;
                  request_type: 'create' | 'modify' | 'rollback';
                  status: string;
                  created_at: string;
                  result_summary: string | null;
                } =>
                  Boolean(
                    item &&
                      typeof item === 'object' &&
                      'id' in item &&
                      typeof item.id === 'string' &&
                      'request_type' in item &&
                      ['create', 'modify', 'rollback'].includes(
                        String(item.request_type),
                      ) &&
                      'status' in item &&
                      typeof item.status === 'string' &&
                      'created_at' in item &&
                      typeof item.created_at === 'string' &&
                      'result_summary' in item &&
                      (typeof item.result_summary === 'string' ||
                        item.result_summary === null),
                  ),
              )
            : [];
        const latestActive = items
          .filter((item) =>
            [
              'queued',
              'planning',
              'waiting_for_engine',
              'executing',
              'playtesting',
              'evaluating',
              'fixing',
              'pause_requested',
              'paused',
            ].includes(item.status),
          )
          .sort((left, right) =>
            left.created_at.localeCompare(right.created_at),
          )
          .at(-1);
        const latest = items
          .filter(
            (item) =>
              item.status === 'succeeded' &&
              item.result_summary?.startsWith('http'),
          )
          .sort((left, right) =>
            left.created_at.localeCompare(right.created_at),
          )
          .at(-1);
        if (!disposed && latest?.result_summary)
          setPreviewUrl(latest.result_summary);
        if (!disposed && latestActive) {
          setRunRequestType(latestActive.request_type);
          setRunId(latestActive.id);
          setRunControl(
            latestActive.status === 'paused' ? 'paused' : 'running',
          );
          setPhase(
            ['playtesting', 'evaluating', 'fixing'].includes(
              latestActive.status,
            )
              ? 'testing'
              : 'planning',
          );
          setMessage('已接管正在执行的 Run，继续读取 Agent 与 Unity Trace');
          setSubmitted(true);
        } else if (!disposed && latest?.result_summary) {
          setPreviewUrl(latest.result_summary);
          setRunRequestType(latest.request_type);
          setRunId(latest.id);
          setPhase('succeeded');
          setMessage('已恢复最近一次通过验证的 Unity Preview');
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (!disposed) setLoadingProject(false);
      });
    return () => {
      disposed = true;
    };
  }, [activeProjectId, resourceRevision, submitted, runId]);

  useEffect(() => {
    if (!activeProjectId) return;
    let disposed = false;
    void fetch(
      `/v1/projects/${encodeURIComponent(activeProjectId)}/versions?refresh=${resourceRevision}`,
    )
      .then(async (response) => {
        if (!response.ok) throw new Error('VERSIONS_LOAD_FAILED');
        const body: unknown = await response.json();
        const items =
          body &&
          typeof body === 'object' &&
          'items' in body &&
          Array.isArray(body.items)
            ? body.items.filter(
                (
                  item,
                ): item is {
                  id: string;
                  summary: string;
                  status: string;
                  createdAt: string;
                } =>
                  Boolean(
                    item &&
                      typeof item === 'object' &&
                      'id' in item &&
                      'summary' in item &&
                      'status' in item &&
                      'createdAt' in item,
                  ),
              )
            : [];
        if (!disposed) setVersions(items);
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
    };
  }, [activeProjectId, resourceRevision]);

  useEffect(() => {
    if (!activeProjectId) return;
    let disposed = false;
    void fetch(
      `/v1/projects/${encodeURIComponent(activeProjectId)}/assets?refresh=${resourceRevision}`,
    )
      .then(async (response) => {
        if (!response.ok) throw new Error('ASSETS_LOAD_FAILED');
        const body: unknown = await response.json();
        const items =
          body &&
          typeof body === 'object' &&
          'items' in body &&
          Array.isArray(body.items)
            ? body.items.filter(
                (
                  item,
                ): item is { id: string; name: string; importStatus: string } =>
                  Boolean(
                    item &&
                      typeof item === 'object' &&
                      'id' in item &&
                      typeof item.id === 'string' &&
                      'name' in item &&
                      typeof item.name === 'string' &&
                      'importStatus' in item &&
                      typeof item.importStatus === 'string',
                  ),
              )
            : [];
        if (!disposed) setAssets(items);
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
    };
  }, [activeProjectId, resourceRevision]);

  async function restoreVersion(id: string): Promise<void> {
    if (
      !activeProjectId ||
      submitted ||
      mutationPending.current ||
      loadingProject
    )
      return;
    mutationPending.current = true;
    activePoll.current?.abort();
    setRunId(undefined);
    setSubmitted(true);
    setPhase('planning');
    setMessage('正在恢复版本并重新运行 Unity 验证…');
    setFailure(undefined);
    setFailureIntent('error');
    setRunControl('running');
    setCompletedTaskIds([]);
    setTotalTasks(0);
    setAgentEvents([]);
    setRunEvents([]);
    setRunTrace(undefined);
    eventCursor.current = 0;
    completedTaskIdsRef.current = [];
    totalTasksRef.current = 0;
    try {
      const response = await fetch(
        `/v1/projects/${encodeURIComponent(activeProjectId)}/versions/${encodeURIComponent(id)}/restore`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'Idempotency-Key': crypto.randomUUID(),
          },
          body: '{}',
        },
      );
      if (!response.ok)
        throw new Error(`VERSION_RESTORE_FAILED_${response.status}`);
      const body: unknown = await response.json();
      const rollbackRunId =
        body &&
        typeof body === 'object' &&
        'id' in body &&
        typeof body.id === 'string'
          ? body.id
          : undefined;
      if (!rollbackRunId) throw new Error('VERSION_RESTORE_RUN_ID_MISSING');
      setRunRequestType('rollback');
      setRunId(rollbackRunId);
    } catch (error) {
      const rawMessage =
        error instanceof Error ? error.message : '版本恢复失败';
      const presentation = describeRunFailure({
        code: rawMessage,
        message: rawMessage,
      });
      setPhase('failed');
      setFailure(presentation.message);
      setFailureIntent(presentation.intent);
      setMessage(presentation.title);
      setSubmitted(false);
    } finally {
      mutationPending.current = false;
    }
  }

  async function uploadAsset(file: File): Promise<void> {
    if (!activeProjectId) {
      setFailure('请先创建或打开一个项目');
      return;
    }
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error('素材不能超过 5 MiB');
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = '';
      for (const byte of bytes) binary += String.fromCharCode(byte);
      const response = await fetch(
        `/v1/projects/${encodeURIComponent(activeProjectId)}/assets`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            name: file.name,
            mime_type: file.type,
            bytes_base64: btoa(binary),
            license_text: 'creator_attested_upload_authorization',
          }),
        },
      );
      if (!response.ok)
        throw new Error(`ASSET_UPLOAD_FAILED_${response.status}`);
      const asset: unknown = await response.json();
      if (
        !asset ||
        typeof asset !== 'object' ||
        !('id' in asset) ||
        typeof asset.id !== 'string' ||
        !('name' in asset) ||
        typeof asset.name !== 'string' ||
        !('importStatus' in asset) ||
        typeof asset.importStatus !== 'string'
      )
        throw new Error('ASSET_RESPONSE_INVALID');
      const uploadedAsset = asset as {
        id: string;
        name: string;
        importStatus: string;
      };
      setAssets((current) => [
        ...current.filter((item) => item.id !== uploadedAsset.id),
        {
          id: uploadedAsset.id,
          name: uploadedAsset.name,
          importStatus: uploadedAsset.importStatus,
        },
      ]);
      setMessage('素材已上传，等待安全检查和 Unity 导入');
    } catch (error) {
      setFailure(error instanceof Error ? error.message : '素材上传失败');
    }
  }

  async function replaceAsset(assetId: string): Promise<void> {
    if (submitted || mutationPending.current || loadingProject) return;
    if (!activeProjectId) {
      setFailure('请先创建或打开一个项目');
      return;
    }
    mutationPending.current = true;
    activePoll.current?.abort();
    setRunId(undefined);
    setSubmitted(true);
    try {
      const response = await fetch(
        `/v1/projects/${encodeURIComponent(activeProjectId)}/assets/${encodeURIComponent(assetId)}/replace`,
        {
          method: 'POST',
          headers: {
            'Idempotency-Key': crypto.randomUUID(),
          },
        },
      );
      if (!response.ok)
        throw new Error(`ASSET_REPLACE_FAILED_${response.status}`);
      const body: unknown = await response.json();
      if (
        !body ||
        typeof body !== 'object' ||
        !('id' in body) ||
        typeof body.id !== 'string'
      )
        throw new Error('ASSET_REPLACE_RUN_ID_MISSING');
      setRunRequestType('modify');
      setRunId(body.id);
      setPhase('planning');
      setMessage('正在准备角色素材替换…');
      setFailure(undefined);
      setSubmitted(true);
      eventCursor.current = 0;
      completedTaskIdsRef.current = [];
      totalTasksRef.current = 0;
      setCompletedTaskIds([]);
      setTotalTasks(0);
      setAgentEvents([]);
      setRunEvents([]);
      setRunTrace(undefined);
    } catch (error) {
      setFailure(error instanceof Error ? error.message : '角色素材替换失败');
      setSubmitted(false);
    } finally {
      mutationPending.current = false;
    }
  }

  function updateRunControl(next: 'running' | 'paused' | 'cancelled') {
    if (!activeProjectId || !runId) return;
    const action =
      next === 'paused' ? 'pause' : next === 'cancelled' ? 'cancel' : 'resume';
    void fetch(
      `/v1/projects/${encodeURIComponent(activeProjectId)}/runs/${encodeURIComponent(runId)}/${action}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason: 'creator_request' }),
      },
    )
      .then(async (response) => {
        if (!response.ok) throw new Error(`RUN_${action.toUpperCase()}_FAILED`);
        const body = (await response.json()) as { status?: string };
        const pendingPause = body.status === 'pause_requested';
        setRunControl(pendingPause ? 'pausing' : next);
        setMessage(
          pendingPause
            ? '正在等待当前操作完成后暂停…'
            : next === 'paused'
              ? '已在安全边界暂停'
              : next === 'cancelled'
                ? '已取消本次运行'
                : '已恢复运行',
        );
      })
      .catch((error: unknown) =>
        setFailure(error instanceof Error ? error.message : '运行控制失败'),
      );
  }

  const navigationStatus =
    serviceReady === undefined
      ? 'checking'
      : serviceReady === false
        ? 'offline'
        : runtimeSnapshot?.status === 'degraded'
          ? 'degraded'
          : 'ready';
  const activeStep =
    phase === 'queued'
      ? 0
      : phase === 'planning'
        ? 1
        : phase === 'testing'
          ? 2
          : 3;
  const runIsActive =
    submitted && (phase === 'planning' || phase === 'testing');

  return (
    <>
      <StudioNav active="create" status={navigationStatus} />
      <main
        className="studio-page"
        data-client-ready={clientReady ? 'true' : 'false'}
      >
        <section className="hero" aria-labelledby="studio-title">
          <div className="hero__copy">
            <p className="eyebrow">Neural game studio / 001</p>
            <h1 className="hero__title" id="studio-title">
              <span className="sr-only">GamerHub：</span>
              把想象，<span>编译成世界。</span>
            </h1>
            <p className="hero__description">
              描述你的玩法，其余交给智能创作引擎。我们会将自然语言转译为
              <strong> 可运行、可修改、可追溯 </strong>的 Unity 2D 游戏。
            </p>
            <ul className="tech-tags" aria-label="平台能力">
              <li className="tech-tag">AI DIRECTOR</li>
              <li className="tech-tag">UNITY RUNTIME</li>
              <li className="tech-tag">LIVE PREVIEW</li>
            </ul>
            <div className="hero__project-context">
              <span>{activeProjectId ? 'ACTIVE PROJECT' : 'NEW SESSION'}</span>
              <strong>
                {activeProjectId
                  ? `#${activeProjectId.slice(0, 8)}`
                  : '等待第一条创作指令'}
              </strong>
            </div>
          </div>
          <div className="hero__visual" aria-hidden="true">
            <div className="orbit">
              <span className="orbit__ring orbit__ring--a" />
              <span className="orbit__ring orbit__ring--b" />
              <span className="orbit__axis" />
              <span className="orbit__core">GH</span>
            </div>
            <span className="orbit__label">
              <small>GENERATION CORE</small>
              <strong>READY / 01</strong>
            </span>
          </div>
        </section>

        <RuntimeReadiness snapshot={runtimeSnapshot} />

        <ol className="workflow-rail" aria-label="创作流程">
          {[
            ['01', '描述玩法', '自然语言输入'],
            ['02', 'Agent 编排', '计划与受控工具'],
            ['03', 'Unity 验证', '编译、测试与构建'],
            ['04', '即时试玩', 'WebGL Preview'],
          ].map(([index, title, description], step) => (
            <li
              key={index}
              data-state={
                phase === 'failed' && step === activeStep
                  ? 'danger'
                  : step < activeStep || phase === 'succeeded'
                    ? 'complete'
                    : step === activeStep
                      ? 'active'
                      : 'pending'
              }
            >
              <span>{index}</span>
              <strong>{title}</strong>
              <small>{description}</small>
            </li>
          ))}
        </ol>

        <div className="workbench-grid">
          <section className="panel panel--primary" aria-label="创作控制台">
            <header className="panel__header">
              <div className="panel__heading">
                <span className="panel__heading-icon">
                  <UiIcon name="spark" />
                </span>
                <span className="panel__title-group">
                  <span className="panel__kicker">Creation console</span>
                  <h2 className="panel__title">描述你的游戏世界</h2>
                </span>
              </div>
              <span className="panel__index">
                <strong>01</strong> / INPUT
              </span>
            </header>

            <form
              className="creation-form"
              aria-label="创作对话"
              onSubmit={submit}
            >
              <label className="field-label" htmlFor="game-description">
                游戏描述 <span>NL PROMPT / UTF-8</span>
              </label>
              <div className="prompt-field">
                <textarea
                  id="game-description"
                  aria-label="游戏描述"
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  placeholder="例如：做一个可以跳跃、躲避障碍物、收集金币的猫咪跑酷游戏。"
                  rows={4}
                />
                <span className="prompt-field__meta">
                  <span aria-live="polite">
                    {serviceReady === undefined
                      ? '正在连接创作服务'
                      : serviceReady
                        ? '创作服务已就绪'
                        : '创作服务未连接，请运行 pnpm dev'}
                  </span>
                  <span>{prompt.length.toString().padStart(3, '0')} CHARS</span>
                </span>
              </div>
              <fieldset className="prompt-suggestions">
                <legend className="sr-only">创意提示</legend>
                {['赛博城市跑酷', '太空采矿冒险', '像素塔防生存'].map(
                  (suggestion) => (
                    <button
                      className="suggestion-chip"
                      key={suggestion}
                      type="button"
                      onClick={() => setPrompt(suggestion)}
                    >
                      + {suggestion}
                    </button>
                  ),
                )}
              </fieldset>
              <button
                className="primary-action"
                type="submit"
                disabled={
                  !clientReady ||
                  loadingProject ||
                  serviceReady !== true ||
                  !prompt.trim() ||
                  submitted
                }
              >
                {submitted
                  ? 'Agent 正在创作'
                  : phase === 'failed'
                    ? '重新尝试'
                    : previewUrl
                      ? '应用修改'
                      : '开始创作'}{' '}
                <UiIcon name="arrow" />
              </button>
            </form>

            <RunProgress
              phase={phase}
              message={message}
              completedTasks={completedTaskIds.length}
              totalTasks={totalTasks}
              terminal={phase === 'succeeded' || phase === 'failed'}
            />
            <section className="run-controls" aria-label="运行控制">
              <button
                className="control-button"
                type="button"
                onClick={() => updateRunControl('paused')}
                disabled={!runIsActive || !runId || runControl !== 'running'}
              >
                <UiIcon name="pause" /> 暂停
              </button>
              <button
                className="control-button"
                type="button"
                onClick={() => updateRunControl('running')}
                disabled={!runIsActive || !runId || runControl !== 'paused'}
              >
                <UiIcon name="play" /> 恢复
              </button>
              <button
                className="control-button control-button--danger"
                type="button"
                onClick={() => updateRunControl('cancelled')}
                disabled={!runIsActive || !runId || runControl === 'cancelled'}
              >
                <UiIcon name="stop" /> 取消
              </button>
            </section>
          </section>

          <section className="panel preview-panel" aria-label="游戏预览面板">
            <header className="panel__header">
              <div className="panel__heading">
                <span className="panel__heading-icon">
                  <UiIcon name="gamepad" />
                </span>
                <span className="panel__title-group">
                  <span className="panel__kicker">Runtime viewport</span>
                  <h2 className="panel__title">实时游戏预览</h2>
                </span>
              </div>
              <span
                className={`preview-status${phase === 'succeeded' ? ' is-live' : ''}`}
              >
                {phase === 'succeeded' ? 'LIVE' : 'STANDBY'}
              </span>
              {previewUrl ? (
                <a
                  className="preview-popout"
                  href={previewUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  独立试玩 <UiIcon name="arrow" />
                </a>
              ) : null}
            </header>
            {previewUrl ? (
              <GamePreview status="ready" previewUrl={previewUrl} />
            ) : phase === 'failed' ? (
              <GamePreview
                status="error"
                {...(failure ? { error: failure } : {})}
              />
            ) : (
              <GamePreview status={phase === 'queued' ? 'empty' : 'loading'} />
            )}
          </section>

          <RunJourney
            requestType={runRequestType}
            phase={phase}
            events={runEvents}
            {...(runTrace ? { traceId: runTrace.traceId } : {})}
            previewReady={phase === 'succeeded' && Boolean(previewUrl)}
          />

          {agentEvents.length > 0 || runTrace ? (
            <RunTrace
              events={agentEvents}
              {...(runTrace ? { trace: runTrace } : {})}
            />
          ) : null}

          {phase === 'succeeded' && previewUrl ? (
            <>
              <RevisionMessage
                intent={runRequestType === 'create' ? 'accepted' : 'modify'}
                summary={
                  runRequestType === 'rollback'
                    ? '已恢复目标版本并重新通过 Unity 验证。'
                    : runRequestType === 'modify'
                      ? '已完成局部修改。'
                      : '已完成 Runner 游戏创建。'
                }
              />
              <RunOutcome status="succeeded" unresolvedIssues={[]} />
            </>
          ) : phase === 'failed' ? (
            <>
              <RevisionMessage
                intent={failureIntent}
                summary={failure ?? '运行失败'}
              />
              <RunOutcome status="failed" unresolvedIssues={[]} />
            </>
          ) : null}
        </div>

        <div className="resource-grid">
          <AssetLibrary
            disabled={submitted || loadingProject}
            assets={assets}
            onUpload={(file) => void uploadAsset(file)}
            onReplace={(assetId) => void replaceAsset(assetId)}
          />
          <div className="panel resource-panel">
            <VersionHistory
              versions={versions}
              onRestore={restoreVersion}
              disabled={submitted}
            />
            <div className="version-tools">
              <UndoAction
                onConfirm={() => {
                  const previous = versions.at(-2);
                  if (previous) restoreVersion(previous.id);
                  else setMessage('当前没有可恢复的版本');
                }}
              />
            </div>
          </div>
        </div>
      </main>
    </>
  );
}
