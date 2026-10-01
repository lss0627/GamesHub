import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { inspectBrowserBuild } from '../../apps/local-dev/src/browser-playtest';
import { RealUnityLocalManager } from '../../apps/local-dev/src/real-unity';

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
it.each([
  'missing',
  'wrong',
  'stuck',
  'frozen',
  'websocket',
  'creative-missing',
])(
  'blocks %s telemetry and retains diagnostic evidence',
  async (mode) => {
    const root = await mkdtemp(join(tmpdir(), 'browser-gate-'));
    roots.push(root);
    const value = {
      runtime: mode === 'wrong' ? 'other' : 'clicker-v1',
      genre: 'clicker',
      specVersionId: 'spec-1',
      phase: 'ready',
      elapsed: 0,
    };
    await writeFile(
      join(root, 'index.html'),
      `<canvas width="960" height="600"></canvas><script>
    const canvas=document.querySelector('canvas');const ctx=canvas.getContext('2d');ctx.fillStyle='green';ctx.fillRect(0,0,480,600);
    ${
      mode === 'missing'
        ? ''
        : mode === 'frozen'
          ? `window.__gamerhubGameState=Object.freeze(${JSON.stringify(value)});
    canvas.onclick=()=>{const state=window.__gamerhubGameState;window.__gamerhubGameState=Object.freeze({...state,phase:state.phase==='ready'?'playing':'paused'});};`
          : `setInterval(()=>window.__gamerhubGameState=Object.freeze(${JSON.stringify(value)}),100);`
    }
    ${mode === 'websocket' ? "new WebSocket('ws://127.0.0.1:9/blocked');" : ''}</script>`,
    );
    const result = await inspectBrowserBuild({
      root,
      evidenceDirectory: join(root, 'evidence'),
      buildHash: 'sha256-build',
      runId: 'run-1',
      specVersionId: 'spec-1',
      runtime: 'clicker-v1',
      genre: 'clicker',
      loadTimeoutMs: 1200,
      actionTimeoutMs: 600,
      ...(mode === 'creative-missing'
        ? {
            creative: {
              contentHash: 'sha256-expected',
              nodes: 1,
              clips: 1,
              sounds: 1,
            },
          }
        : {}),
    });
    expect(result.passed).toBe(false);
    expect(result.code).toMatch(/^BROWSER_/);
    if (mode === 'frozen') expect(result.code).toBe('BROWSER_PAUSE_FAILED');
    if (mode === 'creative-missing')
      expect(result.code).toBe('BROWSER_CREATIVE_MISSING');
    if (mode === 'stuck')
      expect(result.code).toBe('BROWSER_INTERACTION_FAILED');
    const report = JSON.parse(
      await readFile(join(root, 'evidence', 'browser.json'), 'utf8'),
    );
    expect(report.buildHash).toBe('sha256-build');
    expect(report.passed).toBe(false);
    if (mode === 'websocket')
      expect(report.diagnostics).toContain('WebSocket request blocked');
    expect(result.reportHash).toMatch(/^sha256-[a-f0-9]{64}$/);
  },
  20000,
);

it('blocks failed inspection before source-version and preview preparation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'publish-gate-'));
  roots.push(root);
  const editorPath = join(root, 'Unity.exe');
  await writeFile(editorPath, 'fixture');
  const templatePath = join(root, 'template');
  await mkdir(join(templatePath, 'ProjectSettings'), { recursive: true });
  await writeFile(
    join(templatePath, 'ProjectSettings/ProjectVersion.txt'),
    'm_EditorVersion: 6000.0.80f1',
  );
  const project = join(root, 'workspaces/project');
  await mkdir(join(project, 'Builds/Web/run'), { recursive: true });
  await writeFile(
    join(project, 'Builds/Web/run/index.html'),
    '<canvas></canvas>',
  );
  await mkdir(join(project, 'Assets/Resources'), { recursive: true });
  await writeFile(
    join(project, 'Assets/Resources/GamerHubGameConfig.json'),
    JSON.stringify({
      specVersionId: 'spec',
      runtime: 'clicker-v1',
      genre: 'clicker',
    }),
  );
  const inspector = vi.fn(async (input) => ({
    passed: false,
    code: 'BROWSER_INTERACTION_FAILED',
    ...input,
    checks: [],
    reportHash: `sha256-${'a'.repeat(64)}`,
  }));
  const manager = new RealUnityLocalManager({
    editorPath,
    templatePath,
    workspaceRoot: join(root, 'workspaces'),
    publicOrigin: 'http://localhost',
    browserInspector: inspector,
  });
  await expect(
    manager.publish({
      projectId: 'project',
      runId: 'run',
      traceId: 'trace',
      buildHash: 'aggregate',
      specVersionId: 'spec',
    }),
  ).rejects.toMatchObject({ code: 'BROWSER_INTERACTION_FAILED' });
  expect(inspector).toHaveBeenCalledOnce();
  await expect(
    readFile(join(project, '.gamerhub/versions/spec.json')),
  ).rejects.toMatchObject({ code: 'ENOENT' });
  await expect(
    manager.publish({
      projectId: 'project',
      runId: 'run',
      traceId: 'trace',
      buildHash: 'aggregate',
      specVersionId: 'wrong-spec',
    }),
  ).rejects.toMatchObject({ code: 'BROWSER_IDENTITY_MISMATCH' });
  expect(inspector).toHaveBeenCalledOnce();
});
