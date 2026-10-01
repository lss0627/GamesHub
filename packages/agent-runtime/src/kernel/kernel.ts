import { createHash, randomBytes } from 'node:crypto';
import { AgentRuntimeError } from '../ports/agent-runtime';
import type {
  AgentActionAssessment,
  AgentActionCheckpoint,
  AgentCheckpointStore,
  AgentEventSink,
  AgentKernelAction,
  AgentKernelCheckpoint,
  AgentKernelEvent,
  AgentKernelExecutionResult,
  AgentKernelPolicy,
  AgentKernelStatus,
} from './types';

export interface AgentKernelOptions {
  checkpointStore: AgentCheckpointStore;
  eventSink: AgentEventSink;
  now?: () => Date;
}

export interface ExecuteAgentActionInput<TInput, TOutput> {
  runId: string;
  sessionId: string;
  traceId?: string;
  policy: AgentKernelPolicy;
  action: AgentKernelAction<TInput, TOutput>;
  signal?: AbortSignal;
}

function policyFingerprint(policy: AgentKernelPolicy): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        allowedToolNames: [...policy.allowedToolNames].sort(),
        allowedSafetyClasses: [...policy.allowedSafetyClasses].sort(),
        budget: policy.budget,
      }),
    )
    .digest('hex');
}

function normalizedError(error: unknown): {
  code: string;
  message: string;
  retryable: boolean;
} {
  if (error instanceof AgentRuntimeError)
    return {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
    };
  if (error && typeof error === 'object') {
    const value = error as Record<string, unknown>;
    return {
      code: typeof value.code === 'string' ? value.code : 'TOOL_FAILED',
      message:
        typeof value.message === 'string'
          ? value.message
          : 'Agent tool execution failed',
      retryable: value.retryable === true,
    };
  }
  return {
    code: 'TOOL_FAILED',
    message: error instanceof Error ? error.message : String(error),
    retryable: false,
  };
}

function assessmentError(assessment: AgentActionAssessment): {
  code: string;
  message: string;
  retryable: boolean;
} {
  return {
    code: assessment.code ?? 'TOOL_RESULT_REJECTED',
    message: assessment.message ?? 'Agent tool result did not pass validation',
    retryable: assessment.retryable === true,
  };
}

export class AgentKernel {
  private readonly checkpointStore: AgentCheckpointStore;
  private readonly eventSink: AgentEventSink;
  private readonly now: () => Date;

  constructor(options: AgentKernelOptions) {
    this.checkpointStore = options.checkpointStore;
    this.eventSink = options.eventSink;
    this.now = options.now ?? (() => new Date());
  }

