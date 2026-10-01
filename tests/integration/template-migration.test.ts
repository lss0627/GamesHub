import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { migrateTemplate } from '../../apps/local-dev/src/template-migration';

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'gamerhub-migration-'));
  roots.push(root);
  const template = join(root, 'template');
  const project = join(root, 'project');
  await mkdir(template);
  await mkdir(project);
  const put = async (base: string, name: string, content: string) => {
    const path = join(base, 'Assets/Game/Scripts', name);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content);
  };
  const get = (name: string) =>
    readFile(join(project, 'Assets/Game/Scripts', name), 'utf8');
  return {
    root,
    template,
    project,
    put,
    get,
    migrate: () => migrateTemplate(template, project),
  };
}

it('upgrades unchanged files while retaining authored files across repeated runs and template revisions', async () => {
  const f = await fixture();
  await f.put(f.template, 'Movement.cs', 'base-1');
  await f.put(f.template, 'Combat.cs', 'base-1');
  await f.migrate();
  await f.put(f.project, 'Combat.cs', 'custom-weapon');
  await f.put(f.project, 'NewMechanism.cs', 'authored');
  await f.put(f.template, 'Movement.cs', 'base-2');
  await f.put(f.template, 'Combat.cs', 'base-2');
  const result = await f.migrate();
  expect(result.updated).toContain('Assets/Game/Scripts/Movement.cs');
  expect(result.preserved).toContain('Assets/Game/Scripts/Combat.cs');
  await f.migrate();
  await f.put(f.template, 'Combat.cs', 'base-3');
  await f.migrate();
  expect(await f.get('Movement.cs')).toBe('base-2');
  expect(await f.get('Combat.cs')).toBe('custom-weapon');
  expect(await f.get('NewMechanism.cs')).toBe('authored');
  const manifest = JSON.parse(
    await readFile(
      join(f.project, 'Assets/GamerHub/TemplateManifest.json'),
      'utf8',
    ),
  );
  expect(manifest.schemaVersion).toBe(1);
  expect(manifest.files['Assets/Game/Scripts/Combat.cs'].disposition).toBe(
    'preserved',
  );
});

it('preserves unknown legacy differences and local deletions without resurrecting removed scripts', async () => {
  const f = await fixture();
  await f.put(f.template, 'Legacy.cs', 'new-base');
  await f.put(f.project, 'Legacy.cs', 'unknown-local');
  await f.put(f.template, 'Deleted.cs', 'base');
  await f.migrate();
  await unlink(join(f.project, 'Assets/Game/Scripts/Deleted.cs'));
  await f.put(f.template, 'Deleted.cs', 'base-2');
  await f.migrate();
  await f.migrate();
  expect(await f.get('Legacy.cs')).toBe('unknown-local');
  await expect(f.get('Deleted.cs')).rejects.toMatchObject({ code: 'ENOENT' });
});

it('retires only unchanged removed template files and preserves edited ones', async () => {
  const f = await fixture();
  await f.put(f.template, 'Old.cs', 'base');
  await f.put(f.template, 'Edited.cs', 'base');
  await f.migrate();
  await f.put(f.project, 'Edited.cs', 'custom');
  await unlink(join(f.template, 'Assets/Game/Scripts/Old.cs'));
  await unlink(join(f.template, 'Assets/Game/Scripts/Edited.cs'));
  await f.migrate();
  await expect(f.get('Old.cs')).rejects.toMatchObject({ code: 'ENOENT' });
  expect(await f.get('Edited.cs')).toBe('custom');
});

it('rejects a linked destination before mutating any template files', async () => {
  const f = await fixture();
  const outside = join(f.root, 'outside');
  await mkdir(outside);
  await mkdir(join(f.project, 'Assets/Game'), { recursive: true });
  await symlink(outside, join(f.project, 'Assets/Game/Scripts'), 'junction');
  await f.put(f.template, 'Escape.cs', 'must-not-write');
  await expect(f.migrate()).rejects.toThrow('TEMPLATE_PATH_UNSAFE');
  await expect(readFile(join(outside, 'Escape.cs'))).rejects.toMatchObject({
    code: 'ENOENT',
  });
});

it('fails closed on corrupt baseline instead of treating it as a fresh migration', async () => {
  const f = await fixture();
  await f.put(f.template, 'Main.cs', 'base');
  await f.migrate();
  await writeFile(
    join(f.project, 'Assets/GamerHub/TemplateManifest.json'),
    '{',
  );
  await expect(f.migrate()).rejects.toThrow('TEMPLATE_MANIFEST_INVALID');
});
