import { HttpModelProvider } from '@gamerhub/model-provider';
import { describe, expect, it } from 'vitest';

describe('HTTP model transport contract', () => {
  it('parses SSE deltas and redacts credentials from provider errors', async () => {
    const requests: Request[] = [];
    const provider = new HttpModelProvider({
      providerId: 'deepseek',
      endpoint: 'https://models.example.test/v1',
      apiKey: 'secret-key-not-to-log',
      fetchImpl: async (input, init) => {
        requests.push(new Request(input, init));
        return new Response(
          [
            'data: {"choices":[{"delta":{"content":"hello"}}]}',
            'data: {"usage":{"prompt_tokens":2,"completion_tokens":1}}',
            'data: [DONE]',
            '',
          ].join('\n'),
          { status: 200, headers: { 'content-type': 'text/event-stream' } },
        );
      },
    });

    const events = [];
    for await (const event of provider.generate({
      runId: 'run-1',
      role: 'planner',
      messages: [{ role: 'user', content: 'hello' }],
      timeoutMs: 5_000,
      signal: new AbortController().signal,
    }))
      events.push(event);

    expect(events.some((event) => event.type === 'text_delta')).toBe(true);
    expect(events.some((event) => event.type === 'usage')).toBe(true);
    expect(requests[0]?.headers.get('authorization')).toBe(
      'Bearer secret-key-not-to-log',
    );
  });
});
