# Validation guide

1. Run new source-attempt and worker lifecycle tests: failure/cancel restoration, pause/lost-lease preservation, idempotency, corrupt snapshot and stale attempt recovery.
2. Run modification planning checks for all ten genres and changed/retired development; source/scene content must survive ordinary changes.
3. Run NUnit evidence tests with missing/skipped cases and retained report integrity; run Python atomic patch fencing/conflict/all-or-none checks.
4. Run the production browser checker against existing real acceptance builds for all ten presets and a deliberately broken build. Preserve screenshots and diagnostics under artifacts/agent-maturity.
5. Run a dedicated real project through mechanism development/update/retirement and failure recovery, preserving the original published user game.
6. Run pnpm test, pnpm test:fastapi, pnpm typecheck, pnpm lint, pnpm build and production UI checks; restart only verified idle project services and confirm health.

Final executable acceptance commands and exact evidence are recorded in reports/agent-maturity.md as implementation completes. Real tests opt in with GAMERHUB_REAL_FLOW=1 and require licensed Unity/local services/model configuration.

Completed 2026-09-09: TS288 passed/3 skipped, Python45/1, production UI21; build/typecheck/lint passed. Three actual mechanism deliveries, paused compile-failure recovery, preserved embedded preview, ten browser presets plus broken artifact, and actual Runner composition/NUnit/unsupported-property rejection passed. See [final report](../../reports/agent-maturity.md) for commands and retained evidence. Run the recovery fixture with `--grep 'actual paused'`, then the workbench fixture with `--grep 'actual workbench'` so their state prerequisites are explicit.
