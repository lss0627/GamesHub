import { createHash, randomUUID } from 'node:crypto';
import { createClient } from 'redis';

export type DependencyStatus = 'ready' | 'degraded' | 'bypassed';

export interface DependencyProbe {
  status: DependencyStatus;
  latencyMs: number;
  detail: string;
}

export interface PostgresProbe extends DependencyProbe {
  migrationCount?: number;
  requiredMigrationCount?: number;
}

const requiredMigrations = [
  '001_core_state.sql',
  '002_execution_state.sql',
  '003_tenant_security.sql',
  '004_event_outbox.sql',
  '005_spec_run_idempotency.sql',
  '006_preview_idempotency.sql',
  '007_end_to_end_trace.sql',
  '008_trace_event_outbox.sql',
  '009_build_identity.sql',
  '010_design_conversations.sql',
] as const;

interface QueryExecutor {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<{ rows: Row[] }>;
}

function latency(startedAt: number): number {
  return Math.max(0, Date.now() - startedAt);
}

export async function probePostgres(
  executor: QueryExecutor,
): Promise<PostgresProbe> {
  const startedAt = Date.now();
  try {
    const result = await executor.query<{ migration_count: number }>(
      `SELECT COUNT(*)::int AS migration_count
       FROM schema_migrations
       WHERE filename = ANY($1::text[])`,
      [requiredMigrations],
    );
    const migrationCount = Number(result.rows[0]?.migration_count ?? 0);
    const requiredMigrationCount = requiredMigrations.length;
    if (migrationCount !== requiredMigrationCount)
      return {
        status: 'degraded',
        latencyMs: latency(startedAt),
        detail: 'migrations-incomplete',
        migrationCount,
        requiredMigrationCount,
      };
    await executor.query('SELECT 1 AS healthy');
    return {
      status: 'ready',
      latencyMs: latency(startedAt),
      detail: 'source-of-truth',
      migrationCount,
      requiredMigrationCount,
    };
  } catch {
    return {
      status: 'degraded',
      latencyMs: latency(startedAt),
      detail: 'connection-or-schema-unavailable',
    };
  }
}

interface RedisClient {
  readonly isReady: boolean;
  connect(): Promise<unknown>;
  on(event: 'error', listener: () => void): unknown;
  publish(channel: string, message: string): Promise<number>;
  subscribe(
    channel: string,
    listener: (message: string) => void,
  ): Promise<unknown>;
  unsubscribe(channel: string): Promise<unknown>;
  set(key: string, value: string, options: { EX: number }): Promise<unknown>;
  get(key: string): Promise<string | null>;
  del(key: string): Promise<number>;
  close(): Promise<unknown>;
  destroy(): void;
}

export interface RunWakeupEnvelope {
  schemaVersion: '1.0.0';
  runId: string;
  traceId: string;
  occurredAt: string;
}

function fallbackTraceId(runId: string): string {
  return createHash('sha256').update(runId).digest('hex').slice(0, 32);
}

export function encodeRunWakeup(
  runId: string,
  traceId = fallbackTraceId(runId),
): string {
  if (!runId.trim() || !/^[0-9a-f]{32}$/.test(traceId))
    throw new Error('RUN_WAKEUP_INVALID');
  return JSON.stringify({
    schemaVersion: '1.0.0',
    runId,
    traceId,
    occurredAt: new Date().toISOString(),
  } satisfies RunWakeupEnvelope);
}

export function decodeRunWakeup(value: string): RunWakeupEnvelope | undefined {
  try {
    const decoded: unknown = JSON.parse(value);
    if (!decoded || typeof decoded !== 'object') return undefined;
    const envelope = decoded as Partial<RunWakeupEnvelope>;
    if (
      envelope.schemaVersion !== '1.0.0' ||
      typeof envelope.runId !== 'string' ||
      !envelope.runId.trim() ||
      typeof envelope.traceId !== 'string' ||
      !/^[0-9a-f]{32}$/.test(envelope.traceId) ||
      typeof envelope.occurredAt !== 'string' ||
      !Number.isFinite(Date.parse(envelope.occurredAt))
    )
      return undefined;
    return envelope as RunWakeupEnvelope;
  } catch {
    return undefined;
  }
}

export class RedisRunSignal {
  private readonly command: RedisClient;
  private readonly subscriber: RedisClient;
  private readonly waiters = new Set<() => void>();
  private lastWakeup: RunWakeupEnvelope | undefined;
  private closed = false;

  private constructor(
    command: RedisClient,
    subscriber: RedisClient,
    private readonly channel: string,
  ) {
    this.command = command;
    this.subscriber = subscriber;
  }

  static async connect(
    url: string,
    channel = 'gamerhub:runs:accepted',
  ): Promise<RedisRunSignal> {
    if (!/^rediss?:\/\//.test(url)) throw new Error('REDIS_URL_INVALID');
    const socket = {
      connectTimeout: 3_000,
      reconnectStrategy: (retries: number) => Math.min(1_000, retries * 100),
    };
    const command = createClient({ url, socket }) as unknown as RedisClient;
    const subscriber = createClient({ url, socket }) as unknown as RedisClient;
    command.on('error', () => undefined);
    subscriber.on('error', () => undefined);
    try {
      await Promise.all([command.connect(), subscriber.connect()]);
      const signal = new RedisRunSignal(command, subscriber, channel);
      await subscriber.subscribe(channel, (message) => {
        signal.lastWakeup = decodeRunWakeup(message);
        signal.releaseWaiters();
      });
      return signal;
    } catch (error) {
      command.destroy();
      subscriber.destroy();
      throw error;
    }
  }

  async notify(runId: string, traceId?: string): Promise<boolean> {
    if (this.closed || !this.command.isReady) return false;
    try {
      await this.command.publish(this.channel, encodeRunWakeup(runId, traceId));
      return true;
    } catch {
      return false;
    }
  }

  latestWakeup(): RunWakeupEnvelope | undefined {
    return this.lastWakeup ? structuredClone(this.lastWakeup) : undefined;
  }

  async wait(timeoutMs: number, signal?: AbortSignal): Promise<void> {
    if (this.closed || signal?.aborted) return;
    await new Promise<void>((resolve) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const finish = (): void => {
        if (timer) clearTimeout(timer);
        this.waiters.delete(finish);
        signal?.removeEventListener('abort', finish);
        resolve();
      };
      this.waiters.add(finish);
      signal?.addEventListener('abort', finish, { once: true });
      timer = setTimeout(finish, Math.max(1, timeoutMs));
    });
  }

  async probe(): Promise<DependencyProbe> {
    const startedAt = Date.now();
    if (this.closed || !this.command.isReady)
      return {
        status: 'degraded',
        latencyMs: latency(startedAt),
        detail: 'connection-unavailable',
      };
    const key = `gamerhub:health:${randomUUID()}`;
    const value = randomUUID();
    try {
      await this.command.set(key, value, { EX: 5 });
      const observed = await this.command.get(key);
      await this.command.del(key);
      return {
        status: observed === value ? 'ready' : 'degraded',
        latencyMs: latency(startedAt),
        detail:
          observed === value ? 'ephemeral-wakeup' : 'read-after-write-failed',
      };
    } catch {
      return {
        status: 'degraded',
        latencyMs: latency(startedAt),
        detail: 'read-write-probe-failed',
      };
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.releaseWaiters();
    await Promise.allSettled([
      this.subscriber.unsubscribe(this.channel),
      this.command.close(),
      this.subscriber.close(),
    ]);
  }

  private releaseWaiters(): void {
    for (const waiter of [...this.waiters]) waiter();
  }
}
