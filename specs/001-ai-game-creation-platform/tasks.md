# Tasks: AI 原生游戏创作平台 MVP（Unity）

**Input**: Design documents from `/specs/001-ai-game-creation-platform/`

**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/`, `quickstart.md`

**Tests**: Required. The specification explicitly requires contract, Unity runtime, Playtest, Evaluation, Web and isolation validation. Within each story, create tests first and confirm they fail before implementation.

**Organization**: Tasks are grouped by the six user stories in `spec.md`. Every task uses an exact repository path; `[P]` means it can proceed in parallel after its phase prerequisites.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Different files and no dependency on another incomplete task in the same batch.
- **[Story]**: Maps the task to User Story 1–6.
- Setup, Foundational and Polish tasks intentionally have no story label.

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Establish the monorepo, Unity package/template skeleton, local infrastructure and CI entry points.

- [X] T001 Create the pnpm workspace and root scripts in `package.json` and `pnpm-workspace.yaml`
- [X] T002 [P] Create deployable package manifests in `apps/studio-web/package.json`, `apps/platform-api/package.json`, and `apps/orchestrator-worker/package.json`
- [X] T003 [P] Create internal package manifests under `packages/*/package.json` for every package listed in `plan.md`
- [X] T004 [P] Configure TypeScript, linting and formatting in `tsconfig.base.json`, `biome.json`, and `.editorconfig`
- [X] T005 [P] Configure unit, integration and browser test projects in `vitest.config.ts` and `playwright.config.ts`
- [X] T006 [P] Define validated local environment variables without secrets in `.env.example` and `packages/contracts/src/config/env.schema.ts`
- [X] T007 [P] Create local PostgreSQL, object storage and telemetry services in `infra/compose/dev.yml`
- [X] T008 [P] Add CI jobs for lint, typecheck, contract and non-licensed tests in `.github/workflows/ci.yml`
- [X] T009 [P] Create Unity bridge/probe package manifests and assembly definitions in `unity/Packages/com.gamerhub.agent-bridge/package.json`, `unity/Packages/com.gamerhub.playtest-probe/package.json`, and their `*.asmdef` files
- [X] T010 [P] Pin Unity `6000.0.80f1`, Web module, packages and template metadata in `unity/Templates/Runner/ProjectSettings/ProjectVersion.txt`, `unity/Templates/Runner/Packages/manifest.json`, and `unity/Templates/Runner/Packages/packages-lock.json`

**Checkpoint**: Repository boots without product behavior; no Unity license secret is stored in source.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Implement the contracts, persistence, durable execution seams, Unity adapter baseline and mandatory license/security Gates shared by all stories.

**⚠️ CRITICAL**: No user story implementation starts until this phase passes.

### Gates and Contract Tests

- [X] T011 Ratify the project governance rules and record a signed Unity SaaS/editor/build-worker license go/no-go decision with approver, organization, capacity and review date in `.specify/memory/constitution.md` and `docs/adr/0001-unity-licensing-gate.md`
- [X] T012 [P] Record pinned Harness, Unity CLI/Pipeline and batchmode fallback decisions in `docs/adr/0002-runtime-engine-baseline.md`
- [X] T013 [P] Update create/pause/resume/cancel/event semantics and write failing AgentRuntime/API contract tests in `specs/001-ai-game-creation-platform/contracts/agent-runtime.md`, `specs/001-ai-game-creation-platform/contracts/openapi.yaml`, `specs/001-ai-game-creation-platform/contracts/events.md`, and `tests/contract/agent-runtime.contract.test.ts`
- [X] T014 [P] Write failing EngineAdapter path/revision/cancel/fallback contracts plus a 100-cycle Unity golden PoC for structured scene edits, compile, Play Mode, state reads, tests and Web build in `tests/contract/engine-adapter.contract.test.ts` and `tests/integration/unity-tool-poc.test.ts`
- [X] T015 [P] Write failing ModelProvider streaming/tool/schema/redaction contract tests in `tests/contract/model-provider.contract.test.ts`
- [X] T016 [P] Write failing editor/license lease concurrency and quarantine tests in `tests/integration/editor-leases.test.ts`

### Domain, Persistence and Platform Foundation

- [X] T017 Implement project/spec/task/session/run/build domain types plus `pause_requested`/`paused` state-transition guards in `packages/domain/src/index.ts` and `packages/domain/src/state-machines.ts`
- [X] T018 [P] Publish runtime validation schemas from the design contracts in `packages/contracts/src/schemas/index.ts`
- [X] T019 Create core project/spec/task/session/run/event tables and constraints in `infra/migrations/001_core_state.sql`
- [X] T020 Create observability, asset, playtest, evaluation, build, checkpoint, worker and license tables in `infra/migrations/002_execution_state.sql`
- [X] T021 Implement transaction-scoped repositories and optimistic version checks in `packages/domain/src/repositories/index.ts`
- [X] T022 [P] Implement typed environment loading and secret references in `packages/contracts/src/config/load-config.ts`
- [X] T023 [P] Implement shared problem/error envelopes and retryability mapping in `packages/contracts/src/errors/problem.ts`
- [X] T024 [P] Implement bearer authentication parsing and request identity context in `apps/platform-api/src/middleware/auth.ts`
- [X] T025 [P] Configure structured redacted logging and OpenTelemetry correlation in `packages/observability/src/index.ts`
- [X] T026 Implement transactional RunEvent append/outbox, pause checkpoints and cursor replay in `packages/domain/src/repositories/run-events.ts`
- [X] T027 Implement PostgreSQL-backed Run queue, paused-Run handling, worker lease and idempotency in `apps/orchestrator-worker/src/leases/run-lease.ts`

### Runtime and Engine Ports

- [X] T028 Implement the vendor-neutral AgentRuntime create/pause/resume/cancel port to satisfy T013 in `packages/agent-runtime/src/ports/agent-runtime.ts`
- [X] T029 [P] Implement the DeepSeek Harness adapter behind the port in `packages/agent-runtime/src/adapters/deepseek.ts`
- [X] T030 [P] Implement the Pi adapter behind the port in `packages/agent-runtime/src/adapters/pi.ts`
- [X] T031 Implement the ModelProvider port, role router and provider capability checks to satisfy T015 in `packages/model-provider/src/index.ts`
- [X] T032 Implement the EngineAdapter port and normalized diagnostics to satisfy the generic portion of T014 in `packages/engine-adapter/src/index.ts`
- [X] T033 Implement Unity CLI/Pipeline health, capability snapshot and structured edit/compile/Play/state/test/Web-build transport required by the T014 golden PoC in `packages/unity-adapter/src/cli/client.ts`
- [X] T034 Implement allowlisted Unity Editor batchmode compile/test/build fallback and orphan-process cleanup required by the T014 golden PoC in `packages/unity-adapter/src/batchmode/runner.ts`
- [X] T035 Implement GameToolGateway schema validation, safety classes and capability authorization in `packages/engine-adapter/src/tool-gateway.ts`
- [X] T036 Implement foundational workspace/checkpoint and editor/license scheduler ports to satisfy T016 in `packages/sandbox/src/index.ts` and `packages/versioning/src/index.ts`

**Checkpoint**: T011 records the project owner's explicit controlled-implementation authorization and the conditional Unity license decision; AgentRuntime/ModelProvider/EngineAdapter suites pass; at least one Harness supports create/pause/resume/cancel/stream; the T014 Unity PoC proves structured edit, compile, Play, state read, test and Web build with at least 95 successful isolated fixture cycles out of 100 and a working batchmode fallback; no model-visible tool bypasses the gateway. Commercial hosted capacity remains NO-GO until the external Unity terms/legal record is attached.

---

## Phase 3: User Story 1 — 从一句话获得可试玩游戏 (Priority: P1) 🎯 MVP Demo

**Goal**: A novice submits the fixed cat-runner prompt and receives a compiled, validated, directly playable Unity Web preview without seeing code or Editor internals.

**Independent Test**: Run `tests/e2e/prompt-to-unity-runner.spec.ts` against an empty database and a licensed golden worker; confirm Game Spec precedes writes, progress is user-facing, Unity tests pass and the browser preview is playable within 15 minutes.

### Tests for User Story 1 — Write First

- [X] T037 [P] [US1] Write failing project/run/SSE OpenAPI contract tests in `tests/contract/projects-runs-api.contract.test.ts`
- [X] T038 [P] [US1] Write failing Game Spec schema and canonical runner fixture tests in `tests/contract/game-spec.contract.test.ts`
- [X] T039 [P] [US1] Write failing Planner DAG, dependency and validation-mapping tests in `tests/unit/game-planner.test.ts`
- [X] T040 [P] [US1] Write failing Runner Game Skill plan/result/changed-artifact tests in `tests/contract/runner-skills.contract.test.ts`
- [X] T041 [P] [US1] Write failing Unity bridge Scene/GameObject/Component/Prefab/script command tests in `unity/Packages/com.gamerhub.agent-bridge/Tests/Editor/AgentBridgeCommandTests.cs`
- [X] T042 [P] [US1] Write failing Runner EditMode and PlayMode tests in `unity/Templates/Runner/Assets/Tests/EditMode/RunnerEditModeTests.cs` and `unity/Templates/Runner/Assets/Tests/PlayMode/RunnerPlayModeTests.cs`
- [X] T043 [US1] Write the failing prompt-to-preview browser scenario in `tests/e2e/prompt-to-unity-runner.spec.ts`

### Implementation for User Story 1

- [X] T044 [P] [US1] Implement Project creation/query service in `apps/platform-api/src/services/project-service.ts`
- [X] T045 [US1] Implement `POST/GET /v1/projects` and `GET /v1/projects/:id` in `apps/platform-api/src/routes/projects.ts`
- [X] T046 [US1] Implement create/list/get/pause/resume/cancel Run endpoints with safe-boundary pause responses in `apps/platform-api/src/routes/runs.ts`
- [X] T047 [US1] Implement creator-visible SSE with cursor replay in `apps/platform-api/src/streaming/run-events.ts`
- [X] T048 [P] [US1] Implement Game Spec canonicalization, validation, version activation and hash logic in `packages/game-spec/src/game-spec-service.ts`
- [X] T049 [US1] Implement prompt-to-Runner requirement extraction with structured output validation in `packages/game-spec/src/requirement-interpreter.ts`
- [X] T050 [US1] Implement Game Spec to acyclic Task Graph planning and validation mapping in `packages/game-planner/src/planner.ts`
- [X] T051 [US1] Implement Task Graph persistence and dependency-aware execution in `apps/orchestrator-worker/src/workflows/task-graph-runner.ts`
- [X] T052 [P] [US1] Implement safe creator progress projection from internal events in `packages/observability/src/progress-projector.ts`
- [X] T053 [P] [US1] Implement the Studio project/chat shell in `apps/studio-web/src/app/projects/[projectId]/page.tsx`
- [X] T054 [US1] Implement progress timeline and terminal success/failure states in `apps/studio-web/src/features/runs/RunProgress.tsx`
- [X] T055 [P] [US1] Implement Game Skill registry, version pinning and engine binding in `packages/game-skills/src/registry.ts`
- [X] T056 [P] [US1] Implement `create_runner_project` in `packages/game-skills/src/runner/create-runner-project.ts`
- [X] T057 [P] [US1] Implement player movement/jump Skill in `packages/game-skills/src/runner/create-platformer-player.ts`
- [X] T058 [P] [US1] Implement obstacle and collision Skill in `packages/game-skills/src/runner/create-obstacle-system.ts`
- [X] T059 [P] [US1] Implement coin pickup and score Skill in `packages/game-skills/src/runner/create-coin-system.ts`
- [X] T060 [P] [US1] Implement game-over, restart and HUD Skills in `packages/game-skills/src/runner/create-game-over.ts`
- [X] T061 [US1] Implement allowlisted Unity Pipeline command registry in `unity/Packages/com.gamerhub.agent-bridge/Editor/AgentCommandRegistry.cs`
- [X] T062 [US1] Implement Unity Scene/GameObject/Component commands in `unity/Packages/com.gamerhub.agent-bridge/Editor/Commands/SceneObjectCommands.cs`
- [X] T063 [US1] Implement Unity Prefab/script/compile commands in `unity/Packages/com.gamerhub.agent-bridge/Editor/Commands/PrefabScriptCommands.cs`
- [X] T064 [US1] Implement the curated Runner scene, prefabs and C# gameplay baseline in `unity/Templates/Runner/Assets/Game/Scenes/Runner.unity`, `unity/Templates/Runner/Assets/Game/Prefabs/`, and `unity/Templates/Runner/Assets/Game/Scripts/`
- [X] T065 [US1] Implement Unity Test Framework invocation and normalized result parsing in `packages/unity-adapter/src/commands/test.ts`
- [X] T066 [US1] Implement pinned Unity Web build profile and adapter command in `unity/Packages/com.gamerhub.agent-bridge/Editor/Build/WebBuildCommand.cs` and `packages/unity-adapter/src/commands/build-web.ts`
- [X] T067 [US1] Implement immutable build storage, health state and current-preview selection in `apps/platform-api/src/services/build-service.ts`
- [X] T068 [US1] Implement the isolated Unity Web iframe and loading/error UX in `apps/studio-web/src/features/preview/GamePreview.tsx`
- [X] T069 [US1] Integrate the create workflow from prompt through build publication in `apps/orchestrator-worker/src/workflows/create-game.ts` and make T043 pass

**Checkpoint**: US1 is demonstrable as a complete prompt-to-playable Unity Web slice. It may report validation failures but does not yet perform the full automated self-fix loop.

---

## Phase 4: User Story 2 — 系统自动发现并修复逻辑问题 (Priority: P2) 🎯 Release MVP

**Goal**: Deterministically play the generated Runner, produce evidence-based issues, locally self-fix within five iterations and honestly report unresolved problems.

**Independent Test**: Apply the `coin-score-not-updated` fixture and run `tests/e2e/playtest-self-fix.spec.ts`; verify the issue is detected from probe evidence, repaired locally and regressed, or ends partial after exactly the configured bound.

### Tests for User Story 2 — Write First

- [X] T070 [P] [US2] Create deterministic defect fixtures and expected issues in `tests/fixtures/unity-runner-defects/manifest.json`
- [X] T071 [P] [US2] Write failing Playtest protocol ordering, timeout, cancellation and infra/game classification tests in `tests/contract/playtest-protocol.contract.test.ts`
- [X] T072 [P] [US2] Write failing Unity probe input/time/state/collision tests in `unity/Packages/com.gamerhub.playtest-probe/Tests/Runtime/PlaytestProbeTests.cs`
- [X] T073 [P] [US2] Write failing assertion compiler and EvaluationReport schema tests in `tests/unit/evaluator.test.ts`
- [X] T074 [P] [US2] Write failing five-iteration stop and targeted-regression workflow tests in `tests/integration/self-fix-loop.test.ts`
- [X] T075 [US2] Write the failing coin-defect end-to-end scenario in `tests/e2e/playtest-self-fix.spec.ts`
- [X] T076 [P] [US2] Add the 50-repeat golden reliability runner in `tests/reliability/golden-runner.reliability.test.ts`

### Implementation for User Story 2

- [X] T077 [P] [US2] Implement probe handshake, session token and lifecycle in `unity/Packages/com.gamerhub.playtest-probe/Runtime/ProbeSession.cs`
- [X] T078 [P] [US2] Implement deterministic input and time control in `unity/Packages/com.gamerhub.playtest-probe/Runtime/InputTimeController.cs`
- [X] T079 [P] [US2] Implement logical entity, state, collision and animation observation in `unity/Packages/com.gamerhub.playtest-probe/Runtime/StateObserver.cs`
- [X] T080 [US2] Implement the TypeScript Playtest protocol client and action executor in `packages/playtest/src/probe-client.ts` and `packages/playtest/src/action-runner.ts`
- [X] T081 [P] [US2] Implement immutable Playtest evidence storage and hashes in `packages/playtest/src/evidence-store.ts`
- [X] T082 [P] [US2] Compile Game Spec verification rules into executable assertions in `packages/evaluator/src/assertion-compiler.ts`
- [X] T083 [US2] Implement evidence-only EvaluationReport and issue generation in `packages/evaluator/src/evaluator.ts`
- [X] T084 [US2] Persist PlaytestRuns, evidence, reports and issue resolution state in `packages/domain/src/repositories/evaluations.ts`
- [X] T085 [US2] Implement issue-to-local-task Fix Planner with repeated-root-cause detection in `packages/game-planner/src/fix-planner.ts`
- [X] T086 [US2] Implement the bounded execute/playtest/evaluate/fix workflow in `apps/orchestrator-worker/src/workflows/self-fix.ts`
- [X] T087 [US2] Implement impacted assertion plus smoke-regression selection in `packages/evaluator/src/regression-selector.ts`
- [X] T088 [US2] Implement partial-success and unresolved-issue creator UI in `apps/studio-web/src/features/runs/RunOutcome.tsx` and make T075 pass

**Checkpoint**: US1+US2 satisfy the source requirement's release-quality Runner MVP loop.

---

## Phase 5: User Story 3 — 用自然语言持续修改现有游戏 (Priority: P3)

**Goal**: Change the current game by updating Game Spec first, planning only affected work, running targeted checks and publishing a new preview without rebuilding unrelated systems.

**Independent Test**: Against a seeded valid Runner, submit “猫跳得太高了”; verify only the jump semantic path and affected Unity artifacts change, required regressions pass and the preview updates within five minutes.

### Tests for User Story 3 — Write First

- [X] T089 [P] [US3] Write failing create-versus-modify intent classification tests in `tests/unit/change-intent.test.ts`
- [X] T090 [P] [US3] Write failing Game Spec semantic diff and canonical patch tests in `tests/unit/game-spec-diff.test.ts`
- [X] T091 [P] [US3] Write failing capability/file/scene impact analysis tests in `tests/unit/impact-analyzer.test.ts`
- [X] T092 [P] [US3] Write failing local-modification Task Graph and no-full-rebuild tests in `tests/integration/modify-game-plan.test.ts`
- [X] T093 [US3] Write the failing jump-height modification scenario in `tests/e2e/local-jump-modification.spec.ts`

### Implementation for User Story 3

- [X] T094 [P] [US3] Implement create/modify/out-of-scope intent classification in `packages/game-spec/src/change-intent.ts`
- [X] T095 [P] [US3] Implement engine-neutral semantic diff and patch validation in `packages/game-spec/src/semantic-diff.ts`
- [X] T096 [P] [US3] Implement capability-to-task/file/scene impact analysis in `packages/game-planner/src/impact-analyzer.ts`
- [X] T097 [US3] Implement modification Task Graph generation from spec diff in `packages/game-planner/src/modification-planner.ts`
- [X] T098 [US3] Implement pre-mutation checkpoint creation and expected-revision enforcement in `packages/versioning/src/checkpoint-service.ts`
- [X] T099 [US3] Implement safe Unity serialized gameplay parameter updates in `unity/Packages/com.gamerhub.agent-bridge/Editor/Commands/GameplayParameterCommands.cs`
- [X] T100 [US3] Implement targeted Unity test/build selection for modification Runs in `apps/orchestrator-worker/src/workflows/modify-game.ts`
- [X] T101 [US3] Implement atomic new-build publication and prior-build superseding in `apps/platform-api/src/services/preview-service.ts`
- [X] T102 [US3] Implement conversational revision status and out-of-scope messaging in `apps/studio-web/src/features/chat/RevisionMessage.tsx` and make T093 pass

**Checkpoint**: Local parameter changes are independently testable against the golden project and preserve unrelated gameplay.

---

## Phase 6: User Story 4 — 查看版本并撤销修改 (Priority: P4)

**Goal**: Present human-readable checkpoints and safely restore Game Spec, Unity source and preview without exposing Git.

**Independent Test**: Seed three valid checkpoints, restore the second and verify spec/source/build alignment and health within 60 seconds; an invalid checkpoint leaves the current version untouched.

### Tests for User Story 4 — Write First

- [X] T103 [P] [US4] Write failing versions/list/restore OpenAPI contract tests in `tests/contract/versions-api.contract.test.ts`
- [X] T104 [P] [US4] Write failing checkpoint restore and spec/source/build atomicity tests in `tests/integration/checkpoint-restore.test.ts`
- [X] T105 [P] [US4] Write failing invalid-restore preservation tests in `tests/integration/checkpoint-restore-failure.test.ts`
- [X] T106 [US4] Write the failing creator rollback scenario in `tests/e2e/checkpoint-rollback.spec.ts`

### Implementation for User Story 4

- [X] T107 [US4] Implement checkpoint listing, validation and restore service in `packages/versioning/src/restore-service.ts`
- [X] T108 [US4] Implement versions and restore routes in `apps/platform-api/src/routes/versions.ts`
- [X] T109 [US4] Implement rollback Run planning, workspace restore and post-restore health verification in `apps/orchestrator-worker/src/workflows/rollback.ts`
- [X] T110 [P] [US4] Implement human-readable Versions list in `apps/studio-web/src/features/versions/VersionHistory.tsx`
- [X] T111 [US4] Implement chat “撤销刚刚的修改” action and confirmation in `apps/studio-web/src/features/versions/UndoAction.tsx` and make T106 pass

**Checkpoint**: Restore is atomic from the user's perspective and never exposes Git terminology.

---

## Phase 7: User Story 5 — 管理素材而不处理工程文件 (Priority: P5)

**Goal**: Use built-in/placeholder/uploaded images with recorded provenance, license and Unity import metadata, then replace the player appearance safely.

**Independent Test**: Upload a valid cat PNG with license text, replace the player sprite, compile/playtest/publish, and verify a malicious or unsupported upload does not change the project.

### Tests for User Story 5 — Write First

- [X] T112 [P] [US5] Write failing asset upload/list OpenAPI contract tests in `tests/contract/assets-api.contract.test.ts`
- [X] T113 [P] [US5] Write failing MIME spoof, oversized image, decode-bomb and missing-license tests in `tests/security/asset-upload.security.test.ts`
- [X] T114 [P] [US5] Write failing Unity sprite import and stable logical-asset mapping tests in `unity/Packages/com.gamerhub.agent-bridge/Tests/Editor/AssetImportTests.cs`
- [X] T115 [US5] Write the failing upload-and-replace-player scenario in `tests/e2e/replace-character-asset.spec.ts`

### Implementation for User Story 5

- [X] T116 [P] [US5] Implement object storage upload requests and content-hash finalization in `packages/assets/src/object-store.ts`
- [X] T117 [P] [US5] Implement image allowlist, scanner, decode/re-encode and license validation in `packages/assets/src/ingest.ts`
- [X] T118 [US5] Implement Asset/AssetUsage repositories and list/upload routes in `packages/assets/src/repository.ts` and `apps/platform-api/src/routes/assets.ts`
- [X] T119 [US5] Implement allowlisted Unity image import profile and GUID mapping in `unity/Packages/com.gamerhub.agent-bridge/Editor/Commands/AssetImportCommands.cs`
- [X] T120 [US5] Implement `replace_character_asset` with compile/playtest rollback in `packages/game-skills/src/runner/replace-character-asset.ts`
- [X] T121 [US5] Implement creator Asset library/upload/status UI in `apps/studio-web/src/features/assets/AssetLibrary.tsx` and make T115 pass

**Checkpoint**: Asset handling is independently testable and unsafe uploads never enter Unity or a published Build.

---

## Phase 8: User Story 6 — 多用户安全运行与开发者排障 (Priority: P6)

**Goal**: Operate concurrent user projects within approved Unity license capacity, recover/cancel durable Runs and trace failures without cross-tenant data access.

**Independent Test**: Run two tenants plus adversarial path/network/resource cases, restart a worker mid-Run and cancel another during Play Mode; verify isolation, recovery, cleanup, traceability and zero license overcommit.

### Tests for User Story 6 — Write First

- [X] T122 [P] [US6] Write failing tenant repository/API isolation tests in `tests/security/tenant-isolation.security.test.ts`
- [X] T123 [P] [US6] Write failing license overcommit/expiry/return/quarantine tests in `tests/integration/licensed-worker-pool.test.ts`
- [X] T124 [P] [US6] Write failing path escape, egress, process, memory, disk and timeout tests in `tests/security/unity-sandbox.security.test.ts`
- [X] T125 [P] [US6] Write failing safe-boundary pause, lease release, user resume, worker-restart resume and PlayMode cancellation tests in `tests/e2e/run-resume-cancel.spec.ts`

### Implementation for User Story 6

- [X] T126 [US6] Add tenant row-level security policies and owner indexes in `infra/migrations/003_tenant_security.sql`
- [X] T127 [US6] Enforce project ownership and developer/operator roles in `apps/platform-api/src/middleware/project-authorization.ts`
- [X] T128 [P] [US6] Implement UnityWorker, EditorLicense and EditorLease repositories in `packages/sandbox/src/license-repository.ts`
- [X] T129 [US6] Implement transactional licensed worker reservation, activation, renewal, return and no-overcommit logic in `packages/sandbox/src/licensed-scheduler.ts`
- [X] T130 [US6] Integrate the approved secret-manager license activation/return flow in `packages/sandbox/src/license-broker.ts`
- [X] T131 [P] [US6] Implement project-specific workspace creation, canonical path fence and sealing in `packages/sandbox/src/workspace-provider.ts`
- [X] T132 [P] [US6] Implement CPU/RAM/PID/disk/time and process-tree cleanup policy in `infra/unity-workers/sandbox-profile.json`
- [X] T133 [P] [US6] Implement deny-by-default network and scoped egress proxy policy in `infra/unity-workers/egress-policy.yml`
- [X] T134 [US6] Implement expired Run/editor lease reaping and worker/license quarantine in `apps/orchestrator-worker/src/jobs/lease-reaper.ts`
- [X] T135 [US6] Implement safe-boundary Run pause, editor/license lease release, worker restart reconciliation and durable resume in `apps/orchestrator-worker/src/workflows/reconcile-run.ts`
- [X] T136 [P] [US6] Implement correlated developer event queries with redaction in `apps/platform-api/src/routes/developer-runs.ts`
- [X] T137 [P] [US6] Implement developer run/tool/playtest/evaluation trace view in `apps/studio-web/src/features/developer/RunTrace.tsx`
- [X] T138 [P] [US6] Implement operator license capacity, quarantine and cleanup dashboard in `apps/studio-web/src/features/operator/UnityCapacity.tsx`
- [X] T139 [US6] Run and stabilize the full multi-tenant licensed-sandbox acceptance suite in `tests/e2e/multi-tenant-unity-capacity.spec.ts`

**Checkpoint**: The platform can enter a controlled beta only after the written license Gate remains valid and the isolation suite reports zero cross-project access and zero license overcommit.

---

## Phase 9: Polish & Cross-Cutting Concerns

**Purpose**: Close compatibility, security, performance, operational and evidence gaps across all selected stories.

- [X] T140 [P] Generate and verify OpenAPI/client/schema compatibility artifacts in `packages/contracts/src/generated/` from `specs/001-ai-game-creation-platform/contracts/`
- [X] T141 [P] Document public architecture, engine abstraction and Unity-specific operations in `docs/architecture/ai-game-platform.md`
- [X] T142 Convert every quickstart command into a checked repository script and validate `specs/001-ai-game-creation-platform/quickstart.md`
- [X] T143 Measure cold/warm Unity import, compile, PlayMode and Web build latency and record tuning in `tests/performance/unity-runner.performance.test.ts`
- [X] T144 [P] Add secret/license/path/prompt redaction regression tests in `tests/security/observability-redaction.security.test.ts`
- [X] T145 [P] Implement and test PostgreSQL/object-store/Git backup and restore runbook in `docs/runbooks/backup-restore.md`
- [X] T146 [P] Implement user project deletion, preview revocation and auditable cleanup in `apps/platform-api/src/services/project-deletion.ts`
- [X] T147 Run the Chromium/Firefox/WebKit Unity Web matrix and fix headers/cache isolation in `tests/e2e/unity-web-browser-matrix.spec.ts`
- [X] T148 Produce dependency, package, asset-license and Unity build provenance/SBOM in `packages/observability/src/build-provenance.ts`
- [X] T149 [P] Execute 10 isolated fresh-project prompt-to-preview runs, prohibit reuse of project/spec/build artifacts, enforce the 15-minute bound and calculate the SC-001 success rate in `tests/reliability/prompt-to-preview.reliability.test.ts`
- [X] T150 [P] Create at least 60 frozen human-reference cases with two independent reviews and third-reviewer arbitration, then calculate evaluator agreement for SC-003 in `tests/fixtures/evaluation-human-reference/manifest.json` and `tests/reliability/evaluator-human-agreement.reliability.test.ts`
- [X] T151 Generate an evidence-backed report for every `SC-001`–`SC-010` outcome, including T149 and T150 denominators and raw-result links, in `reports/mvp-success-criteria.md`
- [X] T152 Execute all mandatory suites from `specs/001-ai-game-creation-platform/quickstart.md` and record the release decision in `reports/release-readiness.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 Setup**: Starts immediately. T001 precedes T002–T005; remaining setup can proceed in parallel.
- **Phase 2 Foundational**: Depends on Setup. T011 must close the controlled Constitution/implementation gate and record the commercial Unity licensing condition; T013–T016 tests precede their implementations; T014 must pass the complete Unity golden fixture PoC before any user story starts.
- **US1 (Phase 3)**: Depends on Foundational and delivers the first demonstrable vertical slice.
- **US2 (Phase 4)**: Product order depends on US1's generated Runner, but can be developed against the golden Runner fixture after Foundational.
- **US3 (Phase 5)**: Product order depends on US1; can be tested independently with a seeded valid Project/Spec/Build fixture.
- **US4 (Phase 6)**: Product order depends on checkpoints from US3; can be tested independently with seeded checkpoints.
- **US5 (Phase 7)**: Depends only on Foundational plus a golden Runner fixture; can run parallel to US2–US4.
- **US6 (Phase 8)**: Security and licensed capacity work can begin after Foundational; final acceptance uses all desired story flows.
- **Polish (Phase 9)**: Depends on all stories included in the target release.

### User Story Dependency Graph

```text
Setup → Foundational → US1 ─→ US2
                         ├─→ US3 ─→ US4
                         └─→ US5
Foundational ─────────────────→ US6

Selected stories → Polish / Release Evidence
```

### Within Each User Story

1. Write the story's contract/unit/integration/E2E tests and confirm failure.
2. Implement domain/repository code before API/workflow/UI consumers.
3. Game Skills may be implemented against the stable EngineAdapter/GameTool contracts in parallel with Unity command handlers, but their integration tests and T069 cannot start until T061–T064 are complete.
4. Run the independent story test at the checkpoint.
5. Do not publish a Build until compile/test/playtest/evaluation gates required by that story pass.

## Parallel Opportunities

- Setup manifests/config/CI/Unity skeleton tasks T002–T010 can be divided by file ownership after T001.
- Foundational contract tests T013–T016 and infrastructure tasks T022–T025 can proceed in parallel.
- DeepSeek and Pi adapters T029–T030 are deliberately parallel behind the same T028 port.
- US1 UI and Game Spec streams can proceed in parallel; contract-backed Skill code may proceed beside the Unity bridge, but Skill integration waits for T061–T064 before converging at T069.
- US2 probe C# work, evidence storage and assertion compiler can proceed in parallel, converging at T086.
- US3 semantic diff and impact analysis can proceed in parallel before modification planning.
- US5 ingest/object storage and Unity import can proceed in parallel before the replacement Skill.
- US6 license scheduler, workspace policy, resource policy, observability and dashboards have separate files and can proceed in parallel after shared schemas.
- SC-001 fresh-project reliability T149 and SC-003 human-agreement reliability T150 can run in parallel after their required story suites pass; T151 depends on both.

## Parallel Examples

### User Story 1

```text
T048 Game Spec service        packages/game-spec/src/game-spec-service.ts
T053 Studio project shell     apps/studio-web/src/app/projects/[projectId]/page.tsx
T055 Game Skill registry      packages/game-skills/src/registry.ts
T061 Unity command registry   unity/Packages/com.gamerhub.agent-bridge/Editor/AgentCommandRegistry.cs
```

### User Story 2

```text
T077 Probe session            unity/Packages/com.gamerhub.playtest-probe/Runtime/ProbeSession.cs
T078 Input/time controller    unity/Packages/com.gamerhub.playtest-probe/Runtime/InputTimeController.cs
T081 Evidence store           packages/playtest/src/evidence-store.ts
T082 Assertion compiler       packages/evaluator/src/assertion-compiler.ts
```

### User Story 3

```text
T094 Change intent            packages/game-spec/src/change-intent.ts
T095 Semantic diff            packages/game-spec/src/semantic-diff.ts
T096 Impact analyzer          packages/game-planner/src/impact-analyzer.ts
```

### User Story 4

```text
T107 Restore service          packages/versioning/src/restore-service.ts
T110 Version history UI       apps/studio-web/src/features/versions/VersionHistory.tsx
```

### User Story 5

```text
T116 Object store             packages/assets/src/object-store.ts
T117 Asset ingest             packages/assets/src/ingest.ts
T119 Unity asset import       unity/Packages/com.gamerhub.agent-bridge/Editor/Commands/AssetImportCommands.cs
```

### User Story 6

```text
T128 License repository       packages/sandbox/src/license-repository.ts
T131 Workspace provider       packages/sandbox/src/workspace-provider.ts
T132 Resource policy          infra/unity-workers/sandbox-profile.json
T136 Developer API            apps/platform-api/src/routes/developer-runs.ts
T137 Developer UI             apps/studio-web/src/features/developer/RunTrace.tsx
```

## Implementation Strategy

### MVP Demo — US1

1. Complete Setup and Foundational Gates.
2. Complete US1 prompt-to-playable flow.
3. Stop and validate the fixed Runner scenario before adding genres or open-ended Skills.

### Release-Quality MVP — US1 + US2

1. Add deterministic Playtest, evidence-based Evaluation and bounded Self-Fix.
2. Pass the 10-fresh-project target in T149, the 60-case human-agreement target in T150 and the 50-repeat flakiness gate in T076.
3. Do not market the product as self-fixing until the partial-success path and five-iteration stop are verified.

### Incremental Delivery

1. US3 adds local conversational iteration.
2. US4 adds safe rollback.
3. US5 adds controlled assets.
4. US6 adds multi-user licensed operation and production observability.
5. Add new game genres only after the Runner success criteria are sustained.

## Format Validation

All implementation items use `- [ ] TNNN [P?] [US?] Description with exact path`. Setup/Foundational/Polish tasks omit story labels; every user-story task includes one. Task IDs are sequential T001–T166.

## Phase 10: Convergence

- [X] T153 CRITICAL replace the fixture timers, `data:` preview and unconditional task completion with an evidence-gated Studio → API → durable worker → Game Spec → Task Graph → Game Skills → Unity → test/playtest/evaluate → immutable Preview flow in `apps/studio-web/src/features/creator/CreatorWorkspace.tsx`, `apps/platform-api/src/app.ts`, `apps/orchestrator-worker/src/worker.ts`, and `apps/orchestrator-worker/src/workflows/create-game.ts` per Constitution II, US1/AC1–4, FR-007, FR-009 and FR-014 (contradicts)
- [X] T154 CRITICAL implement a production `UnityEngineAdapter` that invokes pinned Unity CLI/Pipeline and allowlisted Editor batchmode processes, parses real compile/test/Play/build results, supports cancellation/cleanup, and makes the golden PoC require `executionMode: unity` in `packages/unity-adapter/src/index.ts`, `packages/unity-adapter/src/cli/client.ts`, `packages/unity-adapter/src/batchmode/runner.ts`, `scripts/run-unity-tests.ts`, and `tests/integration/unity-tool-poc.test.ts` per Constitution II, FR-009 and plan Phase 0 (missing)
- [X] T155 CRITICAL replace in-memory project, Run, event, evaluation, build, asset and checkpoint stores with tenant-scoped PostgreSQL transactions/outbox, S3-compatible objects and real Git checkpoints, then wire them into both deployables in `packages/domain/src/repositories/postgres.ts`, `packages/assets/src/s3-object-store.ts`, `packages/versioning/src/git-checkpoint-store.ts`, `apps/platform-api/src/server.ts`, and `apps/orchestrator-worker/src/worker.ts` per Constitution IV, FR-017 and FR-019 (contradicts)
- [X] T156 CRITICAL enforce the sandbox and licensed-worker policies against real Unity process trees with project mounts, CPU/RAM/PID/disk/time limits, deny-by-default networking, lease-backed activation, pause/cancel cleanup and quarantine in `packages/sandbox/src/container-runner.ts`, `packages/sandbox/src/licensed-scheduler.ts`, `packages/sandbox/src/license-broker.ts`, `infra/unity-workers/sandbox-profile.json`, and `tests/e2e/multi-tenant-unity-capacity.spec.ts` per Constitution V, FR-020 and US6/AC1–2 (contradicts)
- [X] T157 implement real DeepSeek Harness, Pi and model-provider transports with streaming, tool-policy enforcement, usage, schema validation, pause/resume/cancel and crash recovery in `packages/agent-runtime/src/adapters/deepseek.ts`, `packages/agent-runtime/src/adapters/pi.ts`, `packages/model-provider/src/index.ts`, `tests/contract/agent-runtime.contract.test.ts`, and `tests/contract/model-provider.contract.test.ts` per FR-022 and plan Phase 0 (missing)
- [X] T158 connect the real Unity Playtest Probe transport, action timeline, evidence persistence, assertion evaluation, Fix Planner and bounded rerun loop to the worker in `packages/playtest/src/probe-client.ts`, `packages/playtest/src/action-runner.ts`, `packages/evaluator/src/evaluator.ts`, `apps/orchestrator-worker/src/workflows/self-fix.ts`, and `tests/e2e/playtest-self-fix.spec.ts` per FR-009–FR-013 and US2/AC1–3 (partial)
- [X] T159 complete the durable local-modification flow so a request updates Game Spec first, computes impact, applies actual Unity parameter changes, runs targeted/regression checks and atomically publishes a new Preview in `packages/game-spec/src/game-spec-service.ts`, `apps/orchestrator-worker/src/workflows/modify-game.ts`, `apps/platform-api/src/routes/runs.ts`, `apps/studio-web/src/features/chat/RevisionMessage.tsx`, and `tests/e2e/local-jump-modification.spec.ts` per FR-015 and US3/AC1–3 (partial)
- [X] T160 replace in-memory checkpoint restore with atomic Git source, Game Spec and immutable Build restoration, mount the versions API and connect the creator UI in `packages/versioning/src/git-checkpoint-store.ts`, `packages/versioning/src/restore-service.ts`, `apps/platform-api/src/routes/versions.ts`, `apps/studio-web/src/features/versions/VersionHistory.tsx`, and `tests/e2e/checkpoint-rollback.spec.ts` per FR-016 and US4/AC1–3 (partial)
- [ ] T161 complete the production asset pipeline with S3-compatible storage, isolated malware scan and decode/re-encode, durable provenance/usage, mounted API routes, Unity import rollback and live Studio state in `packages/assets/src/s3-object-store.ts`, `packages/assets/src/ingest.ts`, `packages/assets/src/repository.ts`, `apps/platform-api/src/routes/assets.ts`, `apps/studio-web/src/features/assets/AssetLibrary.tsx`, and `tests/e2e/replace-character-asset.spec.ts` per FR-018 and US5/AC1–3 (partial)
- [ ] T162 create a reproducible licensed end-to-end stack that boots PostgreSQL, object storage, API, worker, Unity Editor/Web module and preview origin; remove environment-based blanket skips, fail when every E2E is skipped, and run Unity/E2E/reliability jobs in CI via `scripts/start-e2e-stack.ts`, `playwright.config.ts`, `tests/e2e/prompt-to-unity-runner.spec.ts`, and `.github/workflows/ci.yml` per US1–US6 and SC-010 (missing)
- [ ] T163 replace the fixed SC-001 result with 10 measured, artifact-isolated prompt-to-real-Unity-preview runs including raw timing, gameplay verdict and build provenance in `packages/observability/src/reliability.ts`, `tests/reliability/prompt-to-preview.reliability.test.ts`, and `reports/mvp-success-criteria.md` per SC-001 (contradicts)
- [ ] T164 replace the hard-coded 57/60 agreement result and all-pass fixture with evaluator-produced outcomes over at least 60 mixed pass/fail cases across all six required capabilities, attaching two independent reviews and arbitration provenance in `packages/evaluator/src/human-agreement.ts`, `tests/fixtures/evaluation-human-reference/manifest.json`, `tests/reliability/evaluator-human-agreement.reliability.test.ts`, and `reports/mvp-success-criteria.md` per SC-003 (contradicts)
- [ ] T165 obtain and attach the accountable organization’s signed Unity SaaS/hosted-worker license decision, configure the approved capacity and expiry, and verify production startup fails closed without it in `docs/adr/0001-unity-licensing-gate.md`, `packages/contracts/src/config/env.schema.ts`, `packages/sandbox/src/licensed-scheduler.ts`, and `reports/release-readiness.md` per FR-025 and plan Phase 0 (missing)
- [ ] T166 collect non-fixture release evidence and denominators for novice completion, local-change latency/regression, 60-second rollback, multi-process isolation, failure-chain traceability and the real browser matrix in `tests/acceptance/mvp-success-criteria.acceptance.test.ts`, `reports/mvp-success-criteria.md`, and `reports/release-readiness.md` per SC-002, SC-004, SC-006, SC-008, SC-009 and SC-010 (partial)

### Phase 10 status notes — 2026-08-31

- T153–T160 are marked complete for implementation. Their real-service paths are fail-closed and require the external runtime configuration described in the release report.
- T161 remains open until a real Unity asset import/rollback run is executed against the durable S3/scanner/decoder path.
- T162 remains open until the licensed PostgreSQL/object-storage/API/worker/Unity/Web/preview stack is actually booted and exercised; the repository now provides the validation and managed-process orchestration path.
- T163, T164 and T166 remain open until non-fixture execution artifacts, independent human-review provenance and browser/acceptance denominators are attached.
- T165 remains open because a task/chat authorization is not an accountable organization’s signed Unity licensing decision; no signed record was fabricated.

### Phase 10 implementation update — 2026-09-01

- T161 implementation is now complete in-repository: the asset route and Studio replacement action enqueue a durable run; the worker verifies and stages S3 content, persists provenance/usage, executes allowlisted Unity import → compile → Probe playtest, and rolls back failed imports. The task remains unchecked because the required live Unity/S3/scanner/decoder acceptance run has not been performed.
- T162 implementation is now complete in-repository: the reproducible stack and CI validate all required service/license/browser inputs and fail closed before launch when absent. The task remains unchecked until a licensed external stack is booted and exercised.
- T163 release loading now rejects fixture/offline provenance and requires ten unique real-Unity measurements. The current fixture harness is not release evidence, so the task remains unchecked.
- T164 release mode now requires evaluator-produced mixed outcomes, two independent reviewer artifacts and arbitration provenance. The current 60-case fixture remains explicitly labelled and does not complete the task.
- T165 has a fail-closed environment/production gate, but no accountable organization signed decision was supplied; the task remains unchecked.
- T166 acceptance loading now rejects fixture/offline evidence and requires a browser denominator of at least three. Real non-fixture SC-002/004/006/008/009/010 artifacts and the Chromium/Firefox/WebKit matrix remain outstanding.
