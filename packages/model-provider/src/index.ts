export type ModelCapability =
  | 'text'
  | 'vision'
  | 'tool_calling'
  | 'structured_output'
  | 'reasoning';
export type ModelRole = 'planner' | 'coder' | 'vision' | 'evaluator';
export interface ModelDescriptor {
  modelId: string;
  contextWindow: number;
  capabilities: ModelCapability[];
  maxOutputTokens: number;
}
export interface ModelRequest {
  runId: string;
  context?: { projectId: string };
  role: ModelRole;
  messages: Array<{
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string;
  }>;
  images?: string[];
  tools?: Array<{ name: string; description?: string; inputSchema?: unknown }>;
  outputSchema?: { type: string; required?: string[] };
  tokenBudget?: number;
  timeoutMs: number;
  signal: AbortSignal;
}
export interface ModelStreamEvent {
  type:
    | 'message_start'
    | 'text_delta'
    | 'reasoning_delta'
    | 'tool_call_delta'
    | 'tool_call_complete'
    | 'usage'
    | 'message_complete'
    | 'provider_error';
  payload: Record<string, unknown>;
}
export interface ModelProvider {
  readonly providerId: string;
  listModels(): Promise<ModelDescriptor[]>;
  generate(request: ModelRequest): AsyncIterable<ModelStreamEvent>;
  countTokens(request: {
    messages: ModelRequest['messages'];
  }): Promise<{ promptTokens: number | null }>;
  health(): Promise<{
    status: 'ready' | 'degraded' | 'unavailable';
    providerId: string;
  }>;
}

export class ModelProviderError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(`${code}: ${message}`);
    this.name = 'ModelProviderError';
    this.code = code;
  }
}

export interface HttpModelProviderOptions {
  providerId: string;
  endpoint: string;
  apiKey: string;
  modelId?: string;
  contextWindow?: number;
  capabilities?: ModelCapability[];
  maxOutputTokens?: number;
  fetchImpl?: typeof fetch;
  defaultTimeoutMs?: number;
}

interface OpenAiUsage {
  prompt_tokens?: unknown;
  completion_tokens?: unknown;
  promptTokens?: unknown;
  completionTokens?: unknown;
  cached_tokens?: unknown;
  cachedTokens?: unknown;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function normalizedUsage(usage: OpenAiUsage): Record<string, unknown> {
  return {
    promptTokens: numberOrNull(usage.prompt_tokens ?? usage.promptTokens),
    completionTokens: numberOrNull(
      usage.completion_tokens ?? usage.completionTokens,
    ),
    cachedTokens: numberOrNull(usage.cached_tokens ?? usage.cachedTokens),
  };
}

function providerMessage(error: unknown, secret: string): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replaceAll(secret, '[REDACTED]').slice(0, 1000);
}

function completionEndpoint(endpoint: string): string {
  const base = endpoint.replace(/\/$/, '');
  return base.endsWith('/chat/completions') ? base : `${base}/chat/completions`;
}

function modelsEndpoint(endpoint: string): string {
  const base = endpoint.replace(/\/$/, '');
  return base.endsWith('/chat/completions')
    ? `${base.slice(0, -'/chat/completions'.length)}/models`
    : `${base}/models`;
}

function firstCompleteJsonValue(text: string): string | undefined {
  const start = text.search(/[[{]/);
  if (start < 0) return undefined;
  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const character = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      continue;
    }
    if (character === '{' || character === '[') {
      stack.push(character);
      continue;
    }
    if (character !== '}' && character !== ']') continue;
    const opening = stack.pop();
    if (
      (character === '}' && opening !== '{') ||
      (character === ']' && opening !== '[')
    )
      return undefined;
    if (stack.length === 0) return text.slice(start, index + 1);
  }
  return undefined;
}

/**
 * Parses one complete structured JSON value while tolerating transport-level
 * Markdown fences or a short explanatory wrapper. Schema validation remains a
 * separate mandatory step; malformed or incomplete JSON still fails closed.
 */
