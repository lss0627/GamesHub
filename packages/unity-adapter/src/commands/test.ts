import { randomUUID } from 'node:crypto';
import type {
  EngineTestRequest,
  EngineTestResult,
} from '@gamerhub/engine-adapter';

export interface UnityTestCommandResult extends EngineTestResult {
  mode: EngineTestRequest['mode'];
  filter?: string;
}

export function createUnityTestCommand(request: EngineTestRequest): {
  command: string[];
  request: EngineTestRequest;
} {
  const args = [
    '-batchmode',
    '-runTests',
    '-testPlatform',
    request.mode === 'editmode' ? 'EditMode' : 'PlayMode',
    '-quit',
  ];
  if (request.testFilter) args.push('-testFilter', request.testFilter);
  return { command: args, request };
}

export function normalizeUnityTestResult(input: {
  mode: EngineTestRequest['mode'];
  passed: number;
  failed: number;
  output?: string;
}): UnityTestCommandResult {
  const failed = Math.max(0, input.failed);
  return {
    operationId: randomUUID(),
    status: failed === 0 ? 'succeeded' : 'failed',
    changedFiles: [],
    warnings: [],
    errors:
      failed === 0
        ? []
        : [
            {
              code: 'UNITY_TEST_FAILED',
              message: `${failed} Unity tests failed`,
              severity: 'error',
            },
          ],
    evidenceRefs: input.output ? [`log:${randomUUID()}`] : [],
    retryable: false,
    passed: Math.max(0, input.passed),
    failed,
    mode: input.mode,
    ...(input.output ? { filter: input.output.slice(0, 200) } : {}),
  };
}
