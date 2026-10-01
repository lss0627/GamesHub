import { SandboxPolicy, WorkspaceProvider } from '@gamerhub/sandbox';
import { describe, expect, it } from 'vitest';

describe('Unity sandbox policy', () => {
  it('fences paths and defaults egress to deny', () => {
    const workspace = new WorkspaceProvider('D:/worker/projects/project-1');
    expect(workspace.resolve('Assets/Game/Runner.unity')).toContain(
      'project-1',
    );
    expect(() => workspace.resolve('../secrets.txt')).toThrow(
      /WORKSPACE_ESCAPE/,
    );
    expect(new SandboxPolicy().network).toBe('deny');
    expect(
      new SandboxPolicy().allowsEgress('package-cache.internal', 443),
    ).toBe(false);
    expect(
      new SandboxPolicy('D:/worker/projects/project-1', {
        network: 'proxy',
      }).allowsEgress('package-cache.internal', 443),
    ).toBe(true);
    expect(
      new SandboxPolicy().withinLimits({
        cpu: 4,
        memoryMb: 8192,
        diskGb: 20,
        pids: 128,
        wallClockSeconds: 1200,
      }),
    ).toBe(true);
    expect(() =>
      new SandboxPolicy().assertWithinLimits({
        cpu: 5,
        memoryMb: 0,
        diskGb: 0,
        pids: 0,
        wallClockSeconds: 0,
      }),
    ).toThrow(/SANDBOX_RESOURCE_LIMIT/);
    expect(
      new SandboxPolicy().allowsPath(
        'D:/worker/projects/project-1/Assets/a.cs',
      ),
    ).toBe(true);
    expect(
      new SandboxPolicy().allowsPath(
        'D:/worker/projects/project-2/Assets/a.cs',
      ),
    ).toBe(false);
  });
});
