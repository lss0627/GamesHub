import { describe, expect, it } from 'vitest';
import { readApiResponse } from '../../apps/studio-web/src/features/creator/api-response';

describe('API response handling', () => {
  it('handles the Next proxy plain-text 500 without a JSON syntax error', async () => {
    await expect(
      readApiResponse(new Response('Internal Server Error', { status: 500 })),
    ).rejects.toThrow('服务暂时没有响应');
  });

  it('keeps known actionable API errors', async () => {
    await expect(
      readApiResponse(
        Response.json({ code: 'DESIGN_CHANGED' }, { status: 409 }),
        { DESIGN_CHANGED: '方案已更新' },
      ),
    ).rejects.toThrow('方案已更新');
  });

  it.each(['', '<html>Bad Gateway</html>', 'null', '"oops"'])(
    'rejects invalid successful payload %s clearly',
    async (body) => {
      await expect(readApiResponse(new Response(body))).rejects.toThrow(
        '服务返回了不完整的内容',
      );
    },
  );

  it('returns valid successful data', async () => {
    await expect(
      readApiResponse(Response.json({ revision: 2 })),
    ).resolves.toEqual({
      revision: 2,
    });
  });
});
