import {
  createRunnerProjectSkill,
  createRunnerSkillRegistry,
} from '@gamerhub/game-skills';
import { describe, expect, it } from 'vitest';

describe('Runner Game Skill contract', () => {
  it('pins versions, declares capabilities and returns changed artifacts', async () => {
    const registry = createRunnerSkillRegistry();
    const skill = registry.get('create_runner_project');
    const plan = await skill.plan(
      { template: 'runner-v1', seed: 42 },
      { engineType: 'unity', currentRevision: 'rev-0' },
    );
    expect(plan.requiredEngineCapabilities).toContain('scene.create');
    const result = await skill.execute(plan, { expectedRevision: 'rev-0' });
    expect(result.status).toBe('succeeded');
    expect(result.changedArtifacts.length).toBeGreaterThan(0);
    expect((await skill.validate(result, {})).status).toBe('passed');
  });

  it('rejects a missing binding before a write', async () => {
    const skill = createRunnerProjectSkill();
    await expect(
      skill.plan(
        { template: 'runner-v1', seed: 1 },
        { engineType: 'godot', currentRevision: 'rev-0' },
      ),
    ).rejects.toMatchObject({ code: 'CAPABILITY_UNSUPPORTED' });
  });

  it('rolls back an asset replacement when compile validation fails', async () => {
    const skill = createRunnerSkillRegistry().get('replace_character_asset');
    const plan = await skill.plan(
      { assetId: 'asset-1' },
      {
        engineType: 'unity',
        currentRevision: 'rev-1',
        capabilities: ['asset.import', 'component.set_property'],
      },
    );
    let rolledBack = false;
    const result = await skill.execute(plan, {
      expectedRevision: 'rev-1',
      compile: async () => false,
      rollback: async () => {
        rolledBack = true;
      },
    });
    expect(result.status).toBe('failed');
    expect(result.error?.code).toBe('COMPILE_FAILED');
    expect(rolledBack).toBe(true);
  });
});
