# Tasks: Gameplay extensibility

## Setup

- [x] T001 Record audit scope and architecture in specs/008-gameplay-extensibility/spec.md and plan.md.

## US1: Preserve and migrate (P1)

Independent acceptance: two runs and a template update preserve edits; source restore contains baseline.

- [x] T002 [US1] Add failing migration and fencing tests in tests/integration/template-migration.test.ts.
- [x] T003 [US1] Implement hash-based migration in apps/local-dev/src/template-migration.ts; integrate apps/local-dev/src/real-unity.ts.
- [x] T004 [US1] Verify checkpoint/restore includes source and manifest in apps/orchestrator-worker/src/executors/unity-task-executor.ts and packages/versioning/src.

## US2: Mechanisms and development (P1)

Independent acceptance: approved new mechanism uses normal-stage tools, passes evidence gate, persists.

- [x] T005 [US2] Add failing strict config/registry tests in tests/unit/gameplay-capability-audit.test.ts; implement packages/game-spec/src/mechanism-registry.ts and config mapping.
- [x] T006 [US2] Plan explicit development tasks in packages/game-planner/src/planner.ts and design document flow.
- [x] T007 [US2] Add failing phase/cancellation tests and develop tools in apps/platform-fastapi/gamerhub_api/pi/service.py, tools.py, registry.py and apps/pi-runtime/host.mjs.
- [x] T008 [US2] Verify developed source in apps/orchestrator-worker/src/executors/unity-task-executor.ts and expose capability gaps in apps/studio-web/src.

## US3: Existing games (P2)

Independent acceptance: four games handle pause, retry, boundaries and keyboard/touch; shooter has directed projectiles.

- [x] T009 [US3] Add boundary tests and correct ClickerSimulation.cs under unity/Templates/Runner/Assets/Game/Scripts and Assets/Tests.
- [x] T010 [US3] Add aim/projectiles and differentiated progression in ArenaSimulation.cs and ArenaGame.cs with PlayMode tests.
- [x] T011 [US3] Improve project title, Chinese font, pause and touch in GameCanvas.cs, RunnerGameManager.cs and related controls.

## US4: Concrete presets (P2)

Independent acceptance: each profile executes its unique rules with success and failure/reset evidence.

- [x] T012 [US4] Implement and test flappy/breakout simulations, UI and profile/config integration in unity/Templates/Runner and packages/game-spec/src.
- [x] T013 [US4] Implement and test platformer/tower_defense simulations, UI and profile/config integration in unity/Templates/Runner and packages/game-spec/src.
- [x] T014 [US4] Implement and test sokoban puzzle/branching dialogue presets and truthful custom capability flow in unity/Templates/Runner and packages/game-spec/src.

## Cross-cutting validation

- [x] T015 Run full regression and production build; record results in .planning/gameplay-extensibility/progress.md.
- [x] T016 Run real mechanism-development and ten-profile Unity/browser acceptance in tests/real-flow and artifacts/gameplay-extensibility; fix discovered failures.
- [x] T017 Update reports/gameplay-capability-audit.md and write reports/gameplay-extensibility.md with evidence and precise limits.

Dependencies: T001 → T002 → T003 → T004 → T005 → T006 → T007 → T008; T009–T011 then T012–T014, finally T015–T017. Shared registry/UI files edited sequentially. Parallel opportunities: independent test execution only; no concurrent edits required. Deliver increments but continue through full scope.


