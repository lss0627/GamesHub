import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InMemoryEngineAdapter } from '@gamerhub/engine-adapter';
import { runnerGameSpec } from '@gamerhub/game-spec';
import { afterEach, expect, it } from 'vitest';
import { RealUnityLocalManager } from '../../apps/local-dev/src/real-unity';
import { SourceAttemptStore } from '../../apps/local-dev/src/source-attempt';
import {
  restoreSource,
  snapshotSource,
} from '../../apps/local-dev/src/source-snapshot';

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'gamerhub-attempt-'));
  roots.push(root);
  await mkdir(join(root, 'Assets/Game'), { recursive: true });
  await mkdir(join(root, 'Builds/Web/published'), { recursive: true });
  await writeFile(join(root, 'Assets/Game/Main.cs'), 'working code');
  await writeFile(join(root, 'Assets/Game/Scene.unity'), 'custom scene object');
  await writeFile(
    join(root, 'Builds/Web/published/index.html'),
    'old playable game',
  );
  return { root, attempts: new SourceAttemptStore(root, 'project') };
}
it('takes the attempt baseline before template migration writes source', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'source-template-attempt-'));
  roots.push(folder);
  const templatePath = join(folder, 'template');
  await mkdir(join(templatePath, 'ProjectSettings'), { recursive: true });
  await mkdir(join(templatePath, 'Assets/Game/Scripts'), { recursive: true });
  await writeFile(
    join(templatePath, 'ProjectSettings/ProjectVersion.txt'),
    'm_EditorVersion: 6000.0.80f1',
  );
  await writeFile(
    join(templatePath, 'Assets/Game/Scripts/NewTemplate.cs'),
    'template source',
  );
  const editorPath = join(folder, 'Unity.exe');
  await writeFile(editorPath, 'fixture');
  const projectRoot = join(folder, 'projects/project');
  await mkdir(join(projectRoot, 'Assets/Game/Scripts'), { recursive: true });
  await mkdir(join(projectRoot, 'ProjectSettings'), { recursive: true });
  await mkdir(join(projectRoot, 'Packages'), { recursive: true });
  await writeFile(join(projectRoot, 'Packages/packages-lock.json'), '{}');
  await writeFile(
    join(projectRoot, 'ProjectSettings/ProjectVersion.txt'),
    'm_EditorVersion: 6000.0.80f1',
  );
  await writeFile(
    join(projectRoot, 'Assets/Game/Scripts/Custom.cs'),
    'custom source',
  );
  const before = await snapshotSource(projectRoot);
  const manager = new RealUnityLocalManager({
    editorPath,
    templatePath,
    workspaceRoot: join(folder, 'projects'),
    publicOrigin: 'http://localhost',
    adapterFactory: () => new InMemoryEngineAdapter(),
  });
  const run = { id: 'run', projectId: 'project' } as Parameters<
    typeof manager.prepareSource
  >[0];
  await manager.prepareSource(run, async () => {
    throw new Error('NO_PREVIOUS_RUN');
  });
  expect(await snapshotSource(projectRoot)).toBe(before);
  await manager.executorFor({
    run,
    context: { gameSpec: runnerGameSpec, specVersionId: 'spec' },
  });
  expect(
    await readFile(
      join(projectRoot, 'Assets/Game/Scripts/NewTemplate.cs'),
      'utf8',
    ),
  ).toBe('template source');
  await manager.settleSource(run, 'failed');
  expect(await snapshotSource(projectRoot)).toBe(before);
});
it('archives failed source and restores all source before another attempt', async () => {
  const { root, attempts } = await fixture();
  const baseline = await snapshotSource(root);
  await attempts.begin('failed-run');
  await writeFile(join(root, 'Assets/Game/Main.cs'), 'broken code');
  await writeFile(join(root, 'Assets/Game/Added.cs'), 'unfinished mechanism');
  const failed = await snapshotSource(root);
  const result = await attempts.settle('failed-run', 'failed');
  expect(result).toMatchObject({
    status: 'recovered',
    baselineRevision: baseline,
    archivedRevision: failed,
  });
  expect(await snapshotSource(root)).toBe(baseline);
  expect(
    await readFile(join(root, 'Builds/Web/published/index.html'), 'utf8'),
  ).toBe('old playable game');
  await restoreSource(root, failed);
  expect(await readFile(join(root, 'Assets/Game/Added.cs'), 'utf8')).toBe(
    'unfinished mechanism',
  );
  // Repeating settlement must not overwrite subsequent user work.
  await attempts.settle('failed-run', 'failed');
  expect(await snapshotSource(root)).toBe(failed);
});
it('resumes one active attempt without replacing its baseline and rejects a competing attempt', async () => {
  const { root, attempts } = await fixture();
  const first = await attempts.begin('paused-run');
  await writeFile(join(root, 'Assets/Game/Main.cs'), 'in progress');
  const resumed = await new SourceAttemptStore(root, 'project').begin(
    'paused-run',
  );
  expect(resumed.baselineRevision).toBe(first.baselineRevision);
  expect(await readFile(join(root, 'Assets/Game/Main.cs'), 'utf8')).toBe(
    'in progress',
  );
  await expect(
    attempts.begin('other-run', async () => 'paused'),
  ).rejects.toThrow('SOURCE_ATTEMPT_ACTIVE');
});
it('reconciles an interrupted cancelled attempt before taking the next baseline', async () => {
  const { root, attempts } = await fixture();
  const first = await attempts.begin('cancelled-run');
  await writeFile(join(root, 'Assets/Game/Main.cs'), 'abandoned');
  const next = await new SourceAttemptStore(root, 'project').begin(
    'next-run',
    async (id) => {
      expect(id).toBe('cancelled-run');
      return 'cancelled';
    },
  );
  expect(next.baselineRevision).toBe(first.baselineRevision);
  expect(await readFile(join(root, 'Assets/Game/Main.cs'), 'utf8')).toBe(
    'working code',
  );
});
it('never rolls back a committed publication even if late diagnostics fail', async () => {
  const { root, attempts } = await fixture();
  await attempts.begin('published-run');
  await writeFile(join(root, 'Assets/Game/Main.cs'), 'published code');
  await attempts.settle('published-run', 'succeeded');
  await attempts.settle('published-run', 'failed');
  expect(await readFile(join(root, 'Assets/Game/Main.cs'), 'utf8')).toBe(
    'published code',
  );
});
it('fails recovery on corrupt source and fences journal identity before mutation', async () => {
  const { root, attempts } = await fixture();
  const first = await attempts.begin('broken-backup');
  await writeFile(
    join(
      root,
      '.gamerhub/snapshots',
      first.baselineRevision,
      'Assets/Game/Main.cs',
    ),
    'tampered',
  );
  await writeFile(join(root, 'Assets/Game/Main.cs'), 'current');
  await expect(attempts.settle('broken-backup', 'failed')).rejects.toThrow(
    'SOURCE_SNAPSHOT_CORRUPT',
  );
  expect(await readFile(join(root, 'Assets/Game/Main.cs'), 'utf8')).toBe(
    'current',
  );
  await expect(attempts.begin('../escape')).rejects.toThrow(
    'SOURCE_ATTEMPT_ID_INVALID',
  );
  await expect(
    new SourceAttemptStore(root, 'another-project').begin('new'),
  ).rejects.toThrow('SOURCE_ATTEMPT_PROJECT_MISMATCH');
});
