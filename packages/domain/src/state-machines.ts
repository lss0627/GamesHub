import type { RunStatus, TaskStatus } from './index';

export const terminalRunStatuses: ReadonlySet<RunStatus> = new Set([
  'succeeded',
  'partially_succeeded',
  'failed',
  'cancelled',
  'timed_out',
]);

export const runTransitions: Record<RunStatus, readonly RunStatus[]> = {
  queued: ['planning', 'cancelled'],
  planning: [
    'waiting_for_engine',
    'executing',
    'pause_requested',
    'failed',
    'cancelled',
  ],
  waiting_for_engine: ['executing', 'pause_requested', 'failed', 'cancelled'],
  executing: [
    'playtesting',
    'pause_requested',
    'failed',
    'cancelled',
    'timed_out',
  ],
  playtesting: [
    'evaluating',
    'pause_requested',
    'failed',
    'cancelled',
    'timed_out',
  ],
  evaluating: [
    'fixing',
    'succeeded',
    'partially_succeeded',
    'failed',
    'cancelled',
    'pause_requested',
  ],
  fixing: [
    'executing',
    'playtesting',
    'evaluating',
    'pause_requested',
    'failed',
    'cancelled',
    'timed_out',
  ],
  pause_requested: ['paused', 'cancelled', 'failed'],
  paused: ['waiting_for_engine', 'cancelled'],
  succeeded: [],
  partially_succeeded: [],
  failed: [],
  cancelled: [],
  timed_out: [],
};

export function canTransitionRun(from: RunStatus, to: RunStatus): boolean {
  return runTransitions[from].includes(to);
}

export function assertRunTransition(from: RunStatus, to: RunStatus): void {
  if (!canTransitionRun(from, to)) {
    throw new StateTransitionError(
      'RUN_INVALID_TRANSITION',
      `Run cannot transition from ${from} to ${to}`,
    );
  }
}

export function canStartTask(
  status: TaskStatus,
  dependenciesCompleted: boolean,
): boolean {
  return status === 'pending' && dependenciesCompleted;
}

export function assertPauseIsSafe(
  runStatus: RunStatus,
  hasRecoveryPoint: boolean,
  exclusiveResourcesReleased: boolean,
): void {
  if (runStatus !== 'pause_requested' && runStatus !== 'paused') {
    throw new StateTransitionError(
      'PAUSE_NOT_REQUESTED',
      `Run status ${runStatus} is not pausable`,
    );
  }
  if (
    runStatus === 'paused' &&
    (!hasRecoveryPoint || !exclusiveResourcesReleased)
  ) {
    throw new StateTransitionError(
      'PAUSE_NOT_SAFE',
      'A paused Run requires a durable recovery point and released resources',
    );
  }
}

export class StateTransitionError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'StateTransitionError';
    this.code = code;
  }
}
