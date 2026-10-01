import { randomUUID } from 'node:crypto';
import { PostgresDomainRepository } from '@gamerhub/domain';
import { probePostgres, RedisRunSignal } from '@gamerhub/runtime-infra';
import { loadEnvironmentFile } from './dev-env';

loadEnvironmentFile();

function required(name: string): string {
  const value = process.env[name];
  if (!value?.trim()) throw new Error(`${name}_REQUIRED`);
  return value;
}

async function verifyPostgresTransaction(
  repository: PostgresDomainRepository,
): Promise<boolean> {
  const client = await repository.pool.connect();
  const marker = `infra-doctor-${randomUUID()}`;
  const ownerId = randomUUID();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO users (id, email, display_name, status, role)
       VALUES ($1, $2, 'Infrastructure Doctor', 'active', 'developer')`,
      [ownerId, `${marker}@gamerhub.invalid`],
    );
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO projects
        (owner_id, name, slug, workspace_repo_key, quota_profile)
       VALUES ($1, 'Infrastructure Doctor', $2, $3, 'diagnostic')
       RETURNING id`,
      [ownerId, marker, `diagnostics/${marker}`],
    );
    const id = inserted.rows[0]?.id;
    if (!id) throw new Error('POSTGRES_WRITE_PROBE_FAILED');
    const readBack = await client.query<{ id: string }>(
      'SELECT id FROM projects WHERE id = $1',
      [id],
    );
    await client.query('ROLLBACK');
    const persisted = await repository.pool.query(
      'SELECT 1 FROM projects WHERE id = $1',
      [id],
    );
    return readBack.rows[0]?.id === id && persisted.rows.length === 0;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function verifyRedisSignal(signal: RedisRunSignal): Promise<boolean> {
  const startedAt = Date.now();
  const waiting = signal.wait(2_000);
  setTimeout(() => void signal.notify(`doctor-${randomUUID()}`), 50);
  await waiting;
  return Date.now() - startedAt < 1_000;
}

async function objectStorageReady(endpoint: string): Promise<boolean> {
  try {
    const response = await fetch(
      `${endpoint.replace(/\/$/, '')}/minio/health/live`,
      { signal: AbortSignal.timeout(3_000) },
    );
    return response.ok;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const repository = PostgresDomainRepository.fromConnectionString(
    required('DATABASE_URL'),
  );
  let redis: RedisRunSignal | undefined;
  try {
    const postgres = await probePostgres(repository.pool);
    const postgresTransaction = await verifyPostgresTransaction(repository);
    redis = await RedisRunSignal.connect(required('REDIS_URL'));
    const redisReadWrite = await redis.probe();
    const redisSignal = await verifyRedisSignal(redis);
    const objectStorage = await objectStorageReady(
      required('OBJECT_STORAGE_ENDPOINT'),
    );
    const status =
      postgres.status === 'ready' &&
      postgresTransaction &&
      redisReadWrite.status === 'ready' &&
      redisSignal &&
      objectStorage
        ? 'ready'
        : 'blocked';
    console.log(
      JSON.stringify({
        status,
        postgres: {
          ...postgres,
          transactionWriteReadRollback: postgresTransaction,
        },
        redis: {
          ...redisReadWrite,
          pubSubWakeup: redisSignal,
          sourceOfTruth: false,
        },
        objectStorage: {
          status: objectStorage ? 'ready' : 'blocked',
          protocol: 's3-compatible',
        },
        secretsExposed: false,
      }),
    );
    if (status !== 'ready') process.exitCode = 1;
  } finally {
    await Promise.allSettled([redis?.close(), repository.close()]);
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
