export interface DeepSeekBalanceProbe {
  available: boolean;
  reason?: string;
}

function apiBase(endpoint: string): string {
  return endpoint.replace(/\/$/, '').replace(/\/chat\/completions$/, '');
}

export async function probeDeepSeekBalance(options: {
  endpoint: string;
  apiKey: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<DeepSeekBalanceProbe> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? 10_000,
  );
  try {
    const response = await (options.fetchImpl ?? fetch)(
      `${apiBase(options.endpoint)}/user/balance`,
      {
        headers: {
          Authorization: `Bearer ${options.apiKey}`,
          Accept: 'application/json',
        },
        signal: controller.signal,
      },
    );
    if (!response.ok)
      return {
        available: false,
        reason: `BALANCE_CHECK_HTTP_${response.status}`,
      };
    const body: unknown = await response.json();
    if (
      !body ||
      typeof body !== 'object' ||
      !('is_available' in body) ||
      typeof body.is_available !== 'boolean'
    )
      return { available: false, reason: 'BALANCE_RESPONSE_INVALID' };
    return body.is_available
      ? { available: true }
      : { available: false, reason: 'INSUFFICIENT_BALANCE' };
  } catch (error) {
    return {
      available: false,
      reason:
        error instanceof Error && error.name === 'AbortError'
          ? 'BALANCE_CHECK_TIMEOUT'
          : 'BALANCE_CHECK_FAILED',
    };
  } finally {
    clearTimeout(timeout);
  }
}
