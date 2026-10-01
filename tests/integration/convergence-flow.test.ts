import { describe, expect, it } from 'vitest';
import {
  type CreateGameTaskResult,
  createGameWorkflow,
} from '../../apps/orchestrator-worker/src/workflows/create-game';

const input = {
  projectId: 'project-1',
  runId: 'run-1',
};

describe('evidence-gated create workflow', () => {
  it('never completes or publishes when a task has no committed evidence', async () => {
    const result = await createGameWorkflow({
      ...input,
      executeTask: async (task): Promise<CreateGameTaskResult> => ({
        taskId: task.id,
        status: 'completed',
        evidence: [],
      }),
    });

    expect(result.status).toBe('failed');
    expect(result.previewUrl).toBeUndefined();
    expect(result.failureCode).toBe('EVIDENCE_REQUIRED');
  });

  it('publishes only after schema, engine, playtest, evaluation and web evidence', async () => {
    const evidenceTypeByTask: Record<string, string> = {
      spec: 'schema',
      scene: 'engine',
      component: 'engine',
      script: 'engine',
      test: 'test',
      playtest: 'playtest',
      evaluate: 'evaluation',
      build: 'build',
      publish: 'preview',
    };
    const result = await createGameWorkflow({
      ...input,
      executeTask: async (task): Promise<CreateGameTaskResult> => ({
        taskId: task.id,
        status: 'completed',
        evidence: [
          {
            type: evidenceTypeByTask[task.type] ?? 'engine',
            reference: task.validation_method.reference,
          },
        ],
      }),
      publishPreview: async ({ buildHash }) => ({
        healthy: true,
        url: `https://preview.gamerhub.local/${buildHash}/index.html`,
      }),
    });

    expect(result.status).toBe('succeeded');
    expect(result.previewUrl).toMatch(/^https:\/\/preview/);
    expect(result.evidenceGate.passed).toBe(true);
  });
});
