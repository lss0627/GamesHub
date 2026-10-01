import {
  decodeRunWakeup,
  encodeRunWakeup,
  probePostgres,
} from '@gamerhub/runtime-infra';
import { describe, expect, it } from 'vitest';

describe('runtime infrastructure probes', () => {
  it('accepts only the complete migration set and a live query', async () => {
    const queries: string[] = [];
    const result = await probePostgres({
      query: async (text) => {
        queries.push(text);
        return text.includes('schema_migrations')
          ? { rows: [{ migration_count: 10 }] }
          : { rows: [{ healthy: 1 }] };
      },
    });

    expect(result).toMatchObject({
      status: 'ready',
      detail: 'source-of-truth',
      migrationCount: 10,
      requiredMigrationCount: 10,
    });
    expect(queries).toHaveLength(2);
  });

  it('fails closed when migrations are incomplete', async () => {
    const result = await probePostgres({
      query: async () => ({ rows: [{ migration_count: 8 }] }),
    });

    expect(result).toMatchObject({
      status: 'degraded',
      detail: 'migrations-incomplete',
      migrationCount: 8,
      requiredMigrationCount: 10,
    });
  });

  it('returns a safe diagnostic when the connection fails', async () => {
    const result = await probePostgres({
      query: async () => {
        throw new Error('password=must-not-leak');
      },
    });

    expect(result).toMatchObject({
      status: 'degraded',
      detail: 'connection-or-schema-unavailable',
    });
    expect(JSON.stringify(result)).not.toContain('must-not-leak');
  });

  it('encodes a versioned Redis wakeup envelope with trace context', () => {
    const traceId = '1234567890abcdef1234567890abcdef';
    const encoded = encodeRunWakeup('run-123', traceId);
    expect(decodeRunWakeup(encoded)).toMatchObject({
      schemaVersion: '1.0.0',
      runId: 'run-123',
      traceId,
    });
    expect(decodeRunWakeup('run-123')).toBeUndefined();
  });
});
