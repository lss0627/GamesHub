export type ProblemCode =
  | 'AUTH_REQUIRED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'METHOD_NOT_ALLOWED'
  | 'PROJECT_FORBIDDEN'
  | 'VALIDATION_FAILED'
  | 'VERSION_CONFLICT'
  | 'REVISION_CONFLICT'
  | 'TOOL_NOT_ALLOWED'
  | 'COMMAND_NOT_ALLOWED'
  | 'RUNTIME_UNAVAILABLE'
  | 'MODEL_UNAVAILABLE'
  | 'ENGINE_UNAVAILABLE'
  | 'ENGINE_TIMEOUT'
  | 'LICENSE_UNAVAILABLE'
  | 'CHECKPOINT_REQUIRED'
  | 'WORKSPACE_ESCAPE'
  | 'RETRYABLE_FAILURE'
  | 'INTERNAL_ERROR';

const retryableCodes = new Set<ProblemCode>([
  'RUNTIME_UNAVAILABLE',
  'MODEL_UNAVAILABLE',
  'ENGINE_UNAVAILABLE',
  'ENGINE_TIMEOUT',
  'LICENSE_UNAVAILABLE',
  'RETRYABLE_FAILURE',
]);

function safeDetail(message: string): string {
  return message
    .replace(/secret:\/\/\S+/gi, '[REDACTED]')
    .replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]')
    .replace(/[A-Za-z]:[\\/][^\s;,)]+/g, '[REDACTED_PATH]');
}

export interface Problem {
  type: string;
  title: string;
  status: number;
  code: ProblemCode;
  detail?: string;
  trace_id: string;
  retryable: boolean;
}

export class ProblemError extends Error {
  readonly problem: Problem;

  constructor(
    code: ProblemCode,
    detail: string,
    status = 400,
    traceId = 'trace-unknown',
  ) {
    super(detail);
    this.name = 'ProblemError';
    this.problem = {
      type: `https://gamerhub.local/problems/${code.toLowerCase()}`,
      title: code.replaceAll('_', ' '),
      status,
      code,
      detail,
      trace_id: traceId,
      retryable: retryableCodes.has(code),
    };
  }
}

export function toProblem(error: unknown, traceId: string): Problem {
  if (error instanceof ProblemError)
    return { ...error.problem, trace_id: traceId };
  const code =
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
      ? error.code
      : 'INTERNAL_ERROR';
  const problemCodes = new Set<ProblemCode>([
    'AUTH_REQUIRED',
    'FORBIDDEN',
    'NOT_FOUND',
    'METHOD_NOT_ALLOWED',
    'PROJECT_FORBIDDEN',
    'VALIDATION_FAILED',
    'VERSION_CONFLICT',
    'REVISION_CONFLICT',
    'TOOL_NOT_ALLOWED',
    'COMMAND_NOT_ALLOWED',
    'RUNTIME_UNAVAILABLE',
    'MODEL_UNAVAILABLE',
    'ENGINE_UNAVAILABLE',
    'ENGINE_TIMEOUT',
    'LICENSE_UNAVAILABLE',
    'CHECKPOINT_REQUIRED',
    'WORKSPACE_ESCAPE',
    'RETRYABLE_FAILURE',
    'INTERNAL_ERROR',
  ]);
  const known = problemCodes.has(code as ProblemCode)
    ? (code as ProblemCode)
    : 'INTERNAL_ERROR';
  const statusByCode: Partial<Record<ProblemCode, number>> = {
    AUTH_REQUIRED: 401,
    FORBIDDEN: 403,
    PROJECT_FORBIDDEN: 403,
    NOT_FOUND: 404,
    METHOD_NOT_ALLOWED: 405,
    INTERNAL_ERROR: 500,
  };
  return {
    type: `https://gamerhub.local/problems/${known.toLowerCase()}`,
    title: known.replaceAll('_', ' '),
    status: statusByCode[known] ?? 400,
    code: known,
    trace_id: traceId,
    retryable: retryableCodes.has(known),
    ...(error instanceof Error ? { detail: safeDetail(error.message) } : {}),
  };
}
