import { UiIcon } from '../../components/UiIcon';

type RuntimeStatus = 'ready' | 'degraded' | 'blocked' | 'bypassed';

interface DependencySnapshot {
  status: RuntimeStatus;
  latencyMs?: number;
  detail?: string;
  migrationCount?: number;
  requiredMigrationCount?: number;
}

export interface RuntimeSnapshot {
  status: 'ready' | 'degraded' | 'blocked';
  executionMode?: string;
  dataPlane?: {
    mode?: string;
    authoritativeStore?: string;
    wakeupTransport?: string;
    durableFallback?: string;
    postgres?: DependencySnapshot;
    redis?: DependencySnapshot;
    objectStorage?: DependencySnapshot;
  };
  services?: {
    agent?: DependencySnapshot & { runtime?: string; version?: string };
    model?: DependencySnapshot & { provider?: string; model?: string };
    images?: DependencySnapshot & {
      provider?: string;
      model?: string;
      optional?: boolean;
      configurationOnly?: boolean;
      builtinAvailable?: boolean;
    };
    unity?: DependencySnapshot & { version?: string };
  };
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function status(value: unknown): RuntimeStatus {
  return ['ready', 'degraded', 'blocked', 'bypassed'].includes(String(value))
    ? (value as RuntimeStatus)
    : 'bypassed';
}

function dependency(value: unknown): DependencySnapshot {
  const source = record(value);
  return {
    status: status(source.status),
    ...(typeof source.latencyMs === 'number'
      ? { latencyMs: source.latencyMs }
      : {}),
    ...(typeof source.detail === 'string' ? { detail: source.detail } : {}),
    ...(typeof source.migrationCount === 'number'
      ? { migrationCount: source.migrationCount }
      : {}),
    ...(typeof source.requiredMigrationCount === 'number'
      ? { requiredMigrationCount: source.requiredMigrationCount }
      : {}),
  };
}

export function runtimeSnapshotFromUnknown(
  value: unknown,
): RuntimeSnapshot | undefined {
  const source = record(value);
  if (!['ready', 'degraded', 'blocked'].includes(String(source.status)))
    return undefined;
  const dataPlane = record(source.dataPlane);
  const services = record(source.services);
  const model = record(services.model);
  const images = record(services.images);
  const agent = record(services.agent);
  const unity = record(services.unity);
  return {
    status: source.status as RuntimeSnapshot['status'],
    ...(typeof source.executionMode === 'string'
      ? { executionMode: source.executionMode }
      : {}),
    dataPlane: {
      ...(typeof dataPlane.mode === 'string' ? { mode: dataPlane.mode } : {}),
      ...(typeof dataPlane.authoritativeStore === 'string'
        ? { authoritativeStore: dataPlane.authoritativeStore }
        : {}),
      ...(typeof dataPlane.wakeupTransport === 'string'
        ? { wakeupTransport: dataPlane.wakeupTransport }
        : {}),
      ...(typeof dataPlane.durableFallback === 'string'
        ? { durableFallback: dataPlane.durableFallback }
        : {}),
      postgres: dependency(dataPlane.postgres),
      redis: dependency(dataPlane.redis),
      objectStorage: dependency(dataPlane.objectStorage),
    },
    services: {
      agent: {
        ...dependency(agent),
        ...(typeof agent.runtime === 'string'
          ? { runtime: agent.runtime }
          : {}),
        ...(typeof agent.version === 'string'
          ? { version: agent.version }
          : {}),
      },
      model: {
        ...dependency(model),
        ...(typeof model.provider === 'string'
          ? { provider: model.provider }
          : {}),
        ...(typeof model.model === 'string' ? { model: model.model } : {}),
      },
      images: {
        ...dependency(images),
        ...(typeof images.provider === 'string'
          ? { provider: images.provider }
          : {}),
        ...(typeof images.model === 'string' ? { model: images.model } : {}),
        ...(typeof images.optional === 'boolean'
          ? { optional: images.optional }
          : {}),
        ...(typeof images.configurationOnly === 'boolean'
          ? { configurationOnly: images.configurationOnly }
          : {}),
        ...(typeof images.builtinAvailable === 'boolean'
          ? { builtinAvailable: images.builtinAvailable }
          : {}),
      },
      unity: {
        ...dependency(unity),
        ...(typeof unity.version === 'string'
          ? { version: unity.version }
          : {}),
      },
    },
  };
}

const stateCopy: Record<RuntimeStatus, string> = {
  ready: '已连接',
  degraded: '降级运行',
  blocked: '不可用',
  bypassed: '未启用',
};

function latencyLabel(value?: number): string {
  return typeof value === 'number' ? `${value} ms` : '—';
}

export function RuntimeReadiness(props: {
  snapshot?: RuntimeSnapshot | undefined;
}) {
  const snapshot = props.snapshot;
  const components = [
    {
      key: 'agent',
      label: 'AI AGENT',
      title: 'Pi 创作伙伴',
      icon: 'spark' as const,
      value: snapshot?.services?.agent,
      detail: snapshot?.services?.agent?.version
        ? `Pi ${snapshot.services.agent.version} · Python 托管`
        : '等待框架检查',
    },
    {
      key: 'model',
      label: 'AI MODEL',
      title: 'DeepSeek 推理',
      icon: 'spark' as const,
      value: snapshot?.services?.model,
      detail: snapshot?.services?.model?.model ?? '等待服务响应',
    },
    {
      key: 'images',
      label: 'OPTIONAL IMAGE MODEL',
      title: '外部生图（可选）',
      icon: 'spark' as const,
      value: snapshot?.services?.images,
      detail:
        snapshot?.services?.images?.status === 'ready'
          ? `${[snapshot.services.images.provider, snapshot.services.images.model].filter(Boolean).join(' · ') || '图片生成服务'} · 尚未验证连接`
          : snapshot?.services?.images?.status === 'blocked'
            ? '请检查生图配置；可先使用内置素材'
            : '可先使用内置素材，无需配置生图模型',
    },
    {
      key: 'postgres',
      label: 'SOURCE OF TRUTH',
      title: 'PostgreSQL',
      icon: 'database' as const,
      value: snapshot?.dataPlane?.postgres,
      detail: snapshot?.dataPlane?.postgres?.migrationCount
        ? `${snapshot.dataPlane.postgres.migrationCount}/${snapshot.dataPlane.postgres.requiredMigrationCount ?? '?'} migrations`
        : '项目 / Run / 事件',
    },
    {
      key: 'redis',
      label: 'WAKEUP BUS',
      title: 'Redis',
      icon: 'activity' as const,
      value: snapshot?.dataPlane?.redis,
      detail: 'Worker 低延迟唤醒',
    },
    {
      key: 'storage',
      label: 'ASSET PLANE',
      title: 'S3 / MinIO',
      icon: 'archive' as const,
      value: snapshot?.dataPlane?.objectStorage,
      detail: '资产对象与构建物',
    },
    {
      key: 'unity',
      label: 'ENGINE',
      title: 'Unity WebGL',
      icon: 'cube' as const,
      value: snapshot?.services?.unity,
      detail: snapshot?.services?.unity?.version ?? '等待引擎响应',
    },
  ];
  return (
    <section className="runtime-mesh" aria-label="系统运行状态">
      <header className="runtime-mesh__header">
        <span>
          <small>RUNTIME MESH / LIVE READINESS</small>
          <strong>创作链路</strong>
        </span>
        <span
          className="runtime-mesh__overall"
          data-status={snapshot?.status ?? 'bypassed'}
        >
          {snapshot
            ? snapshot.status === 'ready'
              ? 'ALL SYSTEMS NOMINAL'
              : snapshot.status === 'degraded'
                ? 'FALLBACK ACTIVE'
                : 'ACTION REQUIRED'
            : 'CONNECTING'}
        </span>
      </header>
      <div className="runtime-mesh__grid">
        {components.map((component) => {
          const componentStatus = component.value?.status ?? 'bypassed';
          return (
            <article key={component.key} data-status={componentStatus}>
              <span className="runtime-mesh__icon">
                <UiIcon name={component.icon} />
              </span>
              <span className="runtime-mesh__copy">
                <small>{component.label}</small>
                <strong>{component.title}</strong>
                <span>{component.detail}</span>
              </span>
              <span className="runtime-mesh__metric">
                <i aria-hidden="true" />
                <strong>
                  {component.key === 'images'
                    ? componentStatus === 'ready'
                      ? '配置已检测'
                      : componentStatus === 'blocked'
                        ? '配置需检查'
                        : '内置素材可用'
                    : stateCopy[componentStatus]}
                </strong>
                <small>{latencyLabel(component.value?.latencyMs)}</small>
              </span>
            </article>
          );
        })}
      </div>
      <footer className="runtime-mesh__contract">
        <span>
          FACTS · {snapshot?.dataPlane?.authoritativeStore ?? 'checking'}
        </span>
        <span aria-hidden="true">→</span>
        <span>WAKE · {snapshot?.dataPlane?.wakeupTransport ?? 'checking'}</span>
        <span aria-hidden="true">→</span>
        <span>
          FALLBACK · {snapshot?.dataPlane?.durableFallback ?? 'checking'}
        </span>
        <span className="runtime-mesh__mode">
          {snapshot?.executionMode ?? 'runtime pending'}
        </span>
      </footer>
    </section>
  );
}