  async executeAction<TInput, TOutput>(
    input: ExecuteAgentActionInput<TInput, TOutput>,
  ): Promise<AgentKernelExecutionResult<TOutput>> {
    this.assertNotCancelled(input.signal);
    this.assertPolicy(input.policy, input.action);
    const checkpoint = await this.loadOrCreate(input);
    const existing = checkpoint.actions[input.action.idempotencyKey];
    if (existing?.status === 'completed') {
      await this.emit(checkpoint, 'agent.action.replayed', 'developer', {
        actionId: input.action.id,
        toolName: input.action.tool.name,
        attempts: existing.attempts,
      });
      return {
        output: existing.output as TOutput,
        replayed: true,
        attempts: existing.attempts,
        usage: structuredClone(checkpoint.usage),
      };
    }
    if (existing?.status === 'failed' && 'output' in existing) {
      await this.emit(checkpoint, 'agent.action.replayed', 'developer', {
        actionId: input.action.id,
        toolName: input.action.tool.name,
        attempts: existing.attempts,
        failed: true,
      });
      return {
        output: existing.output as TOutput,
        replayed: true,
        attempts: existing.attempts,
        usage: structuredClone(checkpoint.usage),
      };
    }
    if (
      existing?.status === 'failed' &&
      existing.attempts >= input.policy.budget.maxRetriesPerAction + 1
    ) {
      throw new AgentRuntimeError(
        existing.error?.code ?? 'TOOL_FAILED',
        existing.error?.message ?? 'Agent tool retry budget was exhausted',
        existing.error?.retryable ?? false,
      );
    }
    if (existing?.status === 'running') {
      if (!input.action.tool.idempotent)
        throw new AgentRuntimeError(
          'RECOVERY_REQUIRES_RECONCILIATION',
          `Tool ${input.action.tool.name} was interrupted and is not idempotent`,
        );
      await this.emit(checkpoint, 'agent.recovery.resuming', 'developer', {
        actionId: input.action.id,
        toolName: input.action.tool.name,
        previousAttempts: existing.attempts,
      });
    } else {
      await this.emit(checkpoint, 'agent.plan.action_ready', 'creator', {
        actionId: input.action.id,
        toolName: input.action.tool.name,
        safetyClass: input.action.tool.safetyClass,
        ...(input.action.summarizeInput
          ? { input: input.action.summarizeInput(input.action.input) }
          : {}),
      });
    }

    while (true) {
      this.assertNotCancelled(input.signal);
      this.assertBudget(checkpoint, input.policy);
      const previous = checkpoint.actions[input.action.idempotencyKey];
      const attempt = (previous?.attempts ?? 0) + 1;
      checkpoint.usage.steps += 1;
      checkpoint.usage.toolCalls += 1;
      const actionCheckpoint: AgentActionCheckpoint = {
        actionId: input.action.id,
        idempotencyKey: input.action.idempotencyKey,
        toolName: input.action.tool.name,
        toolVersion: input.action.tool.version,
        status: 'running',
        attempts: attempt,
        startedAt: previous?.startedAt ?? this.timestamp(),
        updatedAt: this.timestamp(),
      };
      checkpoint.actions[input.action.idempotencyKey] = actionCheckpoint;
      checkpoint.status = 'running';
      await this.save(checkpoint);
      await this.emit(checkpoint, 'agent.act.started', 'creator', {
        actionId: input.action.id,
        toolName: input.action.tool.name,
        attempt,
        budget: this.budgetPayload(checkpoint, input.policy),
      });

      try {
        const output = await this.invokeTool(input, attempt);
        const assessment = input.action.assess?.(output) ?? {
          succeeded: true,
        };
        if (assessment.succeeded) {
          actionCheckpoint.status = 'completed';
          actionCheckpoint.output = structuredClone(output);
          actionCheckpoint.updatedAt = this.timestamp();
          await this.save(checkpoint);
          await this.emit(checkpoint, 'agent.observe.completed', 'creator', {
            actionId: input.action.id,
            toolName: input.action.tool.name,
            attempt,
            ...(input.action.summarizeOutput
              ? { observation: input.action.summarizeOutput(output) }
              : {}),
          });
          return {
            output,
            replayed: false,
            attempts: attempt,
            usage: structuredClone(checkpoint.usage),
          };
        }
        const error = assessmentError(assessment);
        actionCheckpoint.status = 'failed';
        actionCheckpoint.output = structuredClone(output);
        actionCheckpoint.error = error;
        actionCheckpoint.updatedAt = this.timestamp();
        await this.save(checkpoint);
        await this.emit(checkpoint, 'agent.observe.failed', 'creator', {
          actionId: input.action.id,
          toolName: input.action.tool.name,
          attempt,
          code: error.code,
          retryable: error.retryable,
        });
        if (this.canRetry(checkpoint, input.policy, error.retryable, attempt)) {
          await this.prepareRetry(checkpoint, input, error, attempt);
          continue;
        }
        await this.emit(checkpoint, 'agent.reflect.stopped', 'creator', {
          actionId: input.action.id,
          decision: 'fail_closed',
          code: error.code,
          reason: error.message,
        });
        return {
          output,
          replayed: false,
          attempts: attempt,
          usage: structuredClone(checkpoint.usage),
        };
      } catch (cause) {
        const error = normalizedError(cause);
        actionCheckpoint.status = 'failed';
        actionCheckpoint.error = error;
        actionCheckpoint.updatedAt = this.timestamp();
        await this.save(checkpoint);
        await this.emit(checkpoint, 'agent.observe.failed', 'creator', {
          actionId: input.action.id,
          toolName: input.action.tool.name,
          attempt,
          code: error.code,
          retryable: error.retryable,
        });
        if (this.canRetry(checkpoint, input.policy, error.retryable, attempt)) {
          await this.prepareRetry(checkpoint, input, error, attempt);
          continue;
        }
        await this.emit(checkpoint, 'agent.reflect.stopped', 'creator', {
          actionId: input.action.id,
          decision: 'fail_closed',
          code: error.code,
          reason: error.message,
        });
        throw new AgentRuntimeError(error.code, error.message, error.retryable);
      }
    }
  }

