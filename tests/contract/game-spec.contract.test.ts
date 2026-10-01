import {
  canonicalizeGameSpec,
  hashGameSpec,
  interpretRunnerPrompt,
  runnerGameSpec,
  validateGameSpec,
} from '@gamerhub/game-spec';
import { describe, expect, it } from 'vitest';

describe('Game Spec contract', () => {
  it('provides a canonical runner fixture accepted by the schema', () => {
    expect(validateGameSpec(runnerGameSpec).game.genre).toBe('runner');
    expect(runnerGameSpec.verification.length).toBeGreaterThanOrEqual(7);
    expect(hashGameSpec(runnerGameSpec)).toMatch(/^sha256-[a-f0-9]{64}$/);
  });

  it('canonicalization is stable regardless of object key order', () => {
    const canonical = canonicalizeGameSpec(runnerGameSpec);
    const reorder = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(reorder);
      if (value && typeof value === 'object')
        return Object.fromEntries(
          Object.entries(value as Record<string, unknown>)
            .reverse()
            .map(([key, item]) => [key, reorder(item)]),
        );
      return value;
    };
    const reordered = reorder(runnerGameSpec);
    expect(canonicalizeGameSpec(reordered)).toBe(canonical);
  });

  it('rejects unsupported platform and incomplete verification', () => {
    expect(() =>
      validateGameSpec({
        ...runnerGameSpec,
        game: { ...runnerGameSpec.game, target_platform: 'mobile' },
      }),
    ).toThrow();
    expect(() =>
      validateGameSpec({ ...runnerGameSpec, verification: [] }),
    ).toThrow();
  });

  it('interprets supported local jump and score changes', () => {
    const jump = interpretRunnerPrompt('猫跳得太高了', runnerGameSpec);
    expect(jump.intent).toBe('modify');
    expect(jump.spec.player.movement.jump_height).toBe(2.625);
    const score = interpretRunnerPrompt('把金币分数改为 20', runnerGameSpec);
    expect(
      score.spec.systems.find(
        (system) => system.system_id === 'coin_collection',
      )?.config.score_per_coin,
    ).toBe(20);
  });

  it('binds an uploaded character asset to the player appearance', () => {
    const replacement = interpretRunnerPrompt(
      '把角色替换为素材 asset-123',
      runnerGameSpec,
    );
    expect(replacement.intent).toBe('modify');
    expect(replacement.spec.player.appearance.logical_asset_id).toBe(
      'asset-123',
    );
    expect(
      replacement.spec.assets.some((asset) => asset.logical_id === 'asset-123'),
    ).toBe(true);
  });
});
