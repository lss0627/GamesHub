# Game Skill Contract

## Purpose

Game Skill 把游戏开发经验封装成可复用的高层能力。Skill 使用引擎无关输入与 `EngineAdapter` capabilities，不直接调用 Unity CLI、shell 或修改 host files。

## Definition

```ts
type GameSkillDefinition<I, O> = {
  name: string;
  version: string;
  description: string;
  supportedGenres: string[];
  requiredSpecCapabilities: string[];
  requiredEngineCapabilities: string[];
  inputSchema: JsonSchema<I>;
  outputSchema: JsonSchema<O>;
  plan(input: I, ctx: SkillPlanContext): Promise<SkillPlan>;
  execute(plan: SkillPlan, ctx: SkillExecutionContext): Promise<SkillResult<O>>;
  validate(result: SkillResult<O>, ctx: SkillValidationContext): Promise<SkillValidationResult>;
};
```

## SkillPlan

Must declare:

- Logical entities/systems to create or modify.
- Required engine commands and safety classes.
- Expected changed files/assets/scenes.
- Preconditions and dependencies.
- Postconditions and verification assertions.
- Rollback/checkpoint requirements.
- Estimated time/tool-call budget.

## SkillResult

Must include `status`, structured output, executed command IDs, changed artifacts, created logical entity IDs, warnings, evidence references, validation references and rollback checkpoint. File paths alone are not a valid success result.

## MVP Skill Catalog

| Skill | Responsibility | Minimum Verification |
|---|---|---|
| `create_runner_project` | Apply curated 2D Runner template and base scene | Project compiles; scene loads |
| `create_platformer_player` | Player entity, movement, jump, collision | Move, jump, land, no wall pass |
| `create_obstacle_system` | Obstacles and collision/death rule | Collision triggers configured result |
| `create_coin_system` | Coins, pickup and score | Pickup removes coin and increments score |
| `create_game_over` | Death/game-over/restart flow | Death shows state; restart resets |
| `configure_level` | Scene length, spawn points and finish/loop | Required entities reachable |
| `configure_hud` | Score/coin/health UI | Values match runtime state |
| `replace_character_asset` | Validated uploaded/builtin sprite | Asset imported and player remains playable |
| `change_gameplay_parameter` | Scoped spec-driven value change | Target value changed; smoke regressions pass |

## Rules

- Skill implementation selects an engine-specific strategy through registered bindings; public input/output remains generic.
- Skill must be deterministic for the same spec/template/version/seed where engine behavior permits.
- Skill may compose other Skills but cycles are rejected at registry load.
- Every write is tied to the current Task and expected project revision.
- Direct raw C# generation is allowed only through `script.write` capability and must compile before Skill success.
- Skill failure returns structured error and evidence; it never hides partial changes.
- Registry stores exact skill version in Run and Build provenance.

## Contract Tests

- Input/output schema validation.
- Missing engine capability fails before writes.
- Planned changed-artifact set contains actual writes; unexpected files fail the Skill.
- Cancellation and command failure preserve a restorable checkpoint.
- Validation failure returns `failed_validation`, not success.
