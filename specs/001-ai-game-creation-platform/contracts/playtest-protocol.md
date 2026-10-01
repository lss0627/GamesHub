# Playtest Protocol

## Purpose

定义引擎无关的动作、状态和证据协议。Unity Playtest Probe 提供 Editor Play Mode transport；Unity Web validation build 提供受限 browser bridge。二者必须产生相同语义的 envelopes。

## Session Handshake

```json
{
  "type": "hello",
  "protocol_version": "1.0.0",
  "session_id": "uuid",
  "project_revision": "string",
  "game_spec_version": "uuid",
  "mode": "editor_playmode",
  "seed": 42,
  "fixed_delta_time_ms": 20,
  "capabilities": ["input.action", "state.entity", "time.advance", "frame.capture"]
}
```

The runner rejects version, project revision or spec mismatches before any assertion executes.

## Command Envelope

```json
{
  "request_id": "uuid",
  "sequence": 1,
  "command": "input.action",
  "arguments": {},
  "deadline_ms": 5000
}
```

## Commands

| Command | Arguments | Result |
|---|---|---|
| `input.press` | `action`, optional `strength` | accepted frame/tick |
| `input.release` | `action` | released frame/tick |
| `input.move` | normalized `x`, `y`, `duration_ms` | final tick |
| `input.jump` / `input.shoot` | optional duration/target | accepted tick |
| `input.click` | normalized coordinates/button | target hit if observable |
| `time.wait` | `duration_ms` | elapsed simulation ticks |
| `time.freeze` | boolean | time state |
| `time.advance` | `duration_ms` or ticks | deterministic advanced ticks |
| `game.restart` | optional checkpoint | new scene/run epoch |
| `state.scene` | none | current logical scene ID |
| `state.entity` | logical entity ID, selected fields | bounded state snapshot |
| `state.query` | allowlisted predicate | matching logical entities |
| `state.player` | requested fields | position/health/score/etc. |
| `state.collision` | entity IDs or last events | collision evidence |
| `state.animation` | entity ID | normalized animation state |
| `frame.capture` | optional label | image evidence ID |

MVP action aliases include `move_left`, `move_right`, `jump`, `shoot`, `click`, `wait`, `restart_game`.

## Response Envelope

```json
{
  "request_id": "uuid",
  "sequence": 1,
  "status": "ok",
  "simulation_tick": 120,
  "result": {},
  "evidence_ids": ["uuid"]
}
```

Status values: `ok`, `rejected`, `timeout`, `unsupported`, `infra_error`.

## Event Envelope

Probe may emit `scene.changed`, `entity.spawned`, `entity.destroyed`, `collision.entered`, `collision.exited`, `health.changed`, `score.changed`, `game.over`, `console.error`, `probe.disconnected`. Events include session epoch, simulation tick, logical entity IDs and evidence correlation.

## Assertion Execution

1. Reset to a declared checkpoint and seed.
2. Verify preconditions through state queries.
3. Execute actions in sequence with explicit time/tick bounds.
4. Sample only declared state fields and event types.
5. Store console/test/state/frame evidence with content hashes.
6. Classify transport disconnect, focus failure or missed deadline as `infra_error`, not a game assertion failure.
7. Repeat only when assertion retry policy permits; retries retain all attempts.

## Security and Determinism

- Probe exposes logical IDs and allowlisted fields, never arbitrary reflection/eval or filesystem/network operations.
- Probe listens only within the worker namespace. Session token is ephemeral and scoped to Run/play session.
- Web bridge is included only in validation builds, read-only by default, and guarded by a random session capability. Public release builds remove write/time-control APIs.
- Random seed, Unity version, project revision, fixed timestep, time scale, screen size and build hash are part of environment evidence.
- Runner releases all pressed actions and stops Play Mode on cancellation or failure.

## Runner Baseline Assertions

`player_moves_left_right`, `player_jumps`, `player_lands`, `obstacle_blocks_or_kills`, `coin_pickup_increments_score`, `death_triggers_game_over`, `restart_resets_state`, `web_build_loads_and_accepts_input`.
