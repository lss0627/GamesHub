import {
  InMemoryEngineAdapter,
  validateEngineCommand,
} from '@gamerhub/engine-adapter';
import { describe, expect, it } from 'vitest';

const context = {
  runId: 'run-1',
  taskId: 'task-1',
  workspaceRoot: 'D:/workspace/project',
  capabilities: ['scene.create', 'game_object.remove'],
  checkpointRef: 'cp-1',
};

describe('EngineAdapter contract', () => {
  it('discovers a versioned capability matrix', async () => {
    const adapter = new InMemoryEngineAdapter();
    const capabilities = await adapter.discoverCapabilities();
    expect(capabilities.version).toBeTruthy();
    expect(capabilities.commands).toContain('scene.create');
  });

  it('rejects absolute paths and traversal before execution', () => {
    expect(() =>
      validateEngineCommand({
        commandId: '1',
        capability: 'scene.create',
        safetyClass: 'project_write',
        projectRef: 'p',
        arguments: { path: '../outside.unity' },
        timeoutMs: 1000,
      }),
    ).toThrow(/WORKSPACE_ESCAPE/);
    expect(() =>
      validateEngineCommand({
        commandId: '2',
        capability: 'scene.create',
        safetyClass: 'project_write',
        projectRef: 'p',
        arguments: { path: 'D:/host/file.unity' },
        timeoutMs: 1000,
      }),
    ).toThrow(/WORKSPACE_ESCAPE/);
  });

  it('requires a checkpoint and expected revision for destructive commands', async () => {
    const adapter = new InMemoryEngineAdapter();
    await expect(
      adapter.execute(
        {
          commandId: '1',
          capability: 'game_object.remove',
          safetyClass: 'destructive',
          projectRef: 'p',
          arguments: { path: 'Assets/Runner.unity' },
          timeoutMs: 1000,
        },
        {
          ...context,
          capabilities: ['game_object.remove'],
          checkpointRef: undefined,
        },
      ),
    ).rejects.toMatchObject({ code: 'CHECKPOINT_REQUIRED' });
    await expect(
      adapter.execute(
        {
          commandId: '2',
          capability: 'game_object.remove',
          safetyClass: 'destructive',
          projectRef: 'p',
          expectedRevision: 'stale',
          arguments: { path: 'Assets/Runner.unity' },
          timeoutMs: 1000,
        },
        context,
      ),
    ).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
  });

  it('normalizes cancellation and fallback results', async () => {
    const adapter = new InMemoryEngineAdapter({ primaryAvailable: false });
    const result = await adapter.compile({ projectRef: 'p' }, context);
    expect(result.status).toBe('succeeded');
    expect(result.provenance.transport).toBe('batchmode');
    await expect(adapter.cancel(result.operationId)).resolves.toBeUndefined();
  });
});
