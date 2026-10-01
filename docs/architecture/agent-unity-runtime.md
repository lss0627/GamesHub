# Agent–Unity Runtime Architecture

GamerHub uses a bounded Agent to coordinate deterministic game-building tools. The language model interprets a creator request into a validated, versioned Game Spec; it does not receive shell access, arbitrary C# execution, Unity license material, or direct filesystem mutation rights.

The runtime loop is:

`Game Spec → deterministic task graph → plan → act → observe → reflect → checkpoint`

The full component flow is available as [agent-unity-runtime.mmd](./agent-unity-runtime.mmd) and its rendered PNG.

## Responsibility boundaries

| Component | Owns | Must not own |
|---|---|---|
| Model provider | Natural-language intent and schema-constrained Game Spec proposal | Unity commands, credentials, arbitrary source execution |
| Game planner | Dependency-ordered create/modify/rollback task graph | Side effects |
| AgentKernel | Model/tool policy, budget, idempotency ledger, retry decision, checkpoint and trace lifecycle | Game-specific Unity implementation |
| Orchestrator worker | Run lease, workflow selection, mapping PlannerTask to the Unity tool | Bypassing evidence gates |
| UnityTaskExecutor | Game Skill dispatch, compile/test/playtest/evaluate/build evidence | Declaring success without committed evidence |
| Unity adapter | Allowlisted bridge and batchmode process lifecycle | Product-level planning |
| Run event store | Durable Agent checkpoint and visibility-separated trace | Secret or license payloads |
| Studio | Creator-safe progress, recovery and trace projection | Developer-only checkpoint contents |

## Agent policy

The worker exposes two tools to the kernel: `model.game-spec.interpret@1.0.0` and `unity.task.execute@1.0.0`. Model interpretation is classified as `model_inference`; Unity execution is classified as `engine_mutation`. Both are explicitly allowlisted and declared idempotent: model inference has no side effects and its validated result is replayed from the ledger, while every Planner task writes a deterministic project target. The default Run policy is:

- maximum 64 steps and 64 tool calls;
- maximum one automatic retry per action;
- 60-minute Run deadline and 30-minute per-tool timeout;
- retries only for classified infrastructure errors such as timeout, temporary unavailability, lost connection, expired lease or busy engine;
- compile, schema, test, playtest and evidence failures stop closed instead of being blindly retried.

Adding a tool requires an explicit name, version, safety class, idempotency declaration, input/output summary and success assessment. Adding a name to a model prompt alone never grants permission.

## Durable recovery

After every action transition, `AgentKernel` saves a versioned checkpoint through `RunEventAgentCheckpointStore`. The checkpoint contains the policy fingerprint, session identity, budget usage and an action ledger.

- A completed action replays its committed result and does not invoke Unity again.
- A completed model interpretation replays the validated Game Spec proposal and does not call DeepSeek again.
- An interrupted idempotent action emits `agent.recovery.resuming` and may be executed again.
- An interrupted non-idempotent action fails with `RECOVERY_REQUIRES_RECONCILIATION`.
- A changed policy or session fails with `POLICY_MISMATCH` or `SESSION_INCOMPATIBLE`.
- Corrupt checkpoint payloads fail with `AGENT_CHECKPOINT_CORRUPT`.

The default full local profile and production both persist Run events through the same PlatformStore contract to PostgreSQL. The durable execution path also records Game Spec versions, checkpoints, Playtest evidence, evaluation reports, immutable build provenance and the single promoted healthy Preview. A compatibility JSON mode remains available for isolated tests, but it is visibly reported as `dataPlane.mode=json` and is never presented as SQL-backed. Redis carries only best-effort Run acceptance wakeups; PostgreSQL `FOR UPDATE SKIP LOCKED` remains the durable claim and recovery path, so Redis loss cannot lose or complete a Run. No separate recovery database is required.

## Trace and visibility

Creator-visible events are deliberately small:

- `agent.run.started`
- `agent.plan.action_ready`
- `agent.act.started`
- `agent.observe.completed` / `agent.observe.failed`
- `agent.reflect.retrying` / `agent.reflect.stopped`
- `agent.recovery.resuming`
- `agent.run.completed` / `agent.run.failed` / `agent.run.cancelled`

`agent.checkpoint` is developer-only. Studio merges creator events by Run sequence and renders the most recent 100 events. The latest successful Run ID is restored with the Preview, so the trace survives a browser refresh and service restart.

## Unity success contract

A Run can only succeed after the existing evidence gate receives real evidence for schema, engine mutation, automated tests, playtest, evaluation, WebGL build and immutable Preview publication. `real-unity` local mode and production mode remain fail-closed: neither falls back to fixture execution after a real Run starts.

For a modification or rollback, the worker first creates the existing project/Spec checkpoint, then AgentKernel tracks each Unity action. These checkpoints solve different problems and are both required:

- project checkpoint restores source and Game Spec state;
- Agent checkpoint prevents completed tool actions from being repeated after worker recovery.

## Extension path

To add another game genre, implement a schema-constrained Game Skill and deterministic Planner tasks, then map those tasks inside `UnityTaskExecutor`. Keep `AgentKernel` unchanged. To add another engine, implement the vendor-neutral EngineAdapter and register a separately named, separately classified worker tool; do not overload `unity.task.execute`.
