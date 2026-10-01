# Quickstart Validation Guide: Unity Runner MVP

This guide defines the runnable acceptance path the implementation must provide. It is a validation contract, not implementation code.

## 1. Prerequisites

- Ubuntu 22.04+ x86_64 worker or supported local development host.
- Node.js 24 LTS and pnpm version pinned by the repository.
- Docker/rootless container runtime with Compose support.
- Unity CLI version pinned in repository tooling.
- Unity 6.0 LTS `6000.0.80f1` with Web Build Support installed.
- Unity Pipeline package version pinned in `unity/Packages/`.
- An approved Unity Editor license/Build Server workflow for the machine. Never commit license files, tokens or service-account secrets.
- PostgreSQL 18 and S3-compatible object storage supplied by the local Compose profile.
- At least one configured model provider and one enabled AgentRuntime adapter.

Install/check the Windows development toolchain and create the ignored `.env.local`:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/install-dev-tools.ps1
pnpm dev:bootstrap
pnpm env:doctor:local
```

The Unity download is resumable. To resume only the pinned Editor/WebGL installation, run `pnpm unity:install`; progress is written to `artifacts/dev-tools/unity-install-status.json`. The Editor is installed under the current user's `%LOCALAPPDATA%\Programs\Unity` tree so the setup does not depend on an administrator shell.

The installer never creates a signed Unity licensing decision. Unity Hub login/license activation and any required license acceptance remain explicit operator actions.

Run the licensed production preflight only when the accountable organization has supplied the required decision record:

```bash
pnpm env:doctor
```

Expected: Node/pnpm, database, object storage, Docker security profile, Unity CLI, Editor version, Web module, Pipeline package, license availability and browser dependencies all report `ready`. A license or version mismatch must fail, not warn-and-continue.

## 2. Start the Local Development Platform

The default development command starts Studio plus an in-process API/Worker and loopback support services. It is runnable without Docker or a Unity license and every simulated artifact is marked `fixture://local-dev`, so release gates reject it.

```bash
pnpm install --frozen-lockfile
pnpm dev:infra
pnpm dev
```

Expected local endpoints:

- Studio: `http://127.0.0.1:3000`
- API health: `http://127.0.0.1:3001/health`
- Local support/preview health: `http://127.0.0.1:3010/health`

This path validates product interaction and orchestration only. It does not prove Unity compilation, malware scanning, human evaluation, licensing or release readiness.

## 3. Bootstrap the Licensed Integration Platform

```bash
pnpm install --frozen-lockfile
docker compose -f infra/compose/dev.yml up -d postgres object-storage otel
pnpm db:migrate
pnpm fixtures:install-unity-runner
pnpm dev:licensed
```

Expected endpoints:

- Studio: `http://127.0.0.1:3000`
- API health: `http://127.0.0.1:3001/health`
- Worker health includes AgentRuntime and Unity worker capacity without exposing license identifiers.

## 4. Phase 0 Contract Gates

### Agent Runtime

```bash
pnpm test:contract --filter agent-runtime
pnpm test:contract --filter agent-runtime-deepseek
pnpm test:contract --filter agent-runtime-pi
```

Expected: at least one adapter passes create/resume/cancel/event ordering/tool rejection/crash recovery. The selected default is recorded in the generated Phase 0 ADR.

### Unity Engine Adapter

```bash
pnpm test:contract --filter engine-adapter
pnpm test:contract --filter unity-cli-primary
pnpm test:contract --filter unity-batchmode-fallback
```

Expected: adapter inspects the golden project, creates/updates a Scene, GameObject, Component, Prefab and C# script, compiles, enters Play Mode, reads probe state, runs tests and builds Web. Disabling the CLI/Pipeline path proves batchmode compile/test/build fallback.

### Sandbox and License Capacity

```bash
pnpm test:security --filter workspace-network-process
pnpm test:integration --filter editor-license-leases
```

Expected: path traversal, symlink escape, egress, resource abuse and cross-project reads fail; concurrent reservations never exceed configured entitlement; cancel returns or quarantines the lease and leaves no Editor process.

## 5. End-to-End Scenario A — Prompt to Playable Unity Web Game

1. Open Studio and create a project named `Cat Runner Acceptance`.
2. Submit:

   > 做一个可以跳跃、躲避障碍物、收集金币的猫咪跑酷游戏。