export function parseStructuredJsonText(text: string): unknown {
  const normalized = text.replace(/^\uFEFF/, '').trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(normalized)?.[1];
  const extracted = firstCompleteJsonValue(normalized);
  const candidates = [...new Set([normalized, fenced, extracted])].filter(
    (candidate): candidate is string => Boolean(candidate?.trim()),
  );
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // Try the next safely bounded representation.
    }
  }
  throw new ModelProviderError(
    'MODEL_OUTPUT_INVALID',
    'Structured model output is not valid JSON',
  );
}

function parseRequiredSchema(
  value: unknown,
  schema: { type: string; required?: string[] },
): boolean {
  if (schema.type === 'object') {
    return (
      typeof value === 'object' &&
      value !== null &&
      !Array.isArray(value) &&
      (schema.required ?? []).every((key) => key in value)
    );
  }
  return true;
}

/**
 * OpenAI-compatible HTTP transport used by DeepSeek and Pi deployments.
 * Credentials are kept in the request layer and are never copied into events
 * or surfaced in provider errors.
 */
export class HttpModelProvider implements ModelProvider {
  readonly providerId: string;
  private readonly endpoint: string;
  private readonly apiKey: string;
  private readonly modelId: string;
  private readonly contextWindow: number;
  private readonly capabilities: ModelCapability[];
  private readonly maxOutputTokens: number;
  private readonly fetchImpl: typeof fetch;
  private readonly defaultTimeoutMs: number;

