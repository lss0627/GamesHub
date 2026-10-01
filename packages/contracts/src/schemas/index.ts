import { z } from 'zod';
import { creativeSchema } from '../creative';

const id = z.string().min(2);
const condition = z.object({
  condition_id: z.string().regex(/^[a-z][a-z0-9_]{1,63}$/),
  type: z.enum([
    'survive_seconds',
    'score_at_least',
    'collect_count',
    'reach_goal',
    'player_hp_zero',
    'fall_out',
    'collision',
    'time_expired',
  ]),
  parameters: z.record(z.string(), z.unknown()),
});
const assertion = z.object({
  assertion_id: z.string().regex(/^[a-z][a-z0-9_]{1,63}$/),
  capability: z.string().min(1),
  severity: z.enum(['critical', 'high', 'medium', 'low']),
  preconditions: z.array(z.record(z.string(), z.unknown())),
  actions: z.array(z.record(z.string(), z.unknown())).min(1),
  expected: z.array(z.record(z.string(), z.unknown())).min(1),
  timeout_ms: z.number().int().min(100).max(120000).optional(),
});

export const gameSpecSchema = z
  .object({
    schema_version: z.literal('1.0.0'),
    game: z.object({
      name: z.string().min(1).max(120),
      genre: z.enum([
        'runner',
        'platformer',
        'top_down_shooter',
        'survivor',
        'tower_defense',
        'flappy',
        'breakout',
        'clicker',
        'puzzle',
        'rpg_dialogue',
        'custom',
      ]),
      target_platform: z.literal('web'),
      template: z.string().min(1),
      description: z.string().max(2000).optional(),
    }),
    player: z.object({
      entity_id: z.string().regex(/^[a-z][a-z0-9_]{1,63}$/),
      appearance: z.object({
        logical_asset_id: z.string().regex(/^[a-z][a-z0-9_]{1,63}$/),
      }),
      movement: z.object({
        type: z.enum(['side_scroll', 'top_down', 'fixed']),
        speed: z.number().positive().max(1000),
        jump_height: z.number().min(0).max(100),
        air_control: z.number().min(0).max(1).optional(),
      }),
      health: z.object({ max_hp: z.number().int().min(1).max(100000) }),
    }),
    systems: z
      .array(
        z.object({
          system_id: z.string().regex(/^[a-z][a-z0-9_]{1,63}$/),
          type: z.enum([
            'coin_collection',
            'obstacle',
            'score',
            'spawn',
            'combat',
            'xp',
            'level_up',
            'dialogue',
            'wave',
            'checkpoint',
            'game_over',
          ]),
          enabled: z.boolean(),
          config: z.record(z.string(), z.unknown()),
        }),
      )
      .min(1),
    level: z.object({
      scene_id: z.string().regex(/^[a-z][a-z0-9_]{1,63}$/),
      duration_seconds: z.number().int().min(10).max(3600),
      entities: z.array(
        z.object({
          entity_id: z.string().regex(/^[a-z][a-z0-9_]{1,63}$/),
          type: z.string(),
          count: z.number().int().min(1).max(10000).optional(),
          properties: z.record(z.string(), z.unknown()).optional(),
        }),
      ),
    }),
    rules: z.object({
      win_conditions: z.array(condition),
      lose_conditions: z.array(condition).min(1),
    }),
    ui: z.object({
      hud: z.array(z.enum(['score', 'health', 'coins', 'timer', 'level'])),
      game_over: z.boolean(),
      restart: z.boolean(),
    }),
    assets: z.array(
      z.object({
        logical_id: z.string().regex(/^[a-z][a-z0-9_]{1,63}$/),
        type: z.enum([
          'sprite',
          'audio',
          'font',
          'animation',
          'material',
          'other',
        ]),
        source: z.enum(['builtin', 'placeholder', 'upload']),
        asset_id: z.string().uuid().optional(),
      }),
    ),
    verification: z.array(assertion).min(1),
    extensions: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export const taskGraphSchema = z
  .object({
    schema_version: z.literal('1.0.0'),
    graph_id: id,
    project_id: id,
    game_spec_version_id: id,
    kind: z.enum([
      'create',
      'modify',
      'fix',
      'rollback',
      'validate',
      'publish',
    ]),
    tasks: z
      .array(
        z.object({
          id,
          type: z.enum([
            'spec',
            'scene',
            'component',
            'script',
            'asset',
            'test',
            'playtest',
            'evaluate',
            'fix',
            'build',
            'publish',
            'rollback',
          ]),
          description: z.string().min(1).max(6000),
          dependencies: z
            .array(z.string())
            .refine((items) => new Set(items).size === items.length),
          status: z.enum([
            'pending',
            'running',
            'blocked',
            'failed',
            'completed',
            'cancelled',
          ]),
          retry_count: z.number().int().min(0),
          max_retries: z.number().int().min(0).max(10),
          validation_method: z.object({
            type: z.enum([
              'schema',
              'compile',
              'editmode_test',
              'playmode_test',
              'playtest_assertion',
              'web_smoke',
              'manual_gate',
            ]),
            reference: z.string().min(1),
            criteria: z
              .array(
                z
                  .object({
                    id: z.string().regex(/^[a-z][a-z0-9_]{1,40}\.0[1-6]$/),
                    description: z.string().min(1).max(300),
                    testPrefix: z
                      .string()
                      .regex(/^Acceptance_0[1-6]_[a-f0-9]{12}$/),
                  })
                  .strict(),
              )
              .min(2)
              .max(6)
              .optional(),
          }),
          related_files: z.array(
            z
              .string()
              .refine(
                (value) => !value.startsWith('/') && !value.includes('..'),
              ),
          ),
          related_scenes: z.array(z.string()),
          capabilities: z
            .array(z.string())
            .refine((items) => new Set(items).size === items.length),
        }),
      )
      .min(1),
  })
  .strict();

export const evaluationReportSchema = z
  .object({
    schema_version: z.literal('1.0.0'),
    report_id: z.string().uuid(),
    run_id: z.string().uuid(),
    playtest_run_id: z.string().uuid(),
    game_spec_version_id: z.string().uuid(),
    status: z.enum(['passed', 'failed', 'inconclusive']),
    assertion_results: z.array(
      z.object({
        assertion_id: z.string(),
        status: z.enum(['passed', 'failed', 'inconclusive', 'infra_error']),
        evidence_ids: z.array(z.string().uuid()),
        summary: z.string().optional(),
      }),
    ),
    issues: z.array(
      z.object({
        id: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{1,63}$/),
        assertion_id: z.string(),
        severity: z.enum(['critical', 'high', 'medium', 'low']),
        category: z.enum([
          'compile',
          'runtime',
          'input',
          'movement',
          'physics',
          'combat',
          'progression',
          'ui',
          'build',
          'infrastructure',
        ]),
        description: z.string().min(1),
        expected: z.unknown(),
        actual: z.unknown(),
        evidence_ids: z.array(z.string().uuid()),
        affected_capabilities: z.array(z.string()).min(1),
        retryable: z.boolean(),
      }),
    ),
  })
  .strict();

export const runStatusSchema = z.enum([
  'queued',
  'planning',
  'waiting_for_engine',
  'executing',
  'playtesting',
  'evaluating',
  'fixing',
  'pause_requested',
  'paused',
  'succeeded',
  'partially_succeeded',
  'failed',
  'cancelled',
  'timed_out',
]);
export const runEventSchema = z.object({
  schema_version: z.literal('1.0.0'),
  event_id: z.string().min(1).optional(),
  run_id: z.string().min(1),
  sequence: z.number().int().nonnegative(),
  type: z.string().min(1),
  visibility: z.enum(['creator', 'developer', 'operator', 'audit']),
  occurred_at: z.string().datetime(),
  trace_id: z
    .string()
    .regex(/^[0-9a-f]{32}$/)
    .optional(),
  span_id: z
    .string()
    .regex(/^[0-9a-f]{16}$/)
    .optional(),
  payload: z.record(z.string(), z.unknown()),
});

export function parseGameSpec(value: unknown) {
  const spec = gameSpecSchema.parse(value);
  if (spec.extensions?.gamerhub_creative !== undefined) {
    if (JSON.stringify(spec.extensions.gamerhub_creative).length > 180000)
      throw new Error('CREATIVE_INVALID');
    spec.extensions.gamerhub_creative = creativeSchema.parse(
      spec.extensions.gamerhub_creative,
    );
  }
  return spec;
}
export function parseTaskGraph(value: unknown) {
  return taskGraphSchema.parse(value);
}
export function parseEvaluationReport(value: unknown) {
  return evaluationReportSchema.parse(value);
}
