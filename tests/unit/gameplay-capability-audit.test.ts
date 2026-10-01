import { expect, it } from 'vitest';
import { gameConfigFromSpec } from '../../apps/local-dev/src/real-unity';
import {
  buildDesignSpec,
  initialBrief,
  validateBrief,
} from '../../packages/game-spec/src/design-document';
import { assessGameCapabilities } from '../../packages/game-spec/src/game-capabilities';

it('preserves approved gameplay parameters when system identities are renamed', () => {
  const spec = buildDesignSpec({
    ...initialBrief,
    genre: 'survivor',
    interval: 3,
    mechanics: { damage: 7, enemyHp: 9, xpPerLevel: 5 },
  });
  for (const system of spec.systems) system.system_id = `custom_${system.type}`;
  expect(assessGameCapabilities(spec).executable).toBe(true);
  expect(gameConfigFromSpec(spec, 'verified')).toMatchObject({
    damage: 7,
    enemyHp: 9,
    xpPerLevel: 5,
    spawnIntervalSeconds: 3,
  });
});

it('rejects unimplemented economy parameters and contradictory goals', () => {
  const spec = buildDesignSpec({ ...initialBrief, genre: 'clicker' });
  const score = spec.systems.find((s) => s.type === 'score');
  if (!score) throw new Error('score required');
  score.config.offline_multiplier = 5;
  expect(assessGameCapabilities(spec).executable).toBe(false);
  delete score.config.offline_multiplier;
  const win = spec.rules.win_conditions[0];
  if (!win) throw new Error('win required');
  win.parameters.score = 999;
  expect(assessGameCapabilities(spec).executable).toBe(false);
});

it('does not let disabled system config shadow its enabled replacement', () => {
  const spec = buildDesignSpec({ ...initialBrief, genre: 'survivor' });
  const combat = spec.systems.find((s) => s.type === 'combat');
  if (!combat) throw new Error('combat required');
  spec.systems.unshift({
    ...combat,
    system_id: 'disabled_combat',
    enabled: false,
    config: { damage: -1 },
  });
  expect(assessGameCapabilities(spec).executable).toBe(true);
});

it('rejects gameplay controls that the selected genre cannot apply', () => {
  expect(() =>
    validateBrief({
      ...initialBrief,
      genre: 'clicker',
      mechanics: { damage: 5 },
    }),
  ).toThrow('DESIGN_MECHANIC_UNSUPPORTED');
});

it('rejects ambiguous duplicate systems instead of arbitrarily picking gameplay values', () => {
  const spec = buildDesignSpec({ ...initialBrief, genre: 'clicker' });
  const score = spec.systems.find((system) => system.type === 'score');
  if (!score) throw new Error('score required');
  spec.systems.push({
    ...structuredClone(score),
    system_id: 'second_economy',
    config: { per_click: 99, goal: 5000 },
  });
  expect(assessGameCapabilities(spec).executable).toBe(false);
});
