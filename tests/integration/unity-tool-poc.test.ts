import { runUnityGoldenCycle } from '@gamerhub/unity-adapter';
import { describe, expect, it } from 'vitest';

const goldenProject = process.env.UNITY_GOLDEN_PROJECT;
const hasLicensedUnity = Boolean(
  goldenProject &&
    process.env.UNITY_EDITOR_PATH &&
    !goldenProject.startsWith('fixture://'),
);
const projectPath = goldenProject;

describe('Unity golden structured tool PoC', () => {
  it.skipIf(!hasLicensedUnity)(
    'completes at least 95 isolated cycles out of 100 and exercises CLI fallback in real Unity',
    async () => {
      if (!projectPath) throw new Error('UNITY_GOLDEN_PROJECT_REQUIRED');
      const result = await runUnityGoldenCycle({
        projectPath,
        cycles: 100,
        requireFallback: true,
        allowFixture: false,
      });
      expect(result.successfulCycles).toBeGreaterThanOrEqual(95);
      expect(result.operations).toEqual(
        expect.arrayContaining([
          'scene.edit',
          'compile',
          'play',
          'state.read',
          'test',
          'web.build',
        ]),
      );
      expect(result.fallbackVerified).toBe(true);
      expect(result.executionMode).toBe('unity');
    },
  );

  it('rejects fixture projects when the real PoC is requested', async () => {
    await expect(
      runUnityGoldenCycle({
        projectPath: 'fixture://runner-golden',
        cycles: 1,
        requireFallback: true,
        allowFixture: false,
      }),
    ).rejects.toMatchObject({ code: 'UNITY_REAL_EXECUTION_REQUIRED' });
  });
});
