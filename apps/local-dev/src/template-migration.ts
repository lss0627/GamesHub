import { createHash, randomUUID } from 'node:crypto';
import type { Dirent } from 'node:fs';
import {
  lstat,
  mkdir,
  readdir,
  readFile,
  rename,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';

const managedRoots = [
  'Assets/Game/Scripts',
  'Assets/Resources/Art',
  'Assets/Editor',
  'Assets/Tests',
  'Assets/Plugins',
];
const manifestPath = 'Assets/GamerHub/TemplateManifest.json';
type Baseline = {
  sourceHash: string;
  disposition: 'managed' | 'preserved' | 'deleted';
};
interface Manifest {
  schemaVersion: 1;
  templateHash: string;
  files: Record<string, Baseline>;
}
const hash = (content: Buffer | string) =>
  createHash('sha256').update(content).digest('hex');
const isManaged = (name: string) =>
  !name.includes('\\') &&
  !name.split('/').some((p) => !p || p === '.' || p === '..') &&
  managedRoots.some((root) => name.startsWith(`${root}/`));

async function optionalRead(path: string): Promise<Buffer | undefined> {
  try {
    return await readFile(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

/** Reject linked path components, including the project root; never follow a junction. */
async function fencedPath(root: string, name: string) {
  const base = resolve(root);
  const target = resolve(base, name);
  if (!target.startsWith(`${base}${sep}`))
    throw new Error('TEMPLATE_PATH_UNSAFE');
  let current = base;
  for (const part of ['', ...relative(base, target).split(sep)]) {
    if (part) current = join(current, part);
    try {
      if ((await lstat(current)).isSymbolicLink())
        throw new Error('TEMPLATE_PATH_UNSAFE');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  return target;
}

async function atomicWrite(path: string, content: Buffer | string) {
  await mkdir(dirname(path), { recursive: true });
  const staging = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(staging, content, { flag: 'wx' });
    await rename(staging, path);
  } finally {
    await unlink(staging).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
    });
  }
}

/** Three-way migration. Unknown legacy differences and intentional deletions stay project-owned. */
export async function migrateTemplate(
  templateRoot: string,
  projectRoot: string,
) {
  const manifestFile = await fencedPath(projectRoot, manifestPath);
  const bytes = await optionalRead(manifestFile);
  let previous: Manifest = { schemaVersion: 1, templateHash: '', files: {} };
  if (bytes) {
    try {
      previous = JSON.parse(bytes.toString('utf8'));
      if (
        previous.schemaVersion !== 1 ||
        !previous.files ||
        Array.isArray(previous.files) ||
        typeof previous.files !== 'object'
      )
        throw new Error();
      for (const [name, item] of Object.entries(previous.files)) {
        if (
          !isManaged(name) ||
          !item ||
          !/^[a-f0-9]{64}$/.test(item.sourceHash) ||
          !['managed', 'preserved', 'deleted'].includes(item.disposition)
        )
          throw new Error();
      }
    } catch {
      throw new Error('TEMPLATE_MANIFEST_INVALID');
    }
  }
  const incoming = new Map<string, Buffer>();
  async function visit(name: string): Promise<void> {
    const path = await fencedPath(templateRoot, name);
    let entries: Dirent[];
    try {
      entries = await readdir(path, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.isSymbolicLink()) throw new Error('TEMPLATE_PATH_UNSAFE');
      const child = `${name}/${entry.name}`;
      if (entry.isDirectory()) await visit(child);
      else if (entry.isFile())
        incoming.set(
          child,
          await readFile(await fencedPath(templateRoot, child)),
        );
    }
  }
  for (const root of managedRoots) await visit(root);
  const templateHash = hash(
    JSON.stringify(
      [...incoming].map(([name, content]) => [name, hash(content)]),
    ),
  );
  const next: Manifest = { schemaVersion: 1, templateHash, files: {} };
  const report = {
    templateHash,
    installed: [] as string[],
    updated: [] as string[],
    preserved: [] as string[],
    deleted: [] as string[],
  };
  const operations: Array<{
    path: string;
    content?: Buffer;
    before?: Buffer | undefined;
  }> = [];
  // Preflight the entire migration before writes so a late unsafe path cannot cause a partial update.
  for (const name of [
    ...new Set([...incoming.keys(), ...Object.keys(previous.files)]),
  ].sort()) {
    const path = await fencedPath(projectRoot, name);
    const current = await optionalRead(path);
    const source = incoming.get(name);
    const old = previous.files[name];
    const currentHash = current === undefined ? undefined : hash(current);
    if (source !== undefined) {
      const sourceHash = hash(source);
      let disposition: Baseline['disposition'] = 'managed';
      if (currentHash === sourceHash) {
        /* Already matches this template; adopt baseline. */
      } else if (current === undefined && old) {
        disposition = 'deleted';
        report.deleted.push(name);
      } else if (
        current === undefined ||
        (old?.disposition === 'managed' && currentHash === old.sourceHash)
      ) {
        operations.push({ path, content: source, before: current });
        (current === undefined ? report.installed : report.updated).push(name);
      } else {
        disposition = 'preserved';
        report.preserved.push(name);
      }
      next.files[name] = { sourceHash, disposition };
    } else if (old) {
      if (currentHash === old.sourceHash && old.disposition === 'managed') {
        operations.push({ path, before: current });
        report.deleted.push(name);
      } else if (current !== undefined) {
        next.files[name] = { ...old, disposition: 'preserved' };
        report.preserved.push(name);
      } else next.files[name] = { ...old, disposition: 'deleted' };
    }
  }
  // Content-addressed backups are regular .bytes assets and participate in source checkpoints.
  for (const operation of operations) {
    if (operation.before !== undefined) {
      const backup = await fencedPath(
        projectRoot,
        `Assets/GamerHub/TemplateBackups/${hash(operation.before)}.bytes`,
      );
      await atomicWrite(backup, operation.before);
    }
  }
  for (const operation of operations) {
    if (operation.content !== undefined)
      await atomicWrite(operation.path, operation.content);
    else await unlink(operation.path);
  }
  await atomicWrite(manifestFile, `${JSON.stringify(next, null, 2)}\n`);
  return report;
}