  constructor(options: HttpModelProviderOptions) {
    if (!options.providerId.trim())
      throw new ModelProviderError('CONFIG_INVALID', 'providerId is required');
    if (!/^https?:\/\//.test(options.endpoint))
      throw new ModelProviderError(
        'CONFIG_INVALID',
        'HTTP model endpoint is invalid',
      );
    if (!options.apiKey.trim())
      throw new ModelProviderError(
        'CONFIG_INVALID',
        'model API key is required',
      );
    this.providerId = options.providerId;
    this.endpoint = options.endpoint;
    this.apiKey = options.apiKey;
    this.modelId = options.modelId ?? `${options.providerId}-production`;
    this.contextWindow = options.contextWindow ?? 128_000;
    this.capabilities = [
      ...(options.capabilities ?? [
        'text',
        'tool_calling',
        'structured_output',
      ]),
    ];
    this.maxOutputTokens = options.maxOutputTokens ?? 8192;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? 30_000;
  }

  async listModels(): Promise<ModelDescriptor[]> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.defaultTimeoutMs);
    try {
      const response = await this.fetchImpl(modelsEndpoint(this.endpoint), {
        method: 'GET',
        headers: { Authorization: `Bearer ${this.apiKey}` },
        signal: controller.signal,
      });
      if (!response.ok)
        throw new ModelProviderError(
          'PROVIDER_UNAVAILABLE',
          `Model provider returned HTTP ${response.status}`,
        );
      const body: unknown = await response.json();
      const data =
        body && typeof body === 'object' && 'data' in body
          ? (body as { data?: unknown }).data
          : undefined;
      if (!Array.isArray(data) || data.length === 0) return [this.descriptor()];
      return data.map((item) => {
        const record = item && typeof item === 'object' ? item : {};
        const id =
          'id' in record && typeof record.id === 'string'
            ? record.id
            : this.modelId;
        return {
          modelId: id,
          contextWindow: this.contextWindow,
          capabilities: [...this.capabilities],
          maxOutputTokens: this.maxOutputTokens,
        };
      });
    } catch (error) {
      if (error instanceof ModelProviderError) throw error;
      throw new ModelProviderError(
        'PROVIDER_UNAVAILABLE',
        providerMessage(error, this.apiKey),
      );
    } finally {
      clearTimeout(timer);
    }
  }

  async countTokens(request: {
    messages: ModelRequest['messages'];
  }): Promise<{ promptTokens: number | null }> {
    // DeepSeek-compatible APIs do not expose a stable tokenizer endpoint. The
    // estimate is deliberately marked approximate in the payload contract.
    const characters = request.messages.reduce(
      (total, message) => total + message.content.length,
      0,
    );
    return { promptTokens: characters > 0 ? Math.ceil(characters / 4) : null };
  }

  async health() {
    try {
      await this.listModels();
      return { status: 'ready' as const, providerId: this.providerId };
    } catch {
      return { status: 'unavailable' as const, providerId: this.providerId };
    }
  }

  async validateStructuredOutput(
    value: unknown,
    schema: { type: string; required?: string[] },
  ): Promise<void> {
    if (!parseRequiredSchema(value, schema))
      throw new ModelProviderError(
        'MODEL_OUTPUT_INVALID',
        'Structured output does not satisfy the required schema',
      );
  }

  async *generate(request: ModelRequest): AsyncIterable<ModelStreamEvent> {
    if (request.signal.aborted)
      throw new ModelProviderError(
        'MODEL_CANCELLED',
        'Model generation was cancelled',
      );
    const controller = new AbortController();
    const abort = (): void => controller.abort();
    request.signal.addEventListener('abort', abort, { once: true });
    const timeout = setTimeout(
      () => controller.abort(),
      request.timeoutMs > 0 ? request.timeoutMs : this.defaultTimeoutMs,
    );
    const body: Record<string, unknown> = {
      model: this.modelId,
      messages: request.messages,
      stream: true,
      stream_options: { include_usage: true },
    };
    if (request.images?.length) body.images = request.images;
    if (request.tools?.length) body.tools = request.tools;
    if (request.tokenBudget)
      body.max_tokens = Math.min(request.tokenBudget, this.maxOutputTokens);
    if (request.outputSchema)
      body.response_format = {
        type: request.outputSchema.type === 'object' ? 'json_object' : 'text',
      };
    const toolArguments = new Map<number, { id: string; text: string }>();
    let text = '';
    let completed = false;
    try {
      const response = await this.fetchImpl(completionEndpoint(this.endpoint), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok)
        throw new ModelProviderError(
          'PROVIDER_ERROR',
          `Model provider returned HTTP ${response.status}`,
        );
      yield { type: 'message_start', payload: { providerId: this.providerId } };
      for await (const event of this.readEvents(response)) {
        if (event === '[DONE]') break;
        const record = event;
        const choices = Array.isArray(record.choices) ? record.choices : [];
        const choice =
          choices[0] && typeof choices[0] === 'object' ? choices[0] : {};
        const delta =
          'delta' in choice && choice.delta && typeof choice.delta === 'object'
            ? choice.delta
            : {};
        if ('content' in delta && typeof delta.content === 'string') {
          text += delta.content;
          yield { type: 'text_delta', payload: { text: delta.content } };
        }
        if (
          'reasoning_content' in delta &&
          typeof delta.reasoning_content === 'string'
        )
          yield {
            type: 'reasoning_delta',
            payload: { text: delta.reasoning_content },
          };
        const toolCalls =
          'tool_calls' in delta && Array.isArray(delta.tool_calls)
            ? delta.tool_calls
            : [];
        for (const toolCall of toolCalls) {
          if (!toolCall || typeof toolCall !== 'object') continue;
          const index = typeof toolCall.index === 'number' ? toolCall.index : 0;
          const id =
            typeof toolCall.id === 'string' ? toolCall.id : `call-${index}`;
          const fn =
            'function' in toolCall &&
            toolCall.function &&
            typeof toolCall.function === 'object'
              ? toolCall.function
              : {};
          const argumentsDelta =
            'arguments' in fn && typeof fn.arguments === 'string'
              ? fn.arguments
              : '';
          const prior = toolArguments.get(index) ?? { id, text: '' };
          const next = {
            id: prior.id || id,
            text: prior.text + argumentsDelta,
          };
          toolArguments.set(index, next);
          yield {
            type: 'tool_call_delta',
            payload: { id: next.id, index, argumentsDelta },
          };
        }
        if (record.usage && typeof record.usage === 'object')
          yield {
            type: 'usage',
            payload: normalizedUsage(record.usage as OpenAiUsage),
          };
        const finishReason =
          'finish_reason' in choice && typeof choice.finish_reason === 'string'
            ? choice.finish_reason
            : undefined;
        if (finishReason) {
          for (const [index, call] of toolArguments) {
            try {
              const parsed: unknown = JSON.parse(call.text || '{}');
              yield {
                type: 'tool_call_complete',
                payload: { id: call.id, index, arguments: parsed },
              };
            } catch {
              throw new ModelProviderError(
                'MODEL_OUTPUT_INVALID',
                'Tool-call arguments are not valid JSON',
              );
            }
          }
          yield { type: 'message_complete', payload: { finishReason } };
          completed = true;
        }
      }
      if (!completed)
        yield { type: 'message_complete', payload: { finishReason: 'stop' } };
      if (request.outputSchema) {
        const parsed = parseStructuredJsonText(text);
        await this.validateStructuredOutput(parsed, request.outputSchema);
      }
    } catch (error) {
      if (controller.signal.aborted) {
        const code = request.signal.aborted
          ? 'MODEL_CANCELLED'
          : 'MODEL_TIMEOUT';
        throw new ModelProviderError(
          code,
          'Model generation was cancelled or timed out',
        );
      }
      if (error instanceof ModelProviderError) throw error;
      yield {
        type: 'provider_error',
        payload: {
          code: 'PROVIDER_ERROR',
          message: providerMessage(error, this.apiKey),
        },
      };
      throw new ModelProviderError(
        'PROVIDER_ERROR',
        providerMessage(error, this.apiKey),
      );
    } finally {
      clearTimeout(timeout);
      request.signal.removeEventListener('abort', abort);
    }
  }

  private descriptor(): ModelDescriptor {
    return {
      modelId: this.modelId,
      contextWindow: this.contextWindow,
      capabilities: [...this.capabilities],
      maxOutputTokens: this.maxOutputTokens,
    };
  }

  private async *readEvents(
    response: Response,
  ): AsyncIterable<'[DONE]' | Record<string, unknown>> {
    if (!response.body) {
      const body: unknown = await response.json();
      if (body && typeof body === 'object')
        yield body as Record<string, unknown>;
      return;
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const consume = async function* (
      chunk: string,
    ): AsyncIterable<'[DONE]' | Record<string, unknown>> {
      buffer += chunk;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const data = trimmed.slice(5).trim();
        if (data === '[DONE]') {
          yield '[DONE]';
          continue;
        }
        try {
          const parsed: unknown = JSON.parse(data);
          if (parsed && typeof parsed === 'object')
            yield parsed as Record<string, unknown>;
        } catch {
          throw new ModelProviderError('PROVIDER_ERROR', 'Malformed SSE event');
        }
      }
    };
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      for await (const event of consume(
        decoder.decode(next.value, { stream: true }),
      ))
        yield event;
    }
    for await (const event of consume(decoder.decode())) yield event;
    if (buffer.trim().startsWith('data:')) {
      const data = buffer.trim().slice(5).trim();
      if (data === '[DONE]') yield '[DONE]';
      else {
        const parsed: unknown = JSON.parse(data);
        if (parsed && typeof parsed === 'object')
          yield parsed as Record<string, unknown>;
      }
    }
  }
}

