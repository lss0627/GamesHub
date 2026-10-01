import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { inspectUnityComponents } from '../../apps/local-dev/src/local-readiness';
import {
  acquireStartupLock,
  classifyService,
  retainedStartupPids,
  trackStartupProcess,
  waitService,
} from '../../scripts/start-gamerhub';

describe('novice startup safety', () => {
  it('reports missing components without disclosing paths or claiming license activation', () => {
    const value = inspectUnityComponents({
      UNITY_EDITOR_PATH: 'C:/private/missing.exe',
    });
    expect(value.ready).toBe(false);
    expect(value.code).toBe('UNITY_EDITOR_NOT_FOUND');
    expect(JSON.stringify(value)).not.toContain('private');
    expect(value.license).toBe('checked-during-build');
  });
  it('requires WebGL and the template even when the editor exists', () => {
    const root = mkdtempSync(join(tmpdir(), 'gamerhub-readiness-'));
    const editor = join(root, 'Editor', 'Unity.exe');
    mkdirSync(join(root, 'Editor'), { recursive: true });
    writeFileSync(editor, 'fixture');
    expect(inspectUnityComponents({ UNITY_EDITOR_PATH: editor }).code).toBe(
      'UNITY_WEB_MODULE_NOT_FOUND',
    );
    mkdirSync(join(root, 'Editor', 'Data', 'PlaybackEngines', 'WebGLSupport'), {
      recursive: true,
    });
    expect(inspectUnityComponents({ UNITY_EDITOR_PATH: editor }).code).toBe(
      'UNITY_TEMPLATE_NOT_FOUND',
    );
    mkdirSync(join(root, 'Template', 'ProjectSettings'), { recursive: true });
    writeFileSync(
      join(root, 'Template', 'ProjectSettings', 'ProjectVersion.txt'),
      'm_EditorVersion: 6000.0.80f1',
    );
    expect(
      inspectUnityComponents({
        UNITY_EDITOR_PATH: editor,
        UNITY_GOLDEN_PROJECT: join(root, 'Template'),
      }),
    ).toMatchObject({ ready: true, license: 'checked-during-build' });
  });
  it('does not reuse unrelated healthy servers or call a blocked backend ready', () => {
    expect(classifyService('api', { status: 'ready' })).toBe('foreign');
    expect(
      classifyService('api', {
        framework: 'fastapi',
        domainTransport: 'stdio',
        service: 'platform-api',
        status: 'blocked',
      }),
    ).toBe('blocked');
    expect(
      classifyService('api', {
        framework: 'fastapi',
        domainTransport: 'stdio',
        service: 'platform-api',
        status: 'ready',
      }),
    ).toBe('ready');
    expect(
      classifyService('studio', {
        service: 'gamerhub-studio',
        status: 'ready',
      }),
    ).toBe('ready');
  });
  it('prevents concurrent initialization and releases only its owned lock', () => {
    const root = mkdtempSync(join(tmpdir(), 'gamerhub-lock-'));
    const release = acquireStartupLock(root);
    expect(release).toBeTypeOf('function');
    expect(acquireStartupLock(root)).toBeUndefined();
    release?.();
    const again = acquireStartupLock(root);
    expect(again).toBeTypeOf('function');
    again?.();
  });
  it('reports owned child exit during a stalled probe without waiting for the timeout', async () => {
    const child = spawn(process.execPath, ['-e', 'process.exit(23)'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    const started = trackStartupProcess(child, 'gamerhub-backend');
    const began = Date.now();
    await expect(
      waitService(3001, 'api', started, {
        probe: () => new Promise(() => {}),
        timeoutMs: 10_000,
      }),
    ).rejects.toThrow('退出码 23');
    expect(Date.now() - began).toBeLessThan(3000);
  });
  it('retains live reused process metadata only for the same configured ports', () => {
    const directory = mkdtempSync(join(tmpdir(), 'gamerhub-pids-'));
    const ports = [3000, 3001, 3010];
    writeFileSync(
      join(directory, 'startup-processes.json'),
      JSON.stringify({
        pids: { backend: process.pid, studio: process.pid },
        ports,
      }),
    );
    expect(
      retainedStartupPids(directory, ports, { backend: true, studio: false }),
    ).toEqual({ backend: process.pid });
    expect(
      retainedStartupPids(directory, [4000, 4001, 4010], {
        backend: true,
        studio: true,
      }),
    ).toEqual({});
    writeFileSync(
      join(directory, 'startup-processes.json'),
      JSON.stringify({
        pids: { backend: -1, studio: 2147483647 },
        ports,
      }),
    );
    expect(
      retainedStartupPids(directory, ports, { backend: true, studio: true }),
    ).toEqual({});
  });
  it('turns spawn errors into fixed log guidance without exposing executable paths', async () => {
    const child = spawn(
      join(tmpdir(), 'private-executable-does-not-exist'),
      [],
      {
        stdio: 'ignore',
        windowsHide: true,
      },
    );
    const started = trackStartupProcess(child, 'gamerhub-studio');
    const error = await started.failure;
    expect(error.message).toContain('artifacts/dev-tools/gamerhub-studio.log');
    expect(error.message).not.toContain('private-executable');
    await expect(
      waitService(3000, 'studio', started, {
        probe: async () => 'ready',
      }),
    ).rejects.toThrow('未能启动');
  });
  it('accepts a healthy owned service without waiting for its eventual exit', async () => {
    const child = spawn(
      process.execPath,
      ['-e', 'setTimeout(() => {}, 10000)'],
      {
        stdio: 'ignore',
        windowsHide: true,
      },
    );
    const started = trackStartupProcess(child, 'gamerhub-backend');
    try {
      await expect(
        waitService(3001, 'api', started, {
          probe: async () => 'ready',
        }),
      ).resolves.toBe('ready');
    } finally {
      child.kill();
      await started.failure;
    }
  });
});
