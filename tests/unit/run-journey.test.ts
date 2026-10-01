import { describe, expect, it } from 'vitest';
import {
  buildRunJourney,
  type RunJourneyEvent,
} from '../../apps/studio-web/src/features/runs/RunJourney';

function event(
  sequence: number,
  type: string,
  payload: Record<string, unknown>,
  occurredAt: string,
): RunJourneyEvent {
  return { sequence, type, payload, occurredAt };
}

describe('buildRunJourney', () => {
  it('uses the latest successful observation after a retry', () => {
    const steps = buildRunJourney({
      requestType: 'modify',
      phase: 'executing',
      events: [
        event(
          1,
          'agent.act.started',
          { actionId: 'targeted-playtest' },
          '2026-09-06T00:00:00Z',
        ),
        event(
          2,
          'agent.observe.failed',
          { actionId: 'targeted-playtest' },
          '2026-09-06T00:00:01Z',
        ),
        event(
          3,
          'agent.act.started',
          { actionId: 'targeted-playtest' },
          '2026-09-06T00:00:02Z',
        ),
        event(
          4,
          'agent.observe.completed',
          { actionId: 'targeted-playtest' },
          '2026-09-06T00:00:03Z',
        ),
      ],
    });
    expect(steps.find((step) => step.id === 'targeted-playtest')?.state).toBe(
      'complete',
    );
  });
  it('keeps every step pending before the creator submits an idea', () => {
    const steps = buildRunJourney({
      requestType: 'create',
      phase: 'queued',
      events: [],
    });

    expect(steps).toHaveLength(13);
    expect(steps.every((step) => step.state === 'pending')).toBe(true);
  });

  it('turns real create events into understandable, timed steps', () => {
    const steps = buildRunJourney({
      requestType: 'create',
      phase: 'testing',
      events: [
        event(1, 'run.accepted', {}, '2026-09-05T00:00:00.000Z'),
        event(
          2,
          'agent.plan.action_ready',
          { actionId: 'interpret-game-spec' },
          '2026-09-05T00:00:01.000Z',
        ),
        event(
          3,
          'agent.observe.completed',
          { actionId: 'interpret-game-spec' },
          '2026-09-05T00:00:03.500Z',
        ),
        event(
          4,
          'agent.plan.action_ready',
          {
            actionId: 'scene-create',
            input: { taskId: 'scene-create', validation: 'compile' },
          },
          '2026-09-05T00:00:04.000Z',
        ),
        event(
          5,
          'agent.act.started',
          { actionId: 'scene-create' },
          '2026-09-05T00:00:04.500Z',
        ),
        event(
          6,
          'task.progress',
          {
            taskId: 'scene-create',
            status: 'completed',
            evidenceCount: 2,
          },
          '2026-09-05T00:00:08.000Z',
        ),
        event(
          7,
          'agent.plan.action_ready',
          { actionId: 'player-create', input: { taskId: 'player-create' } },
          '2026-09-05T00:00:09.000Z',
        ),
      ],
    });

    expect(steps).toHaveLength(13);
    expect(steps[0]).toMatchObject({
      id: 'request-accepted',
      state: 'complete',
    });
    expect(steps[1]).toMatchObject({
      id: 'interpret-game-spec',
      state: 'complete',
      durationMs: 2500,
    });
    expect(steps.find((step) => step.id === 'scene-create')).toMatchObject({
      title: '搭建游戏场景',
      state: 'complete',
      evidenceCount: 2,
      durationMs: 4000,
      validation: 'compile',
    });
    expect(steps.find((step) => step.id === 'player-create')?.state).toBe(
      'active',
    );
    expect(steps.find((step) => step.id === 'build-web')?.state).toBe(
      'pending',
    );
  });

  it('deduplicates replayed task events and keeps the latest completion', () => {
    const steps = buildRunJourney({
      requestType: 'modify',
      phase: 'testing',
      events: [
        event(1, 'run.accepted', {}, '2026-09-05T00:00:00.000Z'),
        event(
          2,
          'agent.plan.action_ready',
          { actionId: 'parameter-update' },
          '2026-09-05T00:00:01.000Z',
        ),
        event(
          3,
          'task.progress',
          {
            taskId: 'parameter-update',
            status: 'completed',
            evidenceCount: 1,
          },
          '2026-09-05T00:00:02.000Z',
        ),
        event(
          10,
          'agent.plan.action_ready',
          { actionId: 'parameter-update' },
          '2026-09-05T00:00:03.000Z',
        ),
        event(
          11,
          'task.progress',
          {
            taskId: 'parameter-update',
            status: 'completed',
            evidenceCount: 3,
          },
          '2026-09-05T00:00:05.000Z',
        ),
      ],
    });

    expect(steps.filter((step) => step.id === 'parameter-update')).toHaveLength(
      1,
    );
    expect(steps.find((step) => step.id === 'parameter-update')).toMatchObject({
      state: 'complete',
      evidenceCount: 3,
      lastSequence: 11,
    });
  });

  it('marks the active task as failed without inventing completed work', () => {
    const steps = buildRunJourney({
      requestType: 'modify',
      phase: 'failed',
      events: [
        event(1, 'run.accepted', {}, '2026-09-05T00:00:00.000Z'),
        event(
          2,
          'agent.observe.completed',
          { actionId: 'interpret-game-spec' },
          '2026-09-05T00:00:01.000Z',
        ),
        event(
          3,
          'agent.act.started',
          { actionId: 'targeted-playtest' },
          '2026-09-05T00:00:02.000Z',
        ),
        event(
          4,
          'run.failed',
          { code: 'PLAYTEST_FAILED' },
          '2026-09-05T00:00:03.000Z',
        ),
      ],
    });

    expect(steps.find((step) => step.id === 'targeted-playtest')?.state).toBe(
      'failed',
    );
    expect(steps.find((step) => step.id === 'build-web')?.state).toBe(
      'pending',
    );
  });

  it('represents rollback preparation without requiring a model call', () => {
    const steps = buildRunJourney({
      requestType: 'rollback',
      phase: 'testing',
      events: [
        event(1, 'run.accepted', {}, '2026-09-05T00:00:00.000Z'),
        event(
          2,
          'agent.plan.action_ready',
          { actionId: 'parameter-update' },
          '2026-09-05T00:00:01.000Z',
        ),
      ],
    });

    expect(steps[1]).toMatchObject({
      id: 'interpret-game-spec',
      state: 'complete',
      output: '待恢复的历史游戏方案',
    });
  });
});
