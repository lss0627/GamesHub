// The only Node glue: the official Pi loop. Python owns tools and persistence.
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Agent } from '@earendil-works/pi-agent-core';
import {
  createModels,
  createProvider,
  envApiKeyAuth,
} from '@earendil-works/pi-ai';
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy';

const version = JSON.parse(
  readFileSync(
    new URL(
      '../../node_modules/@earendil-works/pi-agent-core/package.json',
      import.meta.url,
    ),
    'utf8',
  ),
).version;
const waiting = new Map();
if (process.argv.includes('--probe')) {
  process.stdout.write(
    `${JSON.stringify({ runtime: 'pi-agent-core', version, available: typeof Agent === 'function' })}\n`,
  );
  process.exit(0);
}
let agent;
let started = false;
const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
function ask(message, signal) {
  const id = message.id ?? randomUUID();
  return new Promise((resolve, reject) => {
    const abort = () => {
      waiting.delete(id);
      reject(new Error('PI_CANCELLED'));
    };
    if (signal?.aborted) return abort();
    signal?.addEventListener('abort', abort, { once: true });
    waiting.set(id, (reply) => {
      signal?.removeEventListener('abort', abort);
      reply.error ? reject(new Error(reply.error)) : resolve(reply.result);
    });
    send({ ...message, id });
  });
}

async function start(input) {
  if (started) throw new Error('PI_ALREADY_STARTED');
  started = true;
  const model = {
    id: input.model?.id ?? 'deepseek-v4-flash',
    name: input.model?.id ?? 'DeepSeek',
    api: 'openai-completions',
    provider: 'deepseek',
    baseUrl: input.model?.baseUrl ?? 'https://api.deepseek.com',
    reasoning: true,
    input: ['text'],
    contextWindow: 131072,
    maxTokens: 16384,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    compat: {
      supportsStore: false,
      supportsDeveloperRole: false,
      maxTokensField: 'max_tokens',
      thinkingFormat: 'deepseek',
      requiresReasoningContentOnAssistantMessages: true,
    },
  };
  const models = createModels();
  models.setProvider(
    createProvider({
      id: 'deepseek',
      baseUrl: model.baseUrl,
      auth: { apiKey: envApiKeyAuth('DeepSeek', ['DEEPSEEK_API_KEY']) },
      models: [model],
      api: openAICompletionsApi(),
    }),
  );
  let turns = 0;
  let exhausted = false;
  let repairUnlocked = Boolean(input.repairUnlocked);
  let actionCompleted = false;
  let contextFailure;
  agent = new Agent({
    initialState: {
      model,
      systemPrompt: input.systemPrompt ?? '',
      messages: input.messages ?? [],
      thinkingLevel: 'off',
      tools: (input.tools ?? []).map((tool) => ({
        ...tool,
        label: tool.name,
        execute: async (id, args, signal) => {
          let result;
          try {
            result = await ask(
              { type: 'tool_request', id, name: tool.name, args },
              signal,
            );
          } catch (error) {
            if (tool.name === 'execute_action') repairUnlocked = true;
            throw error;
          }
          if (
            input.confirmedAction &&
            tool.name === 'execute_action' &&
            result.status === 'completed'
          )
            actionCompleted = true;
          return {
            content: [{ type: 'text', text: JSON.stringify(result) }],
            details: {},
            isError:
              result.isError === true ||
              result.timedOut === true ||
              (typeof result.exitCode === 'number' && result.exitCode !== 0),
          };
        },
      })),
    },
    sessionId: input.sessionId,
    toolExecution: 'sequential',
    transformContext: input.managedContext
      ? async (messages, signal) => {
          try {
            return await ask({ type: 'context_request', messages }, signal);
          } catch (error) {
            contextFailure = error;
            agent.abort();
            return [];
          }
        }
      : undefined,
    streamFn: (current, context, options) =>
      models.streamSimple(
        current,
        input.confirmedAction && !repairUnlocked && !input.developmentMode
          ? {
              ...context,
              tools: context.tools?.filter(
                (tool) => tool.name === 'execute_action',
              ),
            }
          : context,
        {
          ...options,
          maxTokens: Math.min(input.maxTokens ?? 12288, 16384),
        },
      ),
    shouldStopAfterTurn: () => {
      if (actionCompleted) return true;
      exhausted = ++turns >= (input.maxTurns ?? 12);
      return exhausted;
    },
  });
  agent.subscribe(async (event, signal) => {
    // Incremental thought deltas stay private and are not emitted to the UI.
    if (event.type === 'message_update') return;
    if (event.type === 'message_end')
      await ask({ type: 'event', event }, signal);
    else send({ type: 'event', event });
  });
  send({ type: 'ready', runtime: 'pi-agent-core', version });
  try {
    if (input.continue) await agent.continue();
    else await agent.prompt(input.prompt ?? '继续完成当前任务。');
  } catch (error) {
    throw contextFailure ?? error;
  }
  if (contextFailure) throw contextFailure;
  const messages = agent.state.messages;
  const last = [...messages]
    .reverse()
    .find((message) => message.role === 'assistant');
  if (!actionCompleted && exhausted && last?.stopReason === 'toolUse')
    throw new Error('PI_BUDGET_EXHAUSTED');
  if (!last || ['error', 'aborted', 'length'].includes(last.stopReason)) {
    const code =
      last?.stopReason === 'aborted'
        ? 'PI_CANCELLED'
        : last?.stopReason === 'length'
          ? 'PI_OUTPUT_TRUNCATED'
          : 'PI_PROVIDER_ERROR';
    throw new Error(code);
  }
  send({
    type: 'completed',
    runtime: 'pi-agent-core',
    version,
    messages,
    text: last.content
      .filter((part) => part.type === 'text')
      .map((part) => part.text)
      .join(''),
    usage: last.usage,
  });
}

// LF only: readline also splits legitimate Unicode separators in JSON strings.
let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  if (buffer.length > 16 * 1024 * 1024) {
    send({ type: 'failed', code: 'PI_PROTOCOL_LIMIT' });
    process.exit(1);
  }
  let newline = buffer.indexOf('\n');
  while (newline >= 0) {
    const line = buffer.slice(0, newline);
    buffer = buffer.slice(newline + 1);
    try {
      const message = JSON.parse(line);
      if (message.type === 'start')
        void start(message).catch((error) =>
          send({
            type: 'failed',
            code: /^(PI_|CONTEXT_)[A-Z_]+$/.test(error.message)
              ? error.message
              : 'PI_HOST_ERROR',
          }),
        );
      else if (message.type === 'abort') {
        agent?.clearAllQueues();
        agent?.abort();
        void (agent?.waitForIdle() ?? Promise.resolve()).finally(() =>
          process.exit(0),
        );
      } else {
        const callback = waiting.get(message.id);
        waiting.delete(message.id);
        callback?.(message);
      }
    } catch {
      send({ type: 'failed', code: 'PI_PROTOCOL_INVALID' });
    }
    newline = buffer.indexOf('\n');
  }
});
process.stdin.on('end', () => {
  agent?.abort();
  process.exit(0);
});
