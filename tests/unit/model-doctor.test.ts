import { describe, expect, it, vi } from 'vitest';
import { probeDeepSeekBalance } from '../../scripts/model-doctor-lib';

describe('DeepSeek model doctor balance probe', () => {
  it('reports an available account without exposing balance details', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          is_available: true,
          balance_infos: [{ currency: 'CNY', total_balance: '10.00' }],
        }),
        { status: 200 },
      ),
    );
    await expect(
      probeDeepSeekBalance({
        endpoint: 'https://api.deepseek.com',
        apiKey: 'secret-value',
        fetchImpl,
      }),
    ).resolves.toEqual({ available: true });
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.deepseek.com/user/balance',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer secret-value',
        }),
      }),
    );
  });

  it('fails closed when the account has no available balance', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ is_available: false }), { status: 200 }),
      );
    await expect(
      probeDeepSeekBalance({
        endpoint: 'https://api.deepseek.com/chat/completions',
        apiKey: 'secret-value',
        fetchImpl,
      }),
    ).resolves.toEqual({
      available: false,
      reason: 'INSUFFICIENT_BALANCE',
    });
  });

  it('fails closed on an invalid balance response', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('{}', { status: 200 }));
    await expect(
      probeDeepSeekBalance({
        endpoint: 'https://api.deepseek.com',
        apiKey: 'secret-value',
        fetchImpl,
      }),
    ).resolves.toEqual({
      available: false,
      reason: 'BALANCE_RESPONSE_INVALID',
    });
  });
});
