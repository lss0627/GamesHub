import { randomUUID } from 'node:crypto';
import type { PlatformStore } from '@gamerhub/domain';
import type { GameSpecService } from '@gamerhub/game-spec';
import { publicRun } from '../../platform-api/src/app';

/**
 * Local real-mode version history backed by the same durable GameSpec store as
 * the worker. A restore is a queued workflow, never an unverified pointer flip.
 */
export class LocalGameSpecVersionService {
  constructor(
    private readonly store: PlatformStore,
    private readonly specs: GameSpecService,
    private readonly ownerId = 'local-user',
  ) {}

  async list(projectId: string): Promise<unknown[]> {
    return (await this.specs.listDurably(projectId)).map((version) => ({
      id: version.id,
      versionNumber: version.versionNumber,
      summary: version.summary,
      status: version.status,
      changeType: version.changeType,
      createdAt: version.createdAt,
      contentHash: version.contentHash,
    }));
  }

  async restore(
    projectId: string,
    versionId: string,
    idempotencyKey?: string,
  ): Promise<unknown> {
    const target = (await this.specs.listDurably(projectId)).find(
      (version) => version.id === versionId,
    );
    if (!target) throw new Error('RESTORE_VERSION_NOT_FOUND');
    const { run } = await this.store.createRun({
      ownerId: this.ownerId,
      projectId,
      requestType: 'rollback',
      userInput: versionId,
      idempotencyKey: idempotencyKey ?? `restore-${versionId}-${randomUUID()}`,
      sessionId: randomUUID(),
    });
    return {
      ...publicRun(run),
      target_version_id: versionId,
    };
  }
}
