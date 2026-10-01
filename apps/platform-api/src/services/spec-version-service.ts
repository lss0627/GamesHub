import { randomUUID } from 'node:crypto';
import type { PostgresDomainRepository } from '@gamerhub/domain';
import { publicRun } from '../app';
import type { VersionRestoreService } from '../routes/versions';

/** Version history and restores use the same GameSpec IDs consumed by the worker. */
export class DurableSpecVersionService implements VersionRestoreService {
  constructor(
    private readonly store: PostgresDomainRepository,
    private readonly ownerId: string,
  ) {}

  async list(projectId: string): Promise<unknown[]> {
    await this.store.getProject(projectId, { ownerId: this.ownerId });
    return this.store.withTenantTransaction(this.ownerId, async (client) => {
      const result = await client.query(
        'SELECT id, version_number, summary, status, change_type, created_at, content_hash FROM game_spec_versions WHERE project_id = $1 ORDER BY version_number, id',
        [projectId],
      );
      return result.rows.map((row) => ({
        id: row.id,
        versionNumber: row.version_number,
        summary: row.summary,
        status: row.status,
        changeType: row.change_type,
        createdAt:
          row.created_at instanceof Date
            ? row.created_at.toISOString()
            : row.created_at,
        contentHash: row.content_hash,
      }));
    });
  }

  async restore(
    projectId: string,
    versionId: string,
    idempotencyKey?: string,
  ): Promise<unknown> {
    const versions = (await this.list(projectId)) as Array<{ id: string }>;
    if (!versions.some((version) => version.id === versionId))
      throw new Error('RESTORE_VERSION_NOT_FOUND');
    const { run } = await this.store.createRun({
      ownerId: this.ownerId,
      projectId,
      requestType: 'rollback',
      userInput: versionId,
      idempotencyKey: idempotencyKey ?? `restore-${randomUUID()}`,
    });
    return {
      ...publicRun(run),
      target_version_id: versionId,
    };
  }
}
