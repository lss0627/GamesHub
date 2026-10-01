# Implementation Plan: Gameplay extensibility

**Feature**: 008-gameplay-extensibility | **Date**: 2026-09-08 | **Spec**: spec.md

## Summary

Preserve project-owned changes with hash-based template migration; register mechanism/config contracts; expose an explicit development stage to Pi; improve existing Unity 2D games and implement concrete catalog presets with real acceptance evidence.

## Technical Context

Use existing TypeScript 5.9 / Node >=24, Python FastAPI / Pi 0.85.1 and pinned Unity C# WebGL project. Reuse PostgreSQL state/checkpoints and project filesystem. Tests: Vitest, pytest, Unity Test Framework, Playwright. Target local Windows authoring and browser keyboard/touch play. Keep bounded simulations and existing run budgets; no new infrastructure or Unity package upgrades. Scope: ten concrete 2D profiles and bounded custom development.

## Constitution Check

Before and after design: PASS. Engine-neutral spec/planner interfaces retained; no fake success; tests precede critical changes; source/manifest in recoverable project data; fenced paths and existing tool budgets remain enforced. User explicitly authorizes this implementation; previous feature work remains preserved. No commercial publishing. No architecture violation required.

## Project Structure

- apps/local-dev/src/template-migration.ts and real-unity.ts: safe migration and project startup.
- packages/game-spec/src: mechanism registry, strict config assessment, design mappings.
- packages/game-planner/src/planner.ts: explicit development stage.
- apps/platform-fastapi/gamerhub_api/pi and apps/pi-runtime/host.mjs: tool phases and development execution.
- apps/orchestrator-worker/src/executors/unity-task-executor.ts: development verification/checkpoints.
- unity/Templates/Runner/Assets/Game and Assets/Tests: simulations, UI and per-preset tests.
- apps/studio-web/src: creator-facing capability information.
- tests: contract/integration/unit and real-flow acceptance.

## Implementation Strategy

Complete US1 before enabling normal-stage writes. Implement contracts and development flow before adding presets. Extend small simulations first, then larger concrete presets. Verify each independently, then run broad regression and actual browser acceptance. Do not count unplayed scenarios as verified. No research uncertainty about technology choice: reuse existing installed versions and local code contracts.

## Complexity Tracking

No exceptions required.
