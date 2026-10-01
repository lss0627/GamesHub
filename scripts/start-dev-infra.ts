import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { ensureS3Bucket } from '../packages/assets/src/s3-object-store';
import { RedisRunSignal } from '../packages/runtime-infra/src';
import { loadEnvironmentFile } from './dev-env';

loadEnvironmentFile();

const composeFile = resolve('infra', 'compose', 'dev.yml');

function requireValue(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (!value) throw new Error(`${name}_REQUIRED`);
  return value;
}

async function waitForMinio(endpoint: string): Promise<void> {
  const deadline = Date.now() + 30_000;
  const healthUrl = `${endpoint.replace(/\/$/, '')}/minio/health/live`;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(healthUrl);
      if (response.ok) return;
    } catch {
      // The container may still be starting.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
  }
  throw new Error(`OBJECT_STORAGE_HEALTH_TIMEOUT:${healthUrl}`);
}

async function main(): Promise<void> {
  const compose = spawnSync(
    'docker',
    [
      'compose',
      '-f',
      composeFile,
      'up',
      '-d',
      '--wait',
      '--wait-timeout',
      '120',
      'postgres',
      'redis',
      'object-storage',
      'otel',
    ],
    { stdio: 'inherit' },
  );
  if (compose.error) throw compose.error;
  if (compose.status !== 0)
    throw new Error(`DOCKER_COMPOSE_FAILED:${compose.status ?? 'unknown'}`);

  const endpoint = requireValue(
    'OBJECT_STORAGE_ENDPOINT',
    'http://127.0.0.1:9000',
  );
  await waitForMinio(endpoint);
  const bucket = requireValue('OBJECT_STORAGE_BUCKET', 'gamerhub-local');
  const bucketStatus = await ensureS3Bucket({
    endpoint,
    region: requireValue('OBJECT_STORAGE_REGION', 'us-east-1'),
    bucket,
    accessKeyId: requireValue('OBJECT_STORAGE_ACCESS_KEY', 'gamerhub_local'),
    secretAccessKey: requireValue(
      'OBJECT_STORAGE_SECRET_KEY',
      'gamerhub_local_password',
    ),
  });
  const redis = await RedisRunSignal.connect(
    requireValue('REDIS_URL', 'redis://127.0.0.1:6379'),
  );
  const redisStatus = await redis.probe();
  await redis.close();
  if (redisStatus.status !== 'ready')
    throw new Error(`REDIS_HEALTH_FAILED:${redisStatus.detail}`);
  console.log(
    JSON.stringify({
      status: 'ready',
      services: ['postgres', 'redis', 'object-storage', 'otel'],
      redis: redisStatus,
      objectStorageBucket: bucket,
      objectStorageBucketStatus: bucketStatus,
    }),
  );
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