export class InMemoryModelProvider implements ModelProvider {
  readonly providerId: string;
  readonly capabilities: ModelCapability[];
  private readonly descriptor: ModelDescriptor;

  constructor(options: {
    providerId: string;
    capabilities: ModelCapability[];
  }) {
    this.providerId = options.providerId;
    this.capabilities = [...options.capabilities];
    this.descriptor = {
      modelId: `${options.providerId}-fixture`,
      contextWindow: 128000,
      capabilities: this.capabilities,
      maxOutputTokens: 4096,
    };
  }

  async listModels(): Promise<ModelDescriptor[]> {
    return [
      { ...this.descriptor, capabilities: [...this.descriptor.capabilities] },
    ];
  }
  async countTokens(request: {
    messages: ModelRequest['messages'];
  }): Promise<{ promptTokens: number | null }> {
    return {
      promptTokens:
        request.messages.reduce((sum, item) => sum + item.content.length, 0) ||
        null,
    };
  }
  async health() {
    return { status: 'ready' as const, providerId: this.providerId };
  }
  async validateStructuredOutput(
    value: unknown,
    schema: { type: string; required?: string[] },
  ): Promise<void> {
    if (
      schema.type === 'object' &&
      (typeof value !== 'object' ||
        value === null ||
        (schema.required ?? []).some((key) => !(key in value)))
    )
      throw new ModelProviderError(
        'MODEL_OUTPUT_INVALID',
        'Structured output does not satisfy the required schema',
      );
  }
  async *generate(request: ModelRequest): AsyncIterable<ModelStreamEvent> {
    if (request.signal.aborted)
      throw new ModelProviderError(
        'MODEL_CANCELLED',
        'Model generation was cancelled',
      );
    yield { type: 'message_start', payload: { providerId: this.providerId } };
    yield { type: 'text_delta', payload: { text: 'fixture response' } };
    yield {
      type: 'usage',
      payload: {
        promptTokens: null,
        completionTokens: null,
        cachedTokens: null,
      },
    };
    yield { type: 'message_complete', payload: { finishReason: 'stop' } };
  }
}

