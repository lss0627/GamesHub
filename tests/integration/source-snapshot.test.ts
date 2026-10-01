import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import {
  recordSourceVersion,
  restoreSource,
  restoreSourceVersion,
  snapshotSource,
} from '../../apps/local-dev/src/source-snapshot';

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'gamerhub-source-'));
  roots.push(root);
  for (const folder of [
    'Assets/Game',
    'Assets/GamerHub',
    'Packages',
    'ProjectSettings',
    'Builds/Web',
  ])
    await mkdir(join(root, folder), { recursive: true });
  await writeFile(join(root, 'Assets/Game/Main.cs'), 'v1');
  await writeFile(
    join(root, 'Assets/GamerHub/TemplateManifest.json'),
    '{"version":1}',
  );
  await writeFile(join(root, 'Builds/Web/published.html'), 'immutable');
  return root;
}
it('restores source, manifest and deletions without changing immutable builds', async () => {
  const root = await fixture();
  const revision = await snapshotSource(root);
  await writeFile(join(root, 'Assets/Game/Main.cs'), 'v2');
  await writeFile(join(root, 'Assets/Game/New.cs'), 'new-mechanism');
  await writeFile(
    join(root, 'Assets/GamerHub/TemplateManifest.json'),
    '{"version":2}',
  );
  await restoreSource(root, revision);
  expect(await readFile(join(root, 'Assets/Game/Main.cs'), 'utf8')).toBe('v1');
  expect(
    await readFile(join(root, 'Assets/GamerHub/TemplateManifest.json'), 'utf8'),
  ).toBe('{"version":1}');
  await expect(
    readFile(join(root, 'Assets/Game/New.cs')),
  ).rejects.toMatchObject({ code: 'ENOENT' });
  expect(await readFile(join(root, 'Builds/Web/published.html'), 'utf8')).toBe(
    'immutable',
  );
  expect(await snapshotSource(root)).toBe(revision);
});
it('rejects corrupt snapshot content before restoring any source', async () => {
  const root = await fixture();
  const revision = await snapshotSource(root);
  await writeFile(
    join(root, '.gamerhub/snapshots', revision, 'Assets/Game/Main.cs'),
    'tampered',
  );
  await writeFile(join(root, 'Assets/Game/Main.cs'), 'current');
  await expect(restoreSource(root, revision)).rejects.toThrow(
    'SOURCE_SNAPSHOT_CORRUPT',
  );
  expect(await readFile(join(root, 'Assets/Game/Main.cs'), 'utf8')).toBe(
    'current',
  );
});
it('does not accept another project snapshot or unsafe revision path', async () => {
  const root = await fixture();
  const revision = await snapshotSource(root);
  const other = await fixture();
  await expect(restoreSource(other, revision)).rejects.toThrow(
    'SOURCE_SNAPSHOT_NOT_FOUND',
  );
  await expect(restoreSource(other, '../escape')).rejects.toThrow(
    'SOURCE_REVISION_INVALID',
  );
});

it('keeps a published version mapped to its original source', async () => {
  const root = await fixture();
  const first = await recordSourceVersion(root, 'published_1');
  expect(await recordSourceVersion(root, 'published_1')).toBe(first);
  await writeFile(join(root, 'Assets/Game/Main.cs'), 'new implementation');
  await expect(recordSourceVersion(root, 'published_1')).rejects.toThrow(
    'SOURCE_VERSION_IMMUTABLE',
  );
  await restoreSourceVersion(root, 'published_1');
  expect(await readFile(join(root, 'Assets/Game/Main.cs'), 'utf8')).toBe('v1');
});
