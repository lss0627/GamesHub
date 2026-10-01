import {
  assembleToolCall,
  createConfiguredModelProvider,
  createRoleRouter,
  InMemoryModelProvider,
  parseStructuredJsonText,
} from '@gamerhub/model-provider';
import { describe, expect, it } from 'vitest';

describe('ModelProvider contract', () => {
  it('extracts one complete structured value from safe model wrappers', () => {
    expect(parseStructuredJsonText('```json\n{"plan":"runner"}\n```')).toEqual({
      plan: 'runner',
    });
    expect(
      parseStructuredJsonText('Result follows:\n{"plan":{"kind":"runner"}}'),
    ).toEqual({ plan: { kind: 'runner' } });
    expect(() => parseStructuredJsonText('{"plan":')).toThrow(
      /MODEL_OUTPUT_INVALID/,
    );
  });

  it('routes each role only to a provider with the required capabilities', async () => {
    const provider = new InMemoryModelProvider({
      providerId: 'fixture',
      capabilities: ['text', 'structured_output', 'tool_calling'],
    });
    const router = createRoleRouter([provider]);
    expect((await router.select('planner')).providerId).toBe('fixture');
    expect(() => router.selectSync('vision')).toThrow(
      /MODEL_CAPABILITY_MISSING/,
    );
  });

  it('assembles partial tool-call deltas by id and index', () => {
    expect(
      assembleToolCall([
        { id: 'call-1', index: 0, argumentsDelta: '{"x":' },
        { id: 'call-1', index: 0, argumentsDelta: '1}' },
      ]),
    ).toEqual({ id: 'call-1', index: 0, arguments: { x: 1 } });
    expect(() =>
      assembleToolCall([
        { id: 'call-1', index: 0, argumentsDelta: '{"x":' },
        { id: 'call-2', index: 0, argumentsDelta: '1}' },
      ]),
    ).toThrow(/MODEL_OUTPUT_INVALID/);
  });

  it('cancels streaming and rejects malformed structured output', async () => {
    const provider = new InMemoryModelProvider({
      providerId: 'fixture',
      capabilities: ['text', 'structured_output'],
    });
    const controller = new AbortController();
    controller.abort();
    const stream = provider.generate({
      runId: 'run-1',
      role: 'planner',
      messages: [{ role: 'user', content: 'hi' }],
      outputSchema: { type: 'object', required: ['plan'] },
      signal: controller.signal,
      timeoutMs: 1000,
    });
    await expect(
      (async () => {
        for await (const _event of stream) {
          /* consume */
        }
      })(),
    ).rejects.toMatchObject({ code: 'MODEL_CANCELLED' });
    await expect(
      provider.validateStructuredOutput(
        { invalid: true },
        { type: 'object', required: ['plan'] },
      ),
    ).rejects.toMatchObject({ code: 'MODEL_OUTPUT_INVALID' });
  });

  it('fails closed without a DeepSeek key unless local fallback is explicit', () => {
    const source = {
      MODEL_PROVIDER_ID: 'deepseek',
      MODEL_API_KEY_REF: 'secret://env/DEEPSEEK_API_KEY',
    };
    expect(() =>
      createConfiguredModelProvider(source, { allowFixture: false }),
    ).toThrow(/DEEPSEEK_API_KEY/);

    const fallback = createConfiguredModelProvider(source, {
      allowFixture: true,
      allowMissingDeepSeekKeyFallback: true,
    });
    expect(fallback).toMatchObject({
      mode: 'fixture',
      requestedProviderId: 'deepseek',
      awaitingSecret: true,
    });
    expect(JSON.stringify(fallback)).not.toContain('apiKey');
  });

  it('uses the official DeepSeek endpoint and clamps the output budget', async () => {
    const requests: Request[] = [];
    const configuration = createConfiguredModelProvider(
      {
        MODEL_PROVIDER_ID: 'deepseek',
        MODEL_API_KEY_REF: 'secret://env/DEEPSEEK_API_KEY',
        DEEPSEEK_API_KEY: 'test-only-deepseek-key',
        MODEL_MAX_OUTPUT_TOKENS: '1024',
      },
      {
        allowFixture: false,
        fetchImpl: async (input, init) => {
          requests.push(new Request(input, init));
          if (String(input).endsWith('/models'))
            return Response.json({ data: [{ id: 'deepseek-v4-pro' }] });
          return new Response(
            [
              'data: {"choices":[{"delta":{"content":"{}"}}]}',
              'data: [DONE]',
              '',
            ].join('\n'),
            {
              status: 200,
              headers: { 'content-type': 'text/event-stream' },
            },
          );
        },
      },
    );

    expect(configuration).toMatchObject({
      mode: 'deepseek',
      modelId: 'deepseek-v4-pro',
      endpoint: 'https://api.deepseek.com',
      awaitingSecret: false,
    });
    await configuration.provider.listModels();
    for await (const _event of configuration.provider.generate({
      runId: 'run-deepseek-contract',
      role: 'planner',
      messages: [{ role: 'user', content: 'create a runner' }],
      tokenBudget: 4096,
      timeoutMs: 5000,
      signal: new AbortController().signal,
    })) {
      // Consume the mocked stream.
    }

    expect(requests.map((request) => request.url)).toEqual([
      'https://api.deepseek.com/models',
      'https://api.deepseek.com/chat/completions',
    ]);
    expect(requests[1]?.headers.get('authorization')).toBe(
      'Bearer test-only-deepseek-key',
    );
    await expect(requests[1]?.json()).resolves.toMatchObject({
      model: 'deepseek-v4-pro',
      max_tokens: 1024,
    });
  });
});
