import type { AssetRepository } from '@gamerhub/assets';
import type { PostgresDomainRepository } from '@gamerhub/domain';
import {
  type ArtGeneration,
  type ArtPlan,
  artRoles,
} from '@gamerhub/game-spec';
import { expect, it, vi } from 'vitest';
import { ArtStore } from '../../apps/local-dev/src/art-store';

function partialPlan(): ArtPlan {
  const generation: ArtGeneration = {
    id: '00000000-0000-4000-8000-000000000001',
    source: 'builtin',
    provider: 'builtin',
    fingerprint: `sha256-${'b'.repeat(64)}`,
    phase: 'images',
    total: 8,
    completed: 1,
    styles: ['day', 'night'],
    requirements: artRoles.map((role) => ({ role, description: role })),
    candidates: ['day', 'night'].map((style, index) => ({
      id: `00000000-0000-4000-8000-00000000000${index + 2}`,
      name: style,
      style,
      source: 'builtin',
      assets: index
        ? []
        : [
            {
              role: 'cat',
              name: 'cat.png',
              assetId: '00000000-0000-4000-8000-000000000004',
              contentHash: `sha256-${'a'.repeat(64)}`,
            },
          ],
    })),
  };
  return {
    revision: 0,
    status: 'failed',
    prompt: '',
    requirements: [],
    candidates: [],
    generation,
  };
}

it.each([
  ['foreign project', []],
  [
    'wrong hash',
    [
      {
        id: '00000000-0000-4000-8000-000000000004',
        contentHash: `sha256-${'c'.repeat(64)}`,
        securityStatus: 'approved',
      },
    ],
  ],
  [
    'unapproved asset',
    [
      {
        id: '00000000-0000-4000-8000-000000000004',
        contentHash: `sha256-${'a'.repeat(64)}`,
        securityStatus: 'quarantined',
      },
    ],
  ],
])(
  'rejects pending bindings with %s before mutation',
  async (_label, projectAssets) => {
    const transaction = vi.fn();
    const list = vi.fn(async () => projectAssets);
    const service = new ArtStore(
      {
        withTenantTransaction: transaction,
      } as unknown as PostgresDomainRepository,
      'owner',
      { list } as unknown as AssetRepository,
    );
    const plan = partialPlan();
    vi.spyOn(service, 'get').mockResolvedValue(plan);
    await expect(service.save('target-project', 0, plan)).rejects.toMatchObject(
      { code: 'ART_ASSET_INVALID', statusCode: 400 },
    );
    expect(list).toHaveBeenCalledWith('target-project');
    expect(transaction).not.toHaveBeenCalled();
  },
);

it('rejects malformed checkpoint progress before looking up assets or writing', async () => {
  const transaction = vi.fn();
  const list = vi.fn(async () => []);
  const service = new ArtStore(
    {
      withTenantTransaction: transaction,
    } as unknown as PostgresDomainRepository,
    'owner',
    { list } as unknown as AssetRepository,
  );
  const plan = partialPlan();
  plan.generation = {
    ...(plan.generation as ArtGeneration),
    completed: 8,
    phase: 'complete',
  };
  vi.spyOn(service, 'get').mockResolvedValue(plan);
  await expect(service.save('target-project', 0, plan)).rejects.toMatchObject({
    code: 'ART_GENERATION_INVALID',
    statusCode: 400,
  });
  expect(list).not.toHaveBeenCalled();
  expect(transaction).not.toHaveBeenCalled();
});

it.each([false, true])(
  'persists owned progress while retaining legacy plan support (legacy=%s)',
  async (legacy) => {
    const plan = partialPlan();
    if (legacy) delete plan.generation;
    const query = vi.fn(async (sql: string) => ({
      rows: sql.startsWith('SELECT document FROM project_art_plans')
        ? [{ document: plan }]
        : [],
    }));
    const transaction = vi.fn(async (_owner, callback) => callback({ query }));
    const service = new ArtStore(
      {
        withTenantTransaction: transaction,
      } as unknown as PostgresDomainRepository,
      'owner',
      {
        list: async () => [
          {
            id: '00000000-0000-4000-8000-000000000004',
            contentHash: `sha256-${'a'.repeat(64)}`,
            securityStatus: 'approved',
          },
        ],
      } as unknown as AssetRepository,
    );
    vi.spyOn(service, 'get').mockResolvedValue(plan);
    const saved = await service.save('target-project', 0, plan);
    expect(saved).toEqual({ ...plan, revision: 1 });
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE project_art_plans'),
      ['target-project', JSON.stringify(saved)],
    );
  },
);

it('rejects candidate asset references absent from the target project before mutation', async () => {
  const transaction = vi.fn();
  const store = {
    withTenantTransaction: transaction,
  } as unknown as PostgresDomainRepository;
  const list = vi.fn(async () => []);
  const assets = { list } as unknown as AssetRepository;
  const service = new ArtStore(store, 'owner', assets);
  const plan: ArtPlan = {
    revision: 0,
    status: 'ready',
    prompt: '',
    requirements: [],
    candidates: [
      {
        id: 'candidate',
        name: '月色森林',
        source: 'builtin',
        style: 'night',
        assets: ['cat', 'forest', 'coin', 'stump'].map((role, index) => ({
          role: role as 'cat',
          assetId: `00000000-0000-4000-8000-00000000000${index + 1}`,
          contentHash: `sha256-${'a'.repeat(64)}`,
          name: role,
        })),
      },
    ],
  };
  vi.spyOn(service, 'get').mockResolvedValue(plan);
  await expect(
    service.save('target-project', 0, plan, true),
  ).rejects.toMatchObject({ code: 'ART_ASSET_INVALID' });
  expect(list).toHaveBeenCalledWith('target-project');
  expect(transaction).not.toHaveBeenCalled();
});

it('checks project ownership before reading any candidate document', async () => {
  const transaction = vi.fn();
  const getProject = vi.fn(async () => {
    throw new Error('PROJECT_NOT_FOUND');
  });
  const service = new ArtStore(
    {
      getProject,
      withTenantTransaction: transaction,
    } as unknown as PostgresDomainRepository,
    'owner',
    {} as AssetRepository,
  );
  await expect(service.get('other-project')).rejects.toThrow(
    'PROJECT_NOT_FOUND',
  );
  expect(getProject).toHaveBeenCalledWith('other-project', {
    ownerId: 'owner',
  });
  expect(transaction).not.toHaveBeenCalled();
});
