import {
  AssetRepository,
  HttpAssetScanner,
  HttpImageDecoder,
  PostgresAssetMetadataStore,
  S3ObjectStore,
} from '@gamerhub/assets';
import { PostgresDomainRepository } from '@gamerhub/domain';
import { GameSpecService } from '@gamerhub/game-spec';
import { PostgresGameSpecPersistence } from '@gamerhub/orchestrator-worker';
import {
  type DependencyProbe,
  probePostgres,
  RedisRunSignal,
} from '@gamerhub/runtime-infra';
import {
  type CheckpointService,
  MetadataCheckpointService,
  PostgresCheckpointMetadataStore,
} from '@gamerhub/versioning';

export interface PostgresRedisDataPlaneHealth {
  mode: 'postgres-redis';
  authoritativeStore: 'postgresql';
  wakeupTransport: 'redis-pubsub';
  durableFallback: 'postgresql-skip-locked';
  postgres: DependencyProbe & { migrationCount?: number };
  redis: DependencyProbe;
  objectStorage: DependencyProbe;
}

export interface PostgresRedisDataPlane {
  store: PostgresDomainRepository;
  specService: GameSpecService;
  checkpointService: CheckpointService;
  assetRepository: AssetRepository;
  runSignal: RedisRunSignal;
  health(): Promise<PostgresRedisDataPlaneHealth>;
  close(): Promise<void>;
}

function required(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name];
  if (!value?.trim()) throw new Error(`${name}_REQUIRED`);
  return value;
}

async function probeObjectStorage(endpoint: string): Promise<DependencyProbe> {
  const startedAt = Date.now();
  try {
    const response = await fetch(
      `${endpoint.replace(/\/$/, '')}/minio/health/live`,
      { signal: AbortSignal.timeout(3_000) },
    );
    return {
      status: response.ok ? 'ready' : 'degraded',
      latencyMs: Date.now() - startedAt,
      detail: response.ok ? 's3-compatible-store' : `http-${response.status}`,
    };
  } catch {
    return {
      status: 'degraded',
      latencyMs: Date.now() - startedAt,
      detail: 'connection-unavailable',
    };
  }
}

export async function createPostgresRedisDataPlane(
  supportOrigin: string,
  ownerId: string,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<PostgresRedisDataPlane> {
  const store = PostgresDomainRepository.fromConnectionString(
    required(environment, 'DATABASE_URL'),
  );
  let runSignal: RedisRunSignal | undefined;
  try {
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        ownerId,
      )
    )
      throw new Error('LOCAL_USER_ID_INVALID');
    const postgres = await probePostgres(store.pool);
    if (postgres.status !== 'ready')
      throw new Error(`POSTGRES_NOT_READY:${postgres.detail}`);
    await store.pool.query(
      `INSERT INTO users (id, email, display_name, status, role)
       VALUES ($1, $2, 'Local Creator', 'active', 'creator')
       ON CONFLICT (id) DO UPDATE
       SET display_name = EXCLUDED.display_name,
           status = EXCLUDED.status,
           role = EXCLUDED.role`,
      [ownerId, `local-${ownerId}@gamerhub.invalid`],
    );
    runSignal = await RedisRunSignal.connect(
      required(environment, 'REDIS_URL'),
    );
    const redis = await runSignal.probe();
    if (redis.status !== 'ready')
      throw new Error(`REDIS_NOT_READY:${redis.detail}`);
    const endpoint = required(environment, 'OBJECT_STORAGE_ENDPOINT');
    const objectStorage = await probeObjectStorage(endpoint);
    if (objectStorage.status !== 'ready')
      throw new Error(`OBJECT_STORAGE_NOT_READY:${objectStorage.detail}`);
    const objectStore = new S3ObjectStore({
      endpoint,
      region: required(environment, 'OBJECT_STORAGE_REGION'),
      bucket: required(environment, 'OBJECT_STORAGE_BUCKET'),
      accessKeyId: required(environment, 'OBJECT_STORAGE_ACCESS_KEY'),
      secretAccessKey: required(environment, 'OBJECT_STORAGE_SECRET_KEY'),
    });
    const assetRepository = new AssetRepository({
      ownerId,
      objectStore,
      metadataStore: new PostgresAssetMetadataStore(
        store.pool,
        store.withTenantTransaction.bind(store),
      ),
      // The HTTP clients append /scan and /decode themselves.
      scanner: new HttpAssetScanner({ endpoint: supportOrigin }),
      decoder: new HttpImageDecoder({ endpoint: supportOrigin }),
    });
    const connectedSignal = runSignal;
    return {
      store,
      specService: new GameSpecService(new PostgresGameSpecPersistence(store)),
      checkpointService: new MetadataCheckpointService(
        new PostgresCheckpointMetadataStore(store.pool, {
          ownerId,
          tenantTransaction: store.withTenantTransaction.bind(store),
        }),
      ),
      assetRepository,
      runSignal: connectedSignal,
      health: async () => ({
        mode: 'postgres-redis',
        authoritativeStore: 'postgresql',
        wakeupTransport: 'redis-pubsub',
        durableFallback: 'postgresql-skip-locked',
        postgres: await probePostgres(store.pool),
        redis: await connectedSignal.probe(),
        objectStorage: await probeObjectStorage(endpoint),
      }),
      close: async () => {
        await Promise.allSettled([connectedSignal.close(), store.close()]);
      },
    };
  } catch (error) {
    await Promise.allSettled([runSignal?.close(), store.close()]);
    throw error;
  }
}
