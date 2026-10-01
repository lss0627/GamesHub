import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { serveBrowserArtifact } from '../../apps/local-dev/src/browser-playtest';

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
it('serves only build files with WebGL headers and rejects writes and escaping links', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'browser-fence-'));
  roots.push(folder);
  const root = join(folder, 'build');
  await mkdir(root);
  await writeFile(join(root, 'index.html'), '<canvas></canvas>');
  await writeFile(join(folder, 'private.txt'), 'private');
  await mkdir(join(folder, 'outside'));
  await writeFile(join(folder, 'outside', 'secret.txt'), 'private');
  await symlink(join(folder, 'outside'), join(root, 'linked'), 'junction');
  const server = await serveBrowserArtifact(root);
  try {
    const response = await fetch(server.origin);
    expect(response.status).toBe(200);
    expect(response.headers.get('cross-origin-embedder-policy')).toBe(
      'require-corp',
    );
    for (const path of [
      '/linked/secret.txt',
      '/%2e%2e%5cprivate.txt',
      '/C:%5cprivate.txt',
    ])
      expect((await fetch(server.origin + path)).status).toBe(404);
    expect((await fetch(server.origin, { method: 'POST' })).status).toBe(405);
  } finally {
    await server.close();
  }
});
