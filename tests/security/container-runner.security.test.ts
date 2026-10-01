import { resolve } from 'node:path';
import { ContainerRunner } from '@gamerhub/sandbox';
import { describe, expect, it } from 'vitest';

const mountPaths = {
  projectPath: resolve('workers/project-1'),
  assetsPath: resolve('workers/assets-1'),
  buildPath: resolve('workers/build-1'),
};

describe('licensed Unity container runner', () => {
  it('starts with deny-by-default, read-only and bounded resource flags', async () => {
    const calls: string[][] = [];
    const runner = new ContainerRunner({
      dockerPath: 'docker',
      commandRunner: async (args) => {
        calls.push([...args]);
        return { exitCode: 0, stdout: 'container-123\n', stderr: '' };
      },
    });

    const handle = await runner.start({
      runId: 'run-1',
      image: 'gamerhub/unity-worker:6000.0.80f1',
      ...mountPaths,
    });

    expect(handle.containerId).toBe('container-123');
    expect(calls[0]).toEqual(
      expect.arrayContaining([
        'run',
        '--rm',
        '--network',
        'none',
        '--read-only',
        '--cap-drop',
        'ALL',
        '--security-opt',
        'no-new-privileges:true',
        '--cpus',
        '4',
        '--memory',
        '8g',
        '--pids-limit',
        '128',
      ]),
    );
  });

  it('cancels the container through the Docker API without shell commands', async () => {
    const calls: string[][] = [];
    const runner = new ContainerRunner({
      commandRunner: async (args) => {
        calls.push([...args]);
        return { exitCode: 0, stdout: 'container-123\n', stderr: '' };
      },
    });
    await runner.start({
      runId: 'run-1',
      image: 'gamerhub/unity-worker:6000.0.80f1',
      ...mountPaths,
    });
    await runner.cancel('run-1', 'creator_requested');
    expect(calls.at(-1)).toEqual(['rm', '--force', 'container-123']);
  });
});