3. Observe progress over SSE.

Expected:

- A validated Game Spec is committed before Unity project writes.
- A DAG Task Graph exists; every Task has validation and capabilities.
- Creator UI shows gameplay labels, not C#, Unity commands, filesystem paths or tokens.
- Unity project compiles and the platform performs Playtest/Evaluation.
- A content-addressed Unity Web preview becomes healthy and launches in the browser.
- Total time is at most 15 minutes for the fixed acceptance environment.

Run the automated equivalent:

```bash
pnpm test:e2e --filter prompt-to-unity-runner
```

## 6. Scenario B — Deterministic Playtest and Self-Fix

Inject the fixture defect where coin collision does not update score:

```bash
pnpm fixtures:apply-defect coin-score-not-updated
pnpm test:e2e --filter playtest-self-fix
```

Expected:

- `coin_pickup_increments_score` fails with probe state and frame/console evidence.
- Evaluation issue is `high`, retryable and mapped to the coin capability.
- Fix Planner creates scoped Tasks; only affected checks plus smoke regressions rerun.
- Run succeeds within five iterations, or ends `partially_succeeded` with the unresolved issue. It never reports full success without passing evidence.

Repeatability gate:

```bash
pnpm test:reliability --filter golden-runner --repeat 50
```

Expected: infrastructure/game failures are separately counted and false assertion results stay below the Phase 0 threshold.

## 7. Scenario C — Natural-Language Local Modification

On the successful project, submit:

> 猫跳得太高了。

Expected:

- A new Game Spec version changes only the jump-related semantic path.
- A checkpoint is created before Unity writes.
- Task Graph contains scoped parameter/script/test/build Tasks rather than a full project rebuild.
- Jump assertion and smoke regressions pass.
- New preview is published within five minutes and previous build remains addressable in version history.

```bash
pnpm test:e2e --filter local-jump-modification
```

## 8. Scenario D — Rollback

```bash
pnpm test:e2e --filter checkpoint-rollback
```

Expected: restoring the previous checkpoint restores Game Spec, Git revision, selected Build and healthy Preview within 60 seconds. A failed restore never overwrites the current valid checkpoint.

## 9. Scenario E — Unity Web Browser Matrix

```bash
pnpm test:web --project chromium
pnpm test:web --project firefox
pnpm test:web --project webkit
```

Expected for each supported target:

- `.wasm`, data and script files return correct MIME/compression headers over HTTPS-equivalent test serving.
- Preview starts, accepts keyboard/click input and exposes no platform cookie or write-capable validation bridge.
- A new build hash cannot be replaced by stale cache.
- Browser console has no unhandled Unity loader/runtime errors.

## 10. Scenario F — Resume and Cancel

```bash
pnpm test:e2e --filter run-resume-after-worker-restart
pnpm test:e2e --filter cancel-during-unity-playmode
```

Expected:

- Restarted worker resumes from RunEvent/Task/Session state without regenerating the project from chat.
- Cancellation stops model/tool activity, releases input actions, exits Play Mode/Editor, seals evidence and returns or quarantines the license lease.

## 11. Full Validation

```bash
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm test:contract
pnpm test:integration
pnpm test:unity
pnpm test:unity:soak # licensed release gate: at least 95/100 real cycles
pnpm test:e2e
pnpm test:security
```

Release candidate is acceptable only when all mandatory suites pass, the Unity license/legal Gate is signed off, the selected Harness/Unity CLI versions are pinned, and `spec.md` success criteria have an evidence report.

## Troubleshooting Boundaries

- `LICENSE_UNAVAILABLE`: do not retry beyond lease queue policy; verify entitlement and worker quarantine status.
- `ENGINE_VERSION_MISMATCH`: reinstall/select the exact pinned Editor and Web module; do not migrate the project automatically.
- `ENGINE_UNAVAILABLE`: run adapter health and batchmode fallback diagnostics; preserve the workspace.
- `COMPILE_FAILED` / `TEST_FAILED`: treat as project evidence for Evaluation, not infrastructure retry.
- `PLAYMODE_FAILED` with probe disconnect: classify infrastructure until a game error is proven.
- `BUILD_FAILED`: retain build log and previous published preview; never publish a partial directory.
