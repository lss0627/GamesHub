import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type GameSpec, specCreative } from '@gamerhub/game-spec';

export async function applyCreative(
  projectPath: string,
  projectId: string,
  spec: GameSpec,
  repository?: {
    readAsset(
      projectId: string,
      assetId: string,
    ): Promise<{
      bytes: Uint8Array;
      asset: { contentHash: string; mediaType: string };
    }>;
  },
): Promise<void> {
  const document = specCreative(spec);
  const refs = new Map(
    [
      ...document.nodes
        .filter((n) => n.assetId)
        .map((n) => ({ ...n, audio: false })),
      ...document.sounds
        .filter((s) => s.source === 'asset')
        .map((s) => ({ ...s, audio: true })),
    ].map((item) => [
      `${item.assetId}:${item.contentHash}:${item.audio}`,
      item,
    ]),
  );
  let totalBytes = 0;
  const inputs = await Promise.all(
    [...refs.values()].map(async (ref) => {
      if (!repository) throw new Error('CREATIVE_REPOSITORY_REQUIRED');
      const item = await repository.readAsset(projectId, ref.assetId);
      const hash = `sha256-${createHash('sha256').update(item.bytes).digest('hex')}`;
      if (hash !== ref.contentHash || hash !== item.asset.contentHash)
        throw new Error('CREATIVE_CONTENT_HASH_MISMATCH');
      const extension = ref.audio
        ? item.asset.mediaType === 'audio/wav'
          ? 'wav'
          : undefined
        : (
            { 'image/png': 'png', 'image/jpeg': 'jpg' } as Record<
              string,
              string
            >
          )[item.asset.mediaType];
      if (!extension) throw new Error('CREATIVE_ASSET_INVALID');
      totalBytes += item.bytes.length;
      if (totalBytes > 32 * 1024 * 1024)
        throw new Error('CREATIVE_MEDIA_LIMIT');
      return { path: `${ref.assetId}.${extension}`, bytes: item.bytes };
    }),
  );
  // The caller owns a source attempt/checkpoint. Validate every reference before mutation.
  const directory = join(projectPath, 'Assets/Resources/Creative');
  await mkdir(directory, { recursive: true });
  for (const input of inputs)
    await writeFile(join(directory, input.path), input.bytes);
  await writeFile(
    join(projectPath, 'Assets/Resources/GamerHubCreative.json'),
    JSON.stringify(document),
  );
}
