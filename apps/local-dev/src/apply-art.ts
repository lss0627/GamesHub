import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type GameSpec, specArt } from '@gamerhub/game-spec';

export async function applyArtBindings(
  projectPath: string,
  projectId: string,
  spec: GameSpec,
  repository: {
    readAsset(
      projectId: string,
      assetId: string,
    ): Promise<{
      bytes: Uint8Array;
      asset: { contentHash: string; mediaType: string };
    }>;
  },
): Promise<void> {
  const candidate = specArt(spec);
  if (!candidate) return;
  // Validate the entire set before writing any file. Runtime paths are fixed by role.
  const inputs = await Promise.all(
    candidate.assets.map(async (binding) => {
      const item = await repository.readAsset(projectId, binding.assetId);
      const hash = `sha256-${createHash('sha256').update(item.bytes).digest('hex')}`;
      if (hash !== binding.contentHash || hash !== item.asset.contentHash)
        throw new Error('ART_CONTENT_HASH_MISMATCH');
      if (item.asset.mediaType !== 'image/png')
        throw new Error('ART_PNG_REQUIRED');
      return { binding, bytes: item.bytes };
    }),
  );
  const directory = join(projectPath, 'Assets', 'Resources', 'Art');
  await mkdir(directory, { recursive: true });
  for (const { binding, bytes } of inputs)
    await writeFile(join(directory, `${binding.role}.png`), bytes);
  await writeFile(
    join(projectPath, 'Assets', 'Resources', 'GamerHubArtBindings.json'),
    JSON.stringify(
      {
        candidateId: candidate.id,
        name: candidate.name,
        assets: candidate.assets,
      },
      null,
      2,
    ),
  );
}
