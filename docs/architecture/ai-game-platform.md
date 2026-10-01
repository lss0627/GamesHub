# GamerHub AI Game Platform Architecture

GamerHub keeps the control plane independent from the game engine. Studio sends a natural-language request to Platform API; the API stores a tenant-scoped Project and Run, while Orchestrator Worker creates a versioned Game Spec and an acyclic Task Graph. High-level Game Skills use the vendor-neutral EngineAdapter contract. The Unity adapter maps those skills to an allowlisted bridge, compile/test/play/build lifecycle, and a deterministic batchmode fallback.

The durable flow is:

`prompt → Game Spec → Task Graph → Skill execution → compile → Playtest → EvaluationReport → Web build → immutable Preview`

Run events are append-only and creator projection removes implementation details. Developer and operator views are separately authorized and redact credentials, license material, host paths and signed URLs. Project repositories, assets, checkpoints, builds and events use owner predicates; the PostgreSQL migration adds row-level security as a second boundary.

The Unity-specific boundary is limited to `unity/Packages/com.gamerhub.agent-bridge` and `packages/unity-adapter`. Unity 6000.0.80f1, package locks and the Runner template are pinned. A licensed scheduler reserves one worker/editor slot at a time, releases it at safe pause/cancel boundaries, and quarantines failed cleanup. The production SaaS license decision remains an external governance requirement recorded in ADR-0001.

The bounded plan–act–observe–reflect loop, durable action ledger, runtime budgets, trace visibility and Unity tool policy are specified in [Agent–Unity Runtime Architecture](./agent-unity-runtime.md).