const requiredCapabilities: Record<ModelRole, ModelCapability[]> = {
  planner: ['text', 'structured_output'],
  coder: ['text', 'tool_calling', 'structured_output'],
  vision: ['text', 'vision'],
  evaluator: ['text', 'structured_output'],
};
export function createRoleRouter(providers: ModelProvider[]) {
  const matches = (
    role: ModelRole,
    capabilities: ModelCapability[],
  ): boolean => {
    const required = requiredCapabilities[role];
    return required.every((capability) => capabilities.includes(capability));
  };
  const findSync = (role: ModelRole): ModelProvider => {
    const provider = providers.find((candidate) => {
      const capabilities =
        'capabilities' in candidate && Array.isArray(candidate.capabilities)
          ? (candidate.capabilities as ModelCapability[])
          : [];
      return Boolean(candidate.providerId) && matches(role, capabilities);
    });
    if (!provider)
      throw new ModelProviderError(
        'MODEL_CAPABILITY_MISSING',
        `No provider can satisfy role ${role}`,
      );
    return provider;
  };
  return {
    select: async (role: ModelRole) => {
      for (const provider of providers) {
        const models = await provider.listModels();
        if (
          provider.providerId &&
          models.some((model) => matches(role, model.capabilities))
        )
          return provider;
      }
      throw new ModelProviderError(
        'MODEL_CAPABILITY_MISSING',
        `No provider can satisfy role ${role}`,
      );
    },
    selectSync: (role: ModelRole) => findSync(role),
  };
}

export function assembleToolCall(
  deltas: Array<{ id: string; index: number; argumentsDelta: string }>,
): { id: string; index: number; arguments: Record<string, unknown> } {
  if (deltas.length === 0)
    throw new ModelProviderError(
      'MODEL_OUTPUT_INVALID',
      'No tool-call deltas supplied',
    );
  const first = deltas[0];
  if (!first)
    throw new ModelProviderError(
      'MODEL_OUTPUT_INVALID',
      'No tool-call deltas supplied',
    );
  if (
    deltas.some((delta) => delta.id !== first.id || delta.index !== first.index)
  )
    throw new ModelProviderError(
      'MODEL_OUTPUT_INVALID',
      'Tool-call deltas contain mixed ids or indexes',
    );
  const raw = deltas.map((delta) => delta.argumentsDelta).join('');
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      throw new Error('tool arguments must be an object');
    return {
      id: first.id,
      index: first.index,
      arguments: parsed as Record<string, unknown>,
    };
  } catch {
    throw new ModelProviderError(
      'MODEL_OUTPUT_INVALID',
      'Tool-call arguments are not valid JSON',
    );
  }
}

export interface ConfiguredModelProvider {
  provider: ModelProvider;
  mode: 'fixture' | 'deepseek';
  requestedProviderId: 'local-fixture' | 'deepseek';
  modelId: string;
  endpoint?: string;
  awaitingSecret: boolean;
}

export interface ConfiguredModelProviderOptions {
  allowFixture?: boolean;
  allowMissingDeepSeekKeyFallback?: boolean;
  fetchImpl?: typeof fetch;
}

function configuredInteger(
  source: Record<string, string | undefined>,
  name: string,
  fallback: number,
  range: { min: number; max: number },
): number {
  const raw = source[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < range.min || value > range.max)
    throw new ModelProviderError(
      'CONFIG_INVALID',
      `${name} must be an integer between ${range.min} and ${range.max}`,
    );
  return value;
}

