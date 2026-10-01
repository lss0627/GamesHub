import {
  GameSpecService,
  type GameSpecVersionRecord,
  runnerGameSpec,
} from '@gamerhub/game-spec';
import { describe, expect, it } from 'vitest';

describe('GameSpec persistence recovery', () => {
  it('hydrates existing version numbers before writing through a restarted service', async () => {
    const records: GameSpecVersionRecord[] = [];
    const persistence = {
      save: async (record: GameSpecVersionRecord) => {
        records.push(record);
      },
      activate: async () => undefined,
      list: async () => records,
    };
    const input = {
      projectId: 'project-1',
      sourceRunId: 'run-1',
      spec: runnerGameSpec,
      summary: 'first',
    };
    await new GameSpecService(persistence).createVersionAndPersist(input);
    const restarted = new GameSpecService(persistence);
    const next = await restarted.createVersionAndPersist({
      ...input,
      sourceRunId: 'run-2',
    });
    expect(next.versionNumber).toBe(2);
  });

  it('does not keep a phantom version when persistence fails', async () => {
    const service = new GameSpecService({
      save: async () => {
        throw new Error('DB unavailable');
      },
      activate: async () => undefined,
      list: async () => [],
    });
    await expect(
      service.createVersionAndPersist({
        projectId: 'project-1',
        sourceRunId: 'run-1',
        spec: runnerGameSpec,
        summary: 'first',
      }),
    ).rejects.toThrow('DB unavailable');
    expect(service.list('project-1')).toEqual([]);
  });
});
