import type { AssetRepository } from '@gamerhub/assets';
import type { PostgresDomainRepository } from '@gamerhub/domain';
import { beforeEach, expect, it, vi } from 'vitest';
import { ArtStore } from '../../apps/local-dev/src/art-store';

const { generate } = vi.hoisted(() => ({ generate: vi.fn() }));
vi.mock('@gamerhub/model-provider', async (original) => ({
  ...(await original<object>()),
  createConfiguredModelProvider: () => ({ provider: { generate } }),
}));
const valid = {
  requirements: ['cat', 'forest', 'coin', 'stump'].map((role) => ({
    role,
    description: '清晰可见的游戏素材',
  })),
  styles: ['night', 'dusk'],
};
const service = () =>
  new ArtStore(
    {
      getProject: vi.fn(async () => ({})),
      withTenantTransaction: vi.fn(async (_owner, operation) =>
        operation({
          query: async () => ({
            rows: [{ document: { brief: { genre: 'survivor' } } }],
          }),
        }),
      ),
    } as unknown as PostgresDomainRepository,
    'owner',
    {} as AssetRepository,
  );
const output = (text: string) =>
  async function* () {
    yield { type: 'text_delta', payload: { text } };
  };
beforeEach(() => generate.mockReset());

it('retries one malformed art brief and accepts only a complete set', async () => {
  generate
    .mockImplementationOnce(output('{"requirements":'))
    .mockImplementationOnce(output(JSON.stringify(valid)));
  await expect(service().brief('project', '月夜和暮色')).resolves.toEqual(
    valid,
  );
  expect(generate).toHaveBeenCalledTimes(2);
  expect(generate.mock.calls[0]?.[0].messages[0].content).toContain('经验掉落');
});
it('bounds invalid-output retries and returns a creator-safe planner error', async () => {
  generate.mockImplementation(output('null'));
  await expect(service().brief('project', '月夜和暮色')).rejects.toMatchObject({
    code: 'ART_PLANNER_INVALID',
    statusCode: 502,
  });
  expect(generate).toHaveBeenCalledTimes(2);
});
it('does not retry a provider outage as an invalid document', async () => {
  generate.mockImplementation(async function* () {
    yield { type: 'provider_error', payload: {} };
  });
  await expect(service().brief('project', '月夜和暮色')).rejects.toMatchObject({
    code: 'ART_PLANNER_UNAVAILABLE',
    statusCode: 503,
  });
  expect(generate).toHaveBeenCalledTimes(1);
});