function fixtureConfiguration(
  requestedProviderId: 'local-fixture' | 'deepseek',
  awaitingSecret: boolean,
): ConfiguredModelProvider {
  return {
    provider: new InMemoryModelProvider({
      providerId: 'local-fixture',
      capabilities: ['text', 'tool_calling', 'structured_output'],
    }),
    mode: 'fixture',
    requestedProviderId,
    modelId: 'local-fixture',
    awaitingSecret,
  };
}

/**
 * Creates the server-side model provider from environment-shaped values.
 * Raw credentials are accepted only through DEEPSEEK_API_KEY and are never
 * returned in the configuration metadata.
 */
export function createConfiguredModelProvider(
  source: Record<string, string | undefined> = process.env,
  options: ConfiguredModelProviderOptions = {},
): ConfiguredModelProvider {
  const requested = (source.MODEL_PROVIDER_ID ?? 'local-fixture').trim();
  if (requested === 'local-fixture') {
    if (options.allowFixture === false)
      throw new ModelProviderError(
        'CONFIG_INVALID',
        'MODEL_PROVIDER_ID=local-fixture is forbidden in this runtime',
      );
    return fixtureConfiguration('local-fixture', false);
  }
  if (requested !== 'deepseek')
    throw new ModelProviderError(
      'CONFIG_INVALID',
      `Unsupported MODEL_PROVIDER_ID: ${requested}`,
    );

  const expectedSecretRef = 'secret://env/DEEPSEEK_API_KEY';
  if (source.MODEL_API_KEY_REF !== expectedSecretRef)
    throw new ModelProviderError(
      'CONFIG_INVALID',
      `MODEL_API_KEY_REF must be ${expectedSecretRef}`,
    );
  const apiKey = source.DEEPSEEK_API_KEY?.trim();
  if (!apiKey) {
    if (
      options.allowMissingDeepSeekKeyFallback &&
      options.allowFixture !== false
    )
      return fixtureConfiguration('deepseek', true);
    throw new ModelProviderError(
      'CONFIG_INVALID',
      'DEEPSEEK_API_KEY is required when MODEL_PROVIDER_ID=deepseek',
    );
  }

  const endpoint = (
    source.MODEL_PROVIDER_ENDPOINT ?? 'https://api.deepseek.com'
  ).replace(/\/$/, '');
  let parsedEndpoint: URL;
  try {
    parsedEndpoint = new URL(endpoint);
  } catch {
    throw new ModelProviderError(
      'CONFIG_INVALID',
      'MODEL_PROVIDER_ENDPOINT must be a valid URL',
    );
  }
  if (parsedEndpoint.protocol !== 'https:')
    throw new ModelProviderError(
      'CONFIG_INVALID',
      'MODEL_PROVIDER_ENDPOINT must use HTTPS',
    );

  const modelId = source.MODEL_PROVIDER_MODEL_ID ?? 'deepseek-v4-pro';
  if (!['deepseek-v4-flash', 'deepseek-v4-pro'].includes(modelId))
    throw new ModelProviderError(
      'CONFIG_INVALID',
      'MODEL_PROVIDER_MODEL_ID must be deepseek-v4-flash or deepseek-v4-pro',
    );
  const contextWindow = configuredInteger(
    source,
    'MODEL_CONTEXT_WINDOW',
    1_000_000,
    { min: 8_192, max: 2_000_000 },
  );
  const maxOutputTokens = configuredInteger(
    source,
    'MODEL_MAX_OUTPUT_TOKENS',
    16_384,
    { min: 256, max: 384_000 },
  );
  const defaultTimeoutMs = configuredInteger(
    source,
    'MODEL_REQUEST_TIMEOUT_MS',
    120_000,
    { min: 1_000, max: 600_000 },
  );
  return {
    provider: new HttpModelProvider({
      providerId: 'deepseek',
      endpoint,
      apiKey,
      modelId,
      contextWindow,
      maxOutputTokens,
      defaultTimeoutMs,
      capabilities: ['text', 'tool_calling', 'structured_output', 'reasoning'],
      ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    }),
    mode: 'deepseek',
    requestedProviderId: 'deepseek',
    modelId,
    endpoint,
    awaitingSecret: false,
  };
}
