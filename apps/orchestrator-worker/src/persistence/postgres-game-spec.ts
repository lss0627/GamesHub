import { parseGameSpec } from '@gamerhub/contracts';
import type { PostgresDomainRepository } from '@gamerhub/domain';
import type {
  GameSpecPersistence,
  GameSpecVersionRecord,
} from '@gamerhub/game-spec';

type Row = Record<string, unknown>;

function text(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

function record(row: Row): GameSpecVersionRecord {
  return {
    id: text(row.id),
    projectId: text(row.project_id),
    versionNumber: Number(row.version_number),
    ...(row.parent_version_id
      ? { parentVersionId: text(row.parent_version_id) }
      : {}),
    sourceRunId: text(row.source_run_id),
    changeType: row.change_type as GameSpecVersionRecord['changeType'],
    summary: text(row.summary),
    spec: parseGameSpec(row.spec_json),
    contentHash: text(row.content_hash),
    status: row.status as GameSpecVersionRecord['status'],
    createdAt: text(row.created_at),
  };
}

/** Service-role adapter used by the worker; the worker DB role must be RLS-safe. */
export class PostgresGameSpecPersistence implements GameSpecPersistence {
  constructor(private readonly repository: PostgresDomainRepository) {}

  async save(version: GameSpecVersionRecord): Promise<void> {
    await this.repository.withTransaction((client) =>
      client
        .query(
          `INSERT INTO game_spec_versions
            (id, project_id, version_number, parent_version_id, source_run_id,
             change_type, summary, spec_json, content_hash, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10)
           ON CONFLICT DO NOTHING`,
          [
            version.id,
            version.projectId,
            version.versionNumber,
            version.parentVersionId ?? null,
            version.sourceRunId,
            version.changeType,
            version.summary,
            JSON.stringify(version.spec),
            version.contentHash,
            version.status,
          ],
        )
        .then(() => undefined),
    );
  }

  async activate(projectId: string, versionId: string): Promise<void> {
    await this.repository.withTransaction(async (client) => {
      const target = await client.query(
        'SELECT id FROM game_spec_versions WHERE id = $1 AND project_id = $2 FOR UPDATE',
        [versionId, projectId],
      );
      if (!target.rows[0]) throw new Error('SPEC_VERSION_NOT_FOUND');
      await client.query(
        `UPDATE game_spec_versions
         SET status = 'superseded', updated_at = now(), version = version + 1
         WHERE project_id = $1 AND status = 'active' AND id <> $2`,
        [projectId, versionId],
      );
      await client.query(
        `UPDATE game_spec_versions
         SET status = 'active', updated_at = now(), version = version + 1
         WHERE id = $1 AND project_id = $2`,
        [versionId, projectId],
      );
      await client.query(
        `UPDATE projects
         SET current_spec_version_id = $2, updated_at = now(), version = version + 1
         WHERE id = $1`,
        [projectId, versionId],
      );
    });
  }

  async list(projectId: string): Promise<GameSpecVersionRecord[]> {
    const result = await this.repository.pool.query(
      `SELECT id, project_id, version_number, parent_version_id, source_run_id,
              change_type, summary, spec_json, content_hash, status, created_at
       FROM game_spec_versions WHERE project_id = $1 ORDER BY version_number, id`,
      [projectId],
    );
    return result.rows.map(record);
  }

  async findBySourceRun(
    projectId: string,
    sourceRunId: string,
  ): Promise<GameSpecVersionRecord | undefined> {
    const result = await this.repository.pool.query(
      `SELECT id, project_id, version_number, parent_version_id, source_run_id,
              change_type, summary, spec_json, content_hash, status, created_at
       FROM game_spec_versions
       WHERE project_id = $1 AND source_run_id = $2
       ORDER BY version_number, id
       LIMIT 1`,
      [projectId, sourceRunId],
    );
    const row = result.rows[0];
    return row ? record(row) : undefined;
  }

  async findByContentHash(
    projectId: string,
    contentHash: string,
  ): Promise<GameSpecVersionRecord | undefined> {
    const result = await this.repository.pool.query(
      `SELECT id, project_id, version_number, parent_version_id, source_run_id,
              change_type, summary, spec_json, content_hash, status, created_at
       FROM game_spec_versions
       WHERE project_id = $1 AND content_hash = $2
       LIMIT 1`,
      [projectId, contentHash],
    );
    const row = result.rows[0];
    return row ? record(row) : undefined;
  }
}
