/** Private transport port. Agent policy/lifecycle and official Pi are hosted by Python. */
import { randomBytes, randomUUID } from 'node:crypto';
import type {
  AgentKernel,
  ExecuteAgentActionInput,
} from '@gamerhub/agent-runtime';
import { AgentRuntimeError } from '@gamerhub/agent-runtime';
import type { PlatformStore } from '@gamerhub/domain';
import { terminalRunStatuses } from '@gamerhub/domain';
import type { ModelProvider, ModelRequest } from '@gamerhub/model-provider';

type Params = Record<string, unknown>;
type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  callback?: (name: string, body: Params) => Promise<unknown>;
};
const pending = new Map<string, Pending>();

export function acceptPythonResponse(message: Params): boolean {
  if (message.type !== 'python_response') return false;
  const item = pending.get(String(message.id));
  if (!item) return true;
  pending.delete(String(message.id));
  if (message.error)
    item.reject(
      new AgentRuntimeError(String(message.error), String(message.error)),
    );
  else item.resolve(message.result);
  return true;
}

export async function pythonCallback(
  requestId: string,
  name: string,
  body: Params,
): Promise<unknown> {
  const item = pending.get(requestId);
  if (!item?.callback)
    throw new AgentRuntimeError(
      'PI_CALLBACK_EXPIRED',
      'Pi action is no longer active',
    );
  return item.callback(name, body);
}

async function request(
  operation: string,
  params: Params,
  callback?: Pending['callback'],
  timeoutMs = 180_000,
  signal?: AbortSignal,
): Promise<unknown> {
  const id = randomUUID();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  try {
    return await new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(new AgentRuntimeError('PI_CANCELLED', 'Pi request cancelled'));
        return;
      }
      pending.set(id, { resolve, reject, ...(callback ? { callback } : {}) });
      abort = () => {
        process.stdout.write(
          `${JSON.stringify({ type: 'python_cancel', id })}\n`,
        );
        reject(new AgentRuntimeError('PI_CANCELLED', 'Pi request cancelled'));
      };
      signal?.addEventListener('abort', abort, { once: true });
      timer = setTimeout(() => {
        process.stdout.write(
          `${JSON.stringify({ type: 'python_cancel', id })}\n`,
        );
        reject(new AgentRuntimeError('PI_TIMEOUT', 'Pi action timed out'));
      }, timeoutMs);
      process.stdout.write(
        `${JSON.stringify({ type: 'python_request', id, operation, params: { ...params, requestId: id } })}\n`,
      );
    });
  } finally {
    if (timer) clearTimeout(timer);
    if (abort) signal?.removeEventListener('abort', abort);
    pending.delete(id);
  }
}

export class PythonPiActionRuntime
  implements Pick<AgentKernel, 'executeAction' | 'finalize'>
{
  constructor(
    private readonly store: PlatformStore,
    private readonly ownerId: string,
  ) {}

  async executeAction<TInput, TOutput>(
    input: ExecuteAgentActionInput<TInput, TOutput>,
  ) {
    const run = await this.store.getRunForWorker(input.runId);
    await this.store.getProject(run.projectId, { ownerId: this.ownerId });
    const actionController = new AbortController();
    let activeInvocation: Promise<unknown> | undefined;
    const assertRunnable = async () => {
      const latest = await this.store.getRun(run.projectId, input.runId, {
        ownerId: this.ownerId,
      });
      if (
        terminalRunStatuses.has(latest.status) ||
        latest.status === 'paused' ||
        latest.status === 'pause_requested'
      ) {
        actionController.abort();
        throw new AgentRuntimeError(
          'RUN_CONTROL_REQUESTED',
          'Run is paused or stopped',
        );
      }
    };
    const callback = async (name: string, body: Params) => {
      if (name === 'event') {
        await this.store.appendEvent({
          runId: run.id,
          eventType: String(body.type),
          visibility:
            body.type === 'agent.checkpoint.saved' ? 'audit' : 'creator',
          traceId: run.traceId,
          payload: body.payload as Params,
        });
        return {};
      }
      if (name === 'context') return { projectId: run.projectId };
      await assertRunnable();
      if (name === 'assertRunnable') return {};
      if (name !== 'invoke')
        throw new AgentRuntimeError('TOOL_NOT_ALLOWED', 'Unknown callback');
      if (actionController.signal.aborted)
        throw new AgentRuntimeError('PI_CANCELLED', 'Action already closed');
      const invocation = input.action.tool.invoke(input.action.input, {
        runId: run.id,
        sessionId: run.sessionId,
        actionId: input.action.id,
        attempt: Number(body.attempt),
        traceId: run.traceId,
        spanId: randomBytes(8).toString('hex'),
        signal: input.signal
          ? AbortSignal.any([input.signal, actionController.signal])
          : actionController.signal,
      });
      activeInvocation = invocation;
      const output = await invocation;
      return {
        output,
        assessment: input.action.assess?.(output) ?? { succeeded: true },
        summary: input.action.summarizeOutput?.(output) ?? {},
      };
    };
    let result: unknown;
    try {
      result = await request(
        'pi.execute',
        {
          runId: run.id,
          sessionId: run.sessionId,
          policy: input.policy,
          action: {
            id: input.action.id,
            idempotencyKey: input.action.idempotencyKey,
            input: input.action.input,
            summary: input.action.summarizeInput?.(input.action.input),
            toolName: input.action.tool.name,
            safetyClass: input.action.tool.safetyClass,
            idempotent: input.action.tool.idempotent,
            timeoutMs: input.action.tool.timeoutMs,
          },
        },
        callback,
        (input.action.tool.timeoutMs ?? 180_000) + 150_000,
      );
    } finally {
      actionController.abort();
      await activeInvocation?.catch(() => undefined);
    }
    return result as {
      output: TOutput;
      replayed: boolean;
      attempts: number;
      usage: { steps: number; toolCalls: number; retries: number };
    };
  }

  async finalize(
    runId: string,
    status: 'succeeded' | 'failed' | 'cancelled',
    payload: Params = {},
  ) {
    const run = await this.store.getRunForWorker(runId);
    await this.store.getProject(run.projectId, { ownerId: this.ownerId });
    await this.store.appendEvent({
      runId,
      eventType:
        status === 'succeeded' ? 'agent.run.completed' : `agent.run.${status}`,
      visibility: 'creator',
      payload: { ...payload, runtime: 'pi-agent-core' },
    });
  }
}

export class PythonPiModelProvider implements ModelProvider {
  readonly providerId = 'deepseek';
  async listModels() {
    return [
      {
        modelId: process.env.MODEL_PROVIDER_MODEL_ID ?? 'deepseek-v4-flash',
        contextWindow: 131072,
        capabilities: ['text' as const, 'structured_output' as const],
        maxOutputTokens: 16384,
      },
    ];
  }
  async countTokens() {
    return { promptTokens: null };
  }
  async health() {
    return { status: 'ready' as const, providerId: this.providerId };
  }
  async *generate(input: ModelRequest) {
    if (input.signal.aborted)
      throw new AgentRuntimeError('PI_CANCELLED', 'Cancelled');
    const result = (await request(
      'pi.design',
      {
        runId: input.runId,
        context: input.context,
        messages: input.messages,
        tokenBudget: input.tokenBudget,
      },
      undefined,
      input.timeoutMs + 5000,
      input.signal,
    )) as { text: string; usage?: Params };
    yield { type: 'text_delta' as const, payload: { text: result.text } };
    if (result.usage) yield { type: 'usage' as const, payload: result.usage };
  }
}
