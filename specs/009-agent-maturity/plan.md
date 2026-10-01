# Implementation Plan: Reliable game-development Agent

**Feature**: 009-agent-maturity | **Date**: 2026-09-09 | **Spec**: [spec.md](spec.md)

## Summary

Preserve project source across incremental changes and failed attempts, replace count-only development acceptance with indexed test evidence, make real browser interaction a production publication gate, add atomic targeted editing and explicit mechanism retirement, and expose honest delivery evidence in the existing workbench.

## Technical Context

TypeScript/Node24, Python3.12/FastAPI, official Pi0.85.1, React/Next16 and Unity6000.0.80f1 remain in use. Reuse PostgreSQL run events/checkpoints and local content-addressed source snapshots. Use installed Playwright/Chromium for local WebGL inspection; no new hosting service or model provider. NUnit XML results and SHA256 provide stable evidence identities. Tests: Vitest, pytest, Playwright and genuine Unity batchmode.

Scope: existing local single-project lease execution and ten2D presets. Browser checks have bounded startup/action deadlines and block external network requests; only loopback build content is served. Evidence outputs are bounded, with detailed artifacts kept locally. Existing published builds remain immutable.

## Constitution Check

- I: Reuse worker hooks, EngineAdapter test output, planner, Pi registry and run events; no vendor-specific domain interface.
- II: Publication requires Unity results plus actual browser checks. Indexed acceptance cannot be inferred from counts. UI requires committed run success.
- III: Add and observe failing integration/contract/security tests before production changes.
- IV: Creator reads use existing tenant-scoped run events. Source journals bind project/run and never bypass worker ownership.
- V: All source transitions snapshot prior content; pause/lost lease do not roll back; targeted edits remain fenced/hash checked; browser process/server always close.

Pre-design and post-design gates: PASS. No new external approval or infrastructure needed.

## Design

1. Add a durable local source-attempt journal using existing snapshot functions. Worker begins before workflow mutation; commits only with run publication; failure/cancel restores the baseline after tooling settles. Lost lease/pause preserve work. Journal recovery is idempotent and archives failed source. Unfinished prior terminal-run journals are reconciled before a new run can mutate the project.
2. Same-genre modifications reuse scene composition and only run declared development, tests, evaluation, build and publishing; explicit genre changes use composition. Source restore remains validation-only.
3. Parse bounded NUnit case identities/statuses from the authoritative XML and retain the report. New development carries an acceptance contract version and uses Acceptance_01…Acceptance_06 test names. Each criterion needs a passed case and no failed/skipped case. Legacy unindexed evidence is reported as such, not invented.
4. Add operation=implement/retire to declared mechanisms. Retired entries remain as negative regression requirements. Removing an entry without an explicit retirement plan is rejected before mutation. New development tasks include indexed checks and retirement instructions; existing test files remain read-only except the explicitly declared generated file.
5. Workspace patch takes expectedHash plus bounded unique old/new replacements and atomically applies all or none. Existing full writes remain available for new files. Backups and result hashes are retained. Safe targeted deletion, if needed, is limited to the declared generated mechanism file.
6. A local browser inspector loads the exact WebGL artifact through a fenced ephemeral loopback server, checks identity/start/pause/resume/core behavior, captures errors, observations/screenshots/timings and returns a hashed report. RealUnity publishing calls this before source-version mapping and preview preparation. Failure blocks publication; existing preview remains.
7. Delivery/recovery events expose bounded artifact-free summaries and coverage to the workbench. Detailed reports remain local; no host paths or credentials enter creator events. A completed UI state requires succeeded run plus matching evidence identities; legacy runs show unavailable checks.
8. Remove legacy no-op Runner tasks from production planning; all ten presets compose through the implemented scene entry. Batchmode advertises only implemented commands, rejects unsupported session/scene/object/script/UI methods and unknown properties, and routes generic test execution through real NUnit XML reporting.

## Project Structure

- apps/local-dev/src/source-attempt.ts, source-snapshot.ts, real-unity.ts, browser-playtest.ts, rpc-server.ts, server.ts
- apps/orchestrator-worker/src/worker.ts, executors/unity-task-executor.ts, workflows/modify-game.ts
- packages/game-planner/src/modification-planner.ts and planner.ts
- packages/game-spec/src/development.ts and design-document.ts
- packages/unity-adapter/src/batchmode/runner.ts and nunit-report.ts
- apps/platform-fastapi/gamerhub_api/pi/tools.py and service.py
- apps/studio-web/src/features/creator/GuidedStudio.tsx and features/runs delivery components
- tests/unit, tests/integration, tests/security, tests/ui and tests/real-flow
- reports/agent-maturity.md and artifacts/agent-maturity/

## Complexity Tracking

No constitution deviations. Keep original review history, link current evidence and explicitly retain limitations in general visual authoring, subjective quality, 3D/networking and long-lived multi-user production.
