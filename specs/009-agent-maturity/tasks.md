# Tasks: Reliable game-development Agent

Input: spec.md, plan.md, research.md, data-model.md and contracts/agent-evidence.md. Tests are required by the project constitution.

## Phase 1: Setup and foundations

- [x] T001 Record inspected maturity gaps and bounded acceptance in specs/009-agent-maturity and .planning/agent-maturity.
- [x] T002 Define reusable source-attempt and test-evidence contracts in apps/local-dev/src/source-attempt.ts and packages/unity-adapter/src/batchmode/nunit-report.ts, driven by failing tests below.

## Phase 2: US1 — Safe persistent iteration (P1)

Independent acceptance: source and custom scene survive scalar modification; failed/cancelled work is archived/restored; pause/lost ownership preserve work.

- [x] T003 [US1] Add failing source-attempt recovery/fencing/idempotency tests in tests/integration/source-attempt.test.ts and worker lifecycle tests in tests/integration/worker-source-recovery.test.ts.
- [x] T004 [US1] Implement durable source attempt journal using source-snapshot.ts; reconcile incomplete terminal attempts before later mutation.
- [x] T005 [US1] Integrate owned begin/settle boundaries in apps/orchestrator-worker/src/worker.ts and local server/RPC worker wiring; keep committed success, pause and lease loss semantics.
- [x] T006 [US1] Add failing all-genre incremental scene-preservation tests and fix packages/game-planner/src/modification-planner.ts to compose only when the genre changes.

## Phase 3: US2 — Traceable requirement checks (P1)

Independent acceptance: missing/skipped criterion blocks success despite adequate total test count; original XML remains readable and hash verified.

- [x] T007 [US2] Add failing authoritative NUnit parsing/report-retention tests in tests/unit/nunit-report.test.ts and tests/contract/unity-real-adapter.contract.test.ts.
- [x] T008 [US2] Implement bounded XML case results and durable report/hash output in packages/unity-adapter/src/batchmode/runner.ts and nunit-report.ts.
- [x] T009 [US2] Add acceptanceVersion and indexed requirement mapping in packages/game-spec/src/development.ts, design-document.ts and planner.ts; preserve explicit legacy status.
- [x] T010 [US2] Gate actual development and full-regression cases in apps/orchestrator-worker/src/executors/unity-task-executor.ts and report missing/failed criterion IDs, with failing regression tests first.

## Phase 4: US3 — Actual browser delivery gate (P1)

Independent acceptance: broken load/start/identity is rejected; ten actual preset builds pass observable controls and core interaction.

- [x] T011 [US3] Add failing inspector/serving-fence tests in tests/integration/browser-playtest.test.ts and tests/security/browser-playtest.security.test.ts.
- [x] T012 [US3] Implement bounded Playwright inspector and fenced loopback artifact serving in apps/local-dev/src/browser-playtest.ts; preserve errors/screenshots/timings and build identity.
- [x] T013 [US3] Require browser evidence before preparing real publication in apps/local-dev/src/real-unity.ts, with failure-blocking integration tests.
- [x] T014 [US3] Run production inspector against ten actual WebGL preset artifacts and a deliberately broken artifact; retain results under artifacts/agent-maturity.

## Phase 5: US4 — Precise development and retirement (P2)

Independent acceptance: all-or-none expectedHash fragment edits preserve unrelated code; retired mechanism no longer triggers and negative regression passes.

- [x] T015 [US4] Add failing atomic patch/stale hash/ambiguous target/fenced path tests to apps/platform-fastapi/tests/test_mechanism_development.py.
- [x] T016 [US4] Add workspace_patch and structured receipts in tools.py/registry context, update development prompts to prefer small edits and indexed tests.
- [x] T017 [US4] Add operation=implement/retire lifecycle validation and reject silent removal; cover add/change/retire planning with tests in tests/unit/mechanism-development.test.ts.
- [x] T018 [US4] Connect explicit retirement and indexed negative tests through DesignService, Planner and Python development tool phase; address actual intent-path inconsistencies without expanding unsupported runtime claims.

## Phase 6: US5 — Clear delivery and recovery (P2)

Independent acceptance: workbench distinguishes committed verified delivery, failed recovery, missing and legacy evidence without exposing host paths.

- [x] T019 [US5] Emit bounded matching run/spec/build delivery and recovery summaries through existing worker run events; test failure and tenant-safe projections.
- [x] T020 [US5] Add delivery/coverage presentation in apps/studio-web/src/features/creator/GuidedStudio.tsx and runs components, with UI regression tests.

## Phase 7: Cross-cutting verification and delivery

- [x] T021 Run real dedicated project mechanism development/update/retirement plus source-failure recovery; verify actual scene/source behavior and preserve original projects.
- [x] T022 Run pnpm test, test:fastapi, lint, typecheck, build and production UI suite; restart only verified idle services and validate health.
- [x] T023 Update reports/agent-maturity.md, previous report pointers, quickstart and planning/task completion with exact evidence and remaining maturity limitations.
- [x] T024 Replace production legacy Runner no-op steps with actual runtime composition; restrict batchmode capabilities and entry points to implemented behavior, reject unsupported property writes and fake test/session results; verify regressions and real Unity compilation.

Dependencies: T001 → US1; T007–T010 → T017/T018; T011–T014 can proceed independently of source contracts, then T019/T020 integrate evidence; all stories precede T021–T023. Source files shared across stories are edited sequentially. Independent test groups may run concurrently. SpecKit planning permits one bounded read-only browser acceptance research task alongside local implementation; no parallel writes are needed.

Implementation strategy: close and test each user story, then complete the entire authorized scope; do not stop after the first increment. No Git commit/PR is possible because this workspace is not a repository.
