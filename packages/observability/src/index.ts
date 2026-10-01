import { randomBytes } from 'node:crypto';

const sensitiveKey =
  /token|secret|password|api[_-]?key|license|credential|authorization|signed[_-]?url|host[_-]?path|absolute[_-]?path/i;

export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        sensitiveKey.test(key) ? '[REDACTED]' : redact(item),
      ]),
    );
  if (
    typeof value === 'string' &&
    (value.startsWith('secret://') || value.startsWith('Bearer '))
  )
    return '[REDACTED]';
  return value;
}

export interface LogRecord {
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  traceId?: string;
  runId?: string;
  fields?: Record<string, unknown>;
}
export interface StructuredLogger {
  write(record: LogRecord): void;
  child(fields: Record<string, unknown>): StructuredLogger;
}
export class MemoryLogger implements StructuredLogger {
  readonly records: LogRecord[] = [];
  constructor(private readonly base: Record<string, unknown> = {}) {}
  write(record: LogRecord): void {
    this.records.push({
      ...record,
      fields: redact({ ...this.base, ...record.fields }) as Record<
        string,
        unknown
      >,
    });
  }
  child(fields: Record<string, unknown>): StructuredLogger {
    return new MemoryLogger({ ...this.base, ...fields });
  }
}
export function correlationFields(traceId: string, spanId?: string) {
  return { traceId, ...(spanId ? { spanId } : {}) };
}

const traceIdPattern = /^[0-9a-f]{32}$/;
const spanIdPattern = /^[0-9a-f]{16}$/;

export interface TraceContext {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
}

export function isTraceId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    traceIdPattern.test(value) &&
    value !== '00000000000000000000000000000000'
  );
}

export function isSpanId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    spanIdPattern.test(value) &&
    value !== '0000000000000000'
  );
}

export function createTraceId(): string {
  return randomBytes(16).toString('hex');
}

export function createSpanId(): string {
  return randomBytes(8).toString('hex');
}

export function parseTraceparent(
  value: string | undefined,
): TraceContext | undefined {
  if (!value) return undefined;
  const match = value
    .trim()
    .toLowerCase()
    .match(/^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/);
  if (!match || !isTraceId(match[1]) || !isSpanId(match[2])) return undefined;
  return {
    traceId: match[1],
    spanId: createSpanId(),
    parentSpanId: match[2],
  };
}

export function createTraceContext(
  traceparent?: string,
  fallbackTraceId?: string,
): TraceContext {
  const parsed = parseTraceparent(traceparent);
  if (parsed) return parsed;
  return {
    traceId: isTraceId(fallbackTraceId) ? fallbackTraceId : createTraceId(),
    spanId: createSpanId(),
  };
}

export function formatTraceparent(
  context: Pick<TraceContext, 'traceId' | 'spanId'>,
): string {
  if (!isTraceId(context.traceId) || !isSpanId(context.spanId))
    throw new Error('TRACE_CONTEXT_INVALID');
  return `00-${context.traceId}-${context.spanId}-01`;
}

export * from './build-provenance';
export * from './reliability';
