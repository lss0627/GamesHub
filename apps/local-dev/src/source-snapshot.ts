import { createHash, randomUUID } from 'node:crypto';
import type { Dirent } from 'node:fs';
import {
  link,
  lstat,
  mkdir,
  readdir,
  readFile,
  rename,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';

const sourceRoots = ['Assets', 'Packages', 'ProjectSettings'];
const digest = (value: Buffer | string) =>
  createHash('sha256').update(value).digest('hex');
type SourceIndex = Record<string, string>;
const revisionOf = (index: SourceIndex) =>
  `source-${digest(JSON.stringify(Object.entries(index).sort(([a], [b]) => a.localeCompare(b))))}`;

async function safe(root: string, name: string) {
  if (
    name.split('/').some((p) => !p || p === '.' || p === '..') ||
    name.includes('\\')
  )
    throw new Error('SOURCE_PATH_UNSAFE');
  const base = resolve(root);
  const target = resolve(base, name);
  if (!target.startsWith(`${base}${sep}`))
    throw new Error('SOURCE_PATH_UNSAFE');
  let current = base;
  for (const part of ['', ...name.split('/')]) {
    if (part) current = join(current, part);
    try {
      if ((await lstat(current)).isSymbolicLink())
        throw new Error('SOURCE_PATH_UNSAFE');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  return target;
}

export { safe as safeSourcePath };

async function collect(root: string) {
  const files = new Map<string, Buffer>();
  async function visit(name: string): Promise<void> {
    const path = await safe(root, name);
    let entries: Dirent[];
    try {
      entries = await readdir(path, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.isSymbolicLink()) throw new Error('SOURCE_PATH_UNSAFE');
      const child = `${name}/${entry.name}`;
      if (entry.isDirectory()) await visit(child);
      else if (entry.isFile())
        files.set(child, await readFile(await safe(root, child)));
    }
  }
  for (const name of sourceRoots) await visit(name);
  return files;
}
async function writeAtomic(path: string, bytes: Buffer | string) {
  await mkdir(dirname(path), { recursive: true });
  const staged = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(staged, bytes, { flag: 'wx' });
    await rename(staged, path);
  } finally {
    await unlink(staged).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
    });
  }
}

async function verifiedSnapshot(
  root: string,
  revision: string,
): Promise<Map<string, Buffer>> {
  if (!/^source-[a-f0-9]{64}$/.test(revision))
    throw new Error('SOURCE_REVISION_INVALID');
  const base = await safe(root, `.gamerhub/snapshots/${revision}`);
  let index: SourceIndex;
  try {
    index = JSON.parse(
      await readFile(await safe(base, 'manifest.json'), 'utf8'),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      throw new Error('SOURCE_SNAPSHOT_NOT_FOUND');
    throw new Error('SOURCE_SNAPSHOT_CORRUPT');
  }
  if (
    !index ||
    typeof index !== 'object' ||
    Array.isArray(index) ||
    revisionOf(index) !== revision
  )
    throw new Error('SOURCE_SNAPSHOT_CORRUPT');
  const files = new Map<string, Buffer>();
  for (const [name, hash] of Object.entries(index)) {
    if (
      !sourceRoots.some((p) => name.startsWith(`${p}/`)) ||
      !/^[a-f0-9]{64}$/.test(hash)
    )
      throw new Error('SOURCE_SNAPSHOT_CORRUPT');
    const bytes = await readFile(await safe(base, name)).catch(() => {
      throw new Error('SOURCE_SNAPSHOT_CORRUPT');
    });
    if (digest(bytes) !== hash) throw new Error('SOURCE_SNAPSHOT_CORRUPT');
    files.set(name, bytes);
  }
  return files;
}

export async function snapshotSource(projectRoot: string): Promise<string> {
  const files = await collect(projectRoot);
  const index = Object.fromEntries(
    [...files].map(([name, bytes]) => [name, digest(bytes)]),
  );
  const revision = revisionOf(index);
  const base = await safe(projectRoot, `.gamerhub/snapshots/${revision}`);
  try {
    await lstat(join(base, 'manifest.json'));
    await verifiedSnapshot(projectRoot, revision);
    return revision;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  for (const [name, bytes] of files)
    await writeAtomic(await safe(base, name), bytes);
  await writeAtomic(await safe(base, 'manifest.json'), JSON.stringify(index));
  return revision;
}

export async function restoreSource(
  projectRoot: string,
  revision: string,
): Promise<void> {
  const target = await verifiedSnapshot(projectRoot, revision);
  const current = await collect(projectRoot);
  for (const name of new Set([...target.keys(), ...current.keys()]))
    await safe(projectRoot, name);
  // Preserve the complete current state before removing or replacing a source file.
  await snapshotSource(projectRoot);
  for (const [name, bytes] of target)
    await writeAtomic(await safe(projectRoot, name), bytes);
  for (const name of current.keys())
    if (!target.has(name)) await unlink(await safe(projectRoot, name));
}

export async function recordSourceVersion(
  projectRoot: string,
  versionId: string,
): Promise<string> {
  if (!/^[A-Za-z0-9_-]+$/.test(versionId))
    throw new Error('SOURCE_VERSION_INVALID');
  const revision = await snapshotSource(projectRoot);
  const path = await safe(projectRoot, `.gamerhub/versions/${versionId}.json`);
  await mkdir(dirname(path), { recursive: true });
  const staged = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(staged, JSON.stringify({ revision }), { flag: 'wx' });
    try {
      await link(staged, path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const existing = JSON.parse(await readFile(path, 'utf8'));
      if (existing.revision !== revision)
        throw new Error('SOURCE_VERSION_IMMUTABLE');
    }
  } finally {
    await unlink(staged).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
    });
  }
  return revision;
}

export async function restoreSourceVersion(
  projectRoot: string,
  versionId: string,
): Promise<void> {
  if (!/^[A-Za-z0-9_-]+$/.test(versionId))
    throw new Error('SOURCE_VERSION_INVALID');
  let record: { revision: string };
  try {
    record = JSON.parse(
      await readFile(
        await safe(projectRoot, `.gamerhub/versions/${versionId}.json`),
        'utf8',
      ),
    );
  } catch {
    throw new Error('SOURCE_VERSION_UNAVAILABLE');
  }
  await restoreSource(projectRoot, record.revision);
}
