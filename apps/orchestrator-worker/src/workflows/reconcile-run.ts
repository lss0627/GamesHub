import { assertPauseIsSafe, type RunStatus } from '@gamerhub/domain';

export interface RunReconciliation {
  runId: string;
  status: RunStatus;
  recoverySequence: number;
  leasesReleased: boolean;
  resumeFrom: number;
}

export function reconcilePausedRun(input: {
  runId: string;
  status: RunStatus;
  recoverySequence?: number;
  editorLeaseReleased: boolean;
  licenseLeaseReleased: boolean;
}): RunReconciliation {
  const sequence = input.recoverySequence ?? 0;
  if (input.status === 'paused')
    assertPauseIsSafe(
      input.status,
      sequence > 0,
      input.editorLeaseReleased && input.licenseLeaseReleased,
    );
  return {
    runId: input.runId,
    status: input.status === 'paused' ? 'waiting_for_engine' : input.status,
    recoverySequence: sequence,
    leasesReleased: input.editorLeaseReleased && input.licenseLeaseReleased,
    resumeFrom: sequence,
  };
}
