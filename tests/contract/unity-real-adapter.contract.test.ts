import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  UnityBatchmodeRunner,
  type UnityProcessResult,
} from '@gamerhub/unity-adapter';
import { describe, expect, it } from 'vitest';

describe('real Unity process adapter contract', () => {
  it.each([
    'RunTests',
    'StartPlayMode',
    'StopPlayMode',
    'InspectProject',
    'EditScene',
    'ReadState',
    'CreateGameObject',
    'CreatePrefab',
    'CreateScript',
    'CreateUi',
  ])(
    'rejects the unsupported %s entry before launching Unity',
    async (method) => {
      let spawned = false;
      const runner = new UnityBatchmodeRunner({
        editorPath: 'Unity.exe',
        projectPath: 'D:/golden/Runner',
        processRunner: async () => {
          spawned = true;
          return { exitCode: 0, stdout: '', stderr: '' };
        },
      });
      await expect(
        runner.run(
          `GamerHub.AgentBridge.Editor.BatchmodeMethods.${method}`,
          {},
        ),
      ).rejects.toMatchObject({ code: 'COMMAND_NOT_ALLOWED' });
      expect(spawned).toBe(false);
    },
  );
  it('uses authoritative XML and retains the hashed report after the process exits', async () => {
    const root = mkdtempSync(join(tmpdir(), 'gamerhub-nunit-'));
    try {
      let reportPath = '';
      const xml =
        '<test-run result="Failed" passed="1" failed="1"><test-case fullname="Tests.Acceptance_01" name="Acceptance_01" result="Passed"/><test-case fullname="Tests.Acceptance_02" name="Acceptance_02" result="Failed"/></test-run>';
      const runner = new UnityBatchmodeRunner({
        editorPath: 'Unity.exe',
        projectPath: root,
        processRunner: async (request) => {
          reportPath =
            request.args[request.args.indexOf('-testResults') + 1] ?? '';
          writeFileSync(reportPath, xml);
          return {
            exitCode: 0,
            stdout: JSON.stringify({ passed: 999, failed: 0 }),
            stderr: '',
          };
        },
      });
      const result = await runner.runTests('playmode');
      expect(result.status).toBe('failed');
      expect(result.output).toMatchObject({
        passed: 1,
        failed: 1,
        testReport: {
          contentHash: `sha256-${createHash('sha256').update(xml).digest('hex')}`,
        },
      });
      expect(existsSync(reportPath)).toBe(true);
      expect(readFileSync(reportPath, 'utf8')).toBe(xml);
      await runner.cleanup();
      expect(existsSync(reportPath)).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  it('uses a pinned project, allowlisted method and no shell interpolation', async () => {
    const calls: string[][] = [];
    const runner = new UnityBatchmodeRunner({
      editorPath: 'D:/Unity/Editor/Unity.exe',
      projectPath: 'D:/golden/Runner',
      processRunner: async (request): Promise<UnityProcessResult> => {
        calls.push([...request.args]);
        return {
          exitCode: 0,
          stdout: JSON.stringify({ status: 'succeeded' }),
          stderr: '',
        };
      },
    });

    const result = await runner.run(
      'GamerHub.AgentBridge.Editor.BatchmodeMethods.Compile',
      { mode: 'playmode', filter: 'RunnerPlayModeTests' },
      {
        traceContext: {
          traceId: '1234567890abcdef1234567890abcdef',
          spanId: '1234567890abcdef',
        },
      },
    );

    expect(result.status).toBe('succeeded');
    expect(result.output).toMatchObject({ status: 'succeeded' });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual(
      expect.arrayContaining([
        '-batchmode',
        '-quit',
        '-projectPath',
        'D:/golden/Runner',
        '-executeMethod',
        'GamerHub.AgentBridge.Editor.BatchmodeMethods.Compile',
        '-gamerhub-traceId',
        '1234567890abcdef1234567890abcdef',
        '-gamerhub-spanId',
        '1234567890abcdef',
      ]),
    );
  });

  it('rejects arbitrary Editor methods before spawning a process', async () => {
    let spawned = false;
    const runner = new UnityBatchmodeRunner({
      editorPath: 'D:/Unity/Editor/Unity.exe',
      projectPath: 'D:/golden/Runner',
      processRunner: async () => {
        spawned = true;
        return { exitCode: 0, stdout: '', stderr: '' };
      },
    });

    await expect(runner.run('System.IO.File.Delete', {})).rejects.toMatchObject(
      {
        code: 'COMMAND_NOT_ALLOWED',
      },
    );
    expect(spawned).toBe(false);
  });

  it('runs the Unity Test Framework with canonical platform names and XML evidence', async () => {
    let args: string[] = [];
    const runner = new UnityBatchmodeRunner({
      editorPath: 'D:/Unity/Editor/Unity.exe',
      projectPath: 'D:/golden/Runner',
      processRunner: async (request) => {
        args = [...request.args];
        const resultsIndex = args.indexOf('-testResults');
        const resultsPath = args[resultsIndex + 1];
        if (!resultsPath) throw new Error('TEST_RESULTS_PATH_REQUIRED');
        writeFileSync(
          resultsPath,
          '<test-run result="Passed" passed="2" failed="0"><test-case fullname="Tests.One" name="One" result="Passed"/><test-case fullname="Tests.Two" name="Two" result="Passed"/></test-run>',
        );
        return { exitCode: 0, stdout: '', stderr: '' };
      },
    });

    const result = await runner.runTests('playmode', 'RunnerPlayModeTests', {
      traceContext: {
        traceId: 'abcdef1234567890abcdef1234567890',
        spanId: 'abcdef1234567890',
      },
    });

    expect(result.status).toBe('succeeded');
    expect(result.output).toMatchObject({ passed: 2, failed: 0 });
    expect(args).toEqual(
      expect.arrayContaining([
        '-runTests',
        '-testPlatform',
        'PlayMode',
        '-testFilter',
        'RunnerPlayModeTests',
        '-gamerhub-traceId',
        'abcdef1234567890abcdef1234567890',
      ]),
    );
    expect(args).not.toContain('-quit');
  });

  it('fails closed when Unity exits without a test results file', async () => {
    const runner = new UnityBatchmodeRunner({
      editorPath: 'D:/Unity/Editor/Unity.exe',
      projectPath: 'D:/golden/Runner',
      processRunner: async () => ({ exitCode: 0, stdout: '', stderr: '' }),
    });

    const result = await runner.runTests('editmode');

    expect(result.status).toBe('failed');
    expect(result.output).toMatchObject({ passed: 0, failed: 1 });
    expect(result.errors[0]?.code).toBe('UNITY_TEST_RESULTS_MISSING');
  });
});