  async finalize(
    runId: string,
    status: Exclude<AgentKernelStatus, 'running'>,
    payload: Record<string, unknown> = {},
  ): Promise<void> {
    const checkpoint = await this.checkpointStore.load(runId);
    if (!checkpoint) return;
    checkpoint.status = status;
    await this.save(checkpoint);
    await this.emit(
      checkpoint,
      status === 'succeeded'
        ? 'agent.run.completed'
        : status === 'cancelled'
          ? 'agent.run.cancelled'
          : 'agent.run.failed',
      'creator',
      {
        ...payload,
        usage: structuredClone(checkpoint.usage),
        completedActions: Object.values(checkpoint.actions).filter(
          (action) => action.status === 'completed',
        ).length,
      },
    );
  }

  private assertPolicy<TInput, TOutput>(
    policy: AgentKernelPolicy,
    action: AgentKernelAction<TInput, TOutput>,
  ): void {
    if (!policy.allowedToolNames.includes(action.tool.name))
      throw new AgentRuntimeError(
        'TOOL_NOT_ALLOWED',
        `Tool ${action.tool.name} is not allowed by this agent policy`,
      );
    if (!policy.allowedSafetyClasses.includes(action.tool.safetyClass))
      throw new AgentRuntimeError(
        'SAFETY_CLASS_NOT_ALLOWED',
        `Safety class ${action.tool.safetyClass} is not allowed`,
      );
    const budget = policy.budget;
    if (
      ![
        budget.maxSteps,
        budget.maxToolCalls,
        budget.maxRetriesPerAction,
        budget.deadlineMs,
      ].every(Number.isFinite) ||
      budget.maxSteps < 1 ||
      budget.maxToolCalls < 1 ||
      budget.maxRetriesPerAction < 0 ||
      budget.deadlineMs < 1
    )
      throw new AgentRuntimeError('BUDGET_INVALID', 'Agent budget is invalid');
  }

  private async loadOrCreate<TInput, TOutput>(
    input: ExecuteAgentActionInput<TInput, TOutput>,
  ): Promise<AgentKernelCheckpoint> {
    const fingerprint = policyFingerprint(input.policy);
    const traceId =
      input.traceId ??
      createHash('sha256').update(input.runId).digest('hex').slice(0, 32);
    const existing = await this.checkpointStore.load(input.runId);
    if (existing) {
      if (existing.sessionId !== input.sessionId)
        throw new AgentRuntimeError(
          'SESSION_INCOMPATIBLE',
          'Agent checkpoint belongs to another session',
        );
      if (existing.policyFingerprint !== fingerprint)
        throw new AgentRuntimeError(
          'POLICY_MISMATCH',
          'Agent policy changed while the Run was in progress',
        );
      if (existing.traceId && existing.traceId !== traceId)
        throw new AgentRuntimeError(
          'TRACE_MISMATCH',
          'Agent checkpoint belongs to another trace',
        );
      existing.traceId = traceId;
      if (existing.status === 'cancelled')
        throw new AgentRuntimeError('CANCELLED', 'Agent Run was cancelled');
      return existing;
    }
    const createdAt = this.timestamp();
    const checkpoint: AgentKernelCheckpoint = {
      schemaVersion: '1.0.0',
      runId: input.runId,
      sessionId: input.sessionId,
      traceId,
      policyFingerprint: fingerprint,
      status: 'running',
      createdAt,
      updatedAt: createdAt,
      usage: { steps: 0, toolCalls: 0, retries: 0 },
      actions: {},
    };
    await this.save(checkpoint);
    await this.emit(checkpoint, 'agent.run.started', 'creator', {
      policy: {
        allowedToolNames: input.policy.allowedToolNames,
        allowedSafetyClasses: input.policy.allowedSafetyClasses,
        budget: input.policy.budget,
      },
    });
    return checkpoint;
  }

  private assertBudget(
    checkpoint: AgentKernelCheckpoint,
    policy: AgentKernelPolicy,
  ): void {
    if (checkpoint.usage.steps >= policy.budget.maxSteps)
      throw new AgentRuntimeError(
        'AGENT_STEP_BUDGET_EXHAUSTED',
        'Agent step budget was exhausted',
      );
    if (checkpoint.usage.toolCalls >= policy.budget.maxToolCalls)
      throw new AgentRuntimeError(
        'AGENT_TOOL_BUDGET_EXHAUSTED',
        'Agent tool-call budget was exhausted',
      );
    if (
      this.now().getTime() - Date.parse(checkpoint.createdAt) >=
      policy.budget.deadlineMs
    )
      throw new AgentRuntimeError(
        'AGENT_DEADLINE_EXCEEDED',
        'Agent execution deadline was exceeded',
        true,
      );
  }

