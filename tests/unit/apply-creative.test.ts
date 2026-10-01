import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  emptyCreative,
  runnerGameSpec,
  withCreative,
} from '@gamerhub/game-spec';
import { expect, it } from 'vitest';
import { applyCreative } from '../../apps/local-dev/src/apply-creative';

it('imports only checked project media and includes exact authored data', async () => {
  const root = await mkdtemp(join(tmpdir(), 'creative-'));
  try {
    const bytes = Buffer.from('validated media');
    const hash = `sha256-${createHash('sha256').update(bytes).digest('hex')}`;
    const document = {
      ...emptyCreative(),
      sounds: [
        {
          id: 'music',
          name: '背景',
          trigger: 'start' as const,
          source: 'asset' as const,
          assetId: '00000000-0000-4000-8000-000000000001',
          contentHash: hash,
          volume: 0.2,
          loop: true,
          frequency: 440,
          duration: 0.2,
        },
      ],
    };
    const spec = withCreative(runnerGameSpec, document);
    const repository = {
      readAsset: async (projectId: string) => {
        expect(projectId).toBe('project');
        return { bytes, asset: { contentHash: hash, mediaType: 'audio/wav' } };
      },
    };
    await applyCreative(root, 'project', spec, repository);
    const saved = JSON.parse(
      await readFile(
        join(root, 'Assets/Resources/GamerHubCreative.json'),
        'utf8',
      ),
    );
    expect(saved).toEqual(document);
    expect(
      await readFile(
        join(
          root,
          `Assets/Resources/Creative/${document.sounds[0].assetId}.wav`,
        ),
      ),
    ).toEqual(bytes);
    await expect(
      applyCreative(root, 'project', spec, {
        readAsset: async () => ({
          bytes: Buffer.from('tampered'),
          asset: { contentHash: hash, mediaType: 'audio/wav' },
        }),
      }),
    ).rejects.toThrow('CREATIVE_CONTENT_HASH_MISMATCH');
    expect(
      JSON.parse(
        await readFile(
          join(root, 'Assets/Resources/GamerHubCreative.json'),
          'utf8',
        ),
      ),
    ).toEqual(document);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
