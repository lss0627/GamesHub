import type { PlannerTask } from './planner';

export interface FixIssue {
  id: string;
  assertionId: string;
  affectedCapabilities: string[];
  severity?: 'critical' | 'high' | 'medium' | 'low';
}

export interface FixPlan {
  tasks: PlannerTask[];
  repeatedRootCause: boolean;
  stopReason?: 'repeated_root_cause';
}

export function createFixPlan(input: {
  issue: FixIssue;
  priorIssueIds?: string[];
}): FixPlan {
  const repeatedRootCause =
    input.priorIssueIds?.includes(input.issue.id) ?? false;
  const task: PlannerTask = {
    id: `fix-${input.issue.id}`,
    type: 'fix',
    description: `Fix ${input.issue.assertionId} in the impacted capability set`,
    dependencies: [],
    status: 'pending',
    retry_count: 0,
    max_retries: 1,
    validation_method: {
      type: 'playtest_assertion',
      reference: input.issue.assertionId,
    },
    related_files: [],
    related_scenes: ['runner_scene'],
    capabilities: [...new Set(input.issue.affectedCapabilities)],
  };
  return {
    tasks: repeatedRootCause ? [] : [task],
    repeatedRootCause,
    ...(repeatedRootCause
      ? { stopReason: 'repeated_root_cause' as const }
      : {}),
  };
}