  private assertNotCancelled(signal: AbortSignal | undefined): void {
    if (signal?.aborted)
      throw new AgentRuntimeError('CANCELLED', 'Agent action was cancelled');
  }

  private async invokeTool<TInput, TOutput>(
    input: ExecuteAgentActionInput<TInput, TOutput>,
    attempt: number,
  ): Promise<TOutput> {
    const controller = new AbortController();
    const abort = (): void => controller.abort();
    input.signal?.addEventListener('abort', abort, { once: true });
    const timeoutMs = Math.min(
      input.action.tool.timeoutMs ?? input.policy.budget.deadlineMs,
      input.policy.budget.deadlineMs,
    );
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let invocation: Promise<TOutput> | undefined;
    try {
      this.assertNotCancelled(input.signal);
      const spanId = randomBytes(8).toString('hex');
      invocation = input.action.tool.invoke(input.action.input, {
        runId: input.runId,
        sessionId: input.sessionId,
        actionId: input.action.id,
        attempt,
        traceId:
          input.traceId ??
          createHash('sha256').update(input.runId).digest('hex').slice(0, 32),
        spanId,
        signal: controller.signal,
      });
      return await Promise.race([
        invocation,
        new Promise<never>((_, reject) => {
          controller.signal.addEventListener(
            'abort',
            () =>
              reject(
                new AgentRuntimeError(
                  input.signal?.aborted ? 'CANCELLED' : 'TOOL_TIMEOUT',
                  input.signal?.aborted
                    ? 'Agent action was cancelled'
                    : `Tool ${input.action.tool.name} timed out`,
                  !input.signal?.aborted,
                ),
              ),
            { once: true },
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
      input.signal?.removeEventListener('abort', abort);
      // A timeout is not proof that a mutating tool has stopped. Drain it before
      // releasing the Run lease or attempting a retry against the same workspace.
      if (
        controller.signal.aborted &&
        input.action.tool.safetyClass === 'engine_mutation'
      )
        await invocation?.catch(() => undefined);
    }
  }

  private canRetry(
    checkpoint: AgentKernelCheckpoint,
    policy: AgentKernelPolicy,
    retryable: boolean,
    attempt: number,
  ): boolean {
    return (
      retryable &&
      attempt <= policy.budget.maxRetriesPerAction &&
      checkpoint.usage.steps < policy.budget.maxSteps &&
      checkpoint.usage.toolCalls < policy.budget.maxToolCalls
    );
  }

  private async prepareRetry<TInput, TOutput>(
    checkpoint: AgentKernelCheckpoint,
    input: ExecuteAgentActionInput<TInput, TOutput>,
    error: { code: string; message: string; retryable: boolean },
    attempt: number,
  ): Promise<void> {
    checkpoint.usage.retries += 1;
    await this.save(checkpoint);
    await this.emit(checkpoint, 'agent.reflect.retrying', 'creator', {
      actionId: input.action.id,
      decision: 'retry',
      nextAttempt: attempt + 1,
      code: error.code,
      reason: error.message,
    });
  }

  private async save(checkpoint: AgentKernelCheckpoint): Promise<void> {
    checkpoint.updatedAt = this.timestamp();
    await this.checkpointStore.save(checkpoint);
  }

  private async emit(
    checkpoint: AgentKernelCheckpoint,
    type: string,
    visibility: AgentKernelEvent['visibility'],
    payload: Record<string, unknown>,
  ): Promise<void> {
    await this.eventSink.append({
      schemaVersion: '1.0.0',
      runId: checkpoint.runId,
      sessionId: checkpoint.sessionId,
      type,
      visibility,
      occurredAt: this.timestamp(),
      ...(checkpoint.traceId ? { traceId: checkpoint.traceId } : {}),
      spanId: randomBytes(8).toString('hex'),
      payload,
    });
  }

  private budgetPayload(
    checkpoint: AgentKernelCheckpoint,
    policy: AgentKernelPolicy,
  ): Record<string, unknown> {
    return {
      steps: `${checkpoint.usage.steps}/${policy.budget.maxSteps}`,
      toolCalls: `${checkpoint.usage.toolCalls}/${policy.budget.maxToolCalls}`,
      retries: `${checkpoint.usage.retries}`,
    };
  }

  private timestamp(): string {
    return this.now().toISOString();
  }
}
