import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PostgresDomainRepository } from '@gamerhub/domain';
import { loadEnvironmentFile } from './dev-env';

loadEnvironmentFile();

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL_REQUIRED');
  const files = readdirSync('infra/migrations')
    .filter((file) => file.endsWith('.sql'))
    .sort();
  const repository =
    PostgresDomainRepository.fromConnectionString(connectionString);
  try {
    const client = await repository.pool.connect();
    try {
      // Pin the connection for transactions and serialize concurrent startup migrations.
      await client.query(
        "SELECT pg_advisory_lock(hashtext('gamerhub:schema_migrations'))",
      );
      await client.query(
        'CREATE TABLE IF NOT EXISTS schema_migrations (filename text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
      );
      for (const file of files) {
        const applied = await client.query(
          'SELECT 1 FROM schema_migrations WHERE filename = $1',
          [file],
        );
        if (applied.rows.length > 0) continue;
        await client.query('BEGIN');
        try {
          await client.query(
            readFileSync(join('infra/migrations', file), 'utf8'),
          );
          await client.query(
            'INSERT INTO schema_migrations (filename) VALUES ($1)',
            [file],
          );
          await client.query('COMMIT');
        } catch (error) {
          await client.query('ROLLBACK').catch(() => undefined);
          throw error;
        }
      }
    } finally {
      try {
        await client.query(
          "SELECT pg_advisory_unlock(hashtext('gamerhub:schema_migrations'))",
        );
      } finally {
        client.release();
      }
    }
  } finally {
    await repository.close();
  }
  console.log(JSON.stringify({ status: 'ready', migrations: files }));
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
