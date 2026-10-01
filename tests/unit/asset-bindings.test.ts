import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyArtBindings } from '../../apps/local-dev/src/apply-art';
import {
  type ArtCandidate,
  bindCandidate,
} from '../../packages/game-spec/src/art-plan';
import {
  designMarkdown,
  initialBrief,
} from '../../packages/game-spec/src/design-document';
import { runnerGameSpec } from '../../packages/game-spec/src/runner-fixture';

const bytes = Buffer.from('verified-image-content');
const hash = `sha256-${createHash('sha256').update(bytes).digest('hex')}`;
const candidate: ArtCandidate = {
  id: 'candidate-night',
  name: '月色森林',
  source: 'builtin',
  style: 'night',
  assets: ['cat', 'forest', 'coin', 'stump'].map((role, index) => ({
    role: role as 'cat' | 'forest' | 'coin' | 'stump',
    assetId: `00000000-0000-4000-8000-00000000000${index + 1}`,
    contentHash: hash,
    name: role,
  })),
};

describe('confirmed art bindings', () => {
  it('describes the selected palette without claiming the default artwork', () => {
    const markdown = designMarkdown(initialBrief, candidate);
    expect(markdown).toContain('月色森林');
    expect(markdown).not.toContain('温暖的手绘森林');
    expect(markdown).toContain('内置素材库');
  });
  it('requires a complete unique role set and snapshots immutable source hashes', () => {
    expect(() =>
      bindCandidate(runnerGameSpec, {
        ...candidate,
        assets: candidate.assets.slice(1),
      }),
    ).toThrow('ART_INCOMPLETE');
    const spec = bindCandidate(runnerGameSpec, candidate);
    expect(
      spec.assets.find((asset) => asset.logical_id === 'cat_player')?.asset_id,
    ).toBe(candidate.assets[0].assetId);
    expect(runnerGameSpec.assets[0].asset_id).toBeUndefined();
  });

  it('imports all four roles into the actual Unity resource paths', async () => {
    const root = await mkdtemp(join(tmpdir(), 'gamerhub-art-'));
    try {
      const reads: string[] = [];
      await applyArtBindings(
        root,
        'project',
        bindCandidate(runnerGameSpec, candidate),
        {
          async readAsset(projectId: string, assetId: string) {
            reads.push(`${projectId}:${assetId}`);
            return {
              bytes,
              asset: { contentHash: hash, mediaType: 'image/png' },
            };
          },
        },
      );
      expect(reads).toHaveLength(4);
      expect(
        await readFile(join(root, 'Assets/Resources/Art/forest.png')),
      ).toEqual(bytes);
      const manifest = JSON.parse(
        await readFile(
          join(root, 'Assets/Resources/GamerHubArtBindings.json'),
          'utf8',
        ),
      );
      expect(manifest.candidateId).toBe(candidate.id);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects corrupted object bytes even when metadata claims the expected hash', async () => {
    await expect(
      applyArtBindings(
        'unused',
        'project',
        bindCandidate(runnerGameSpec, candidate),
        {
          async readAsset() {
            return {
              bytes: Buffer.from('tampered'),
              asset: { contentHash: hash, mediaType: 'image/png' },
            };
          },
        },
      ),
    ).rejects.toThrow('ART_CONTENT_HASH_MISMATCH');
  });
});
