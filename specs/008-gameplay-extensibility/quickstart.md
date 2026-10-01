# Validation guide

1. pnpm test -- tests/integration/template-migration.test.ts: local edits, fresh/legacy projects, deletion, repeated upgrades and fenced paths.
2. pnpm test; pnpm typecheck; pnpm lint; pnpm test:fastapi.
3. Unity PlayMode checks for each preset: independent behavior and boundary assertions.
4. Real local flow: generate a dedicated test project, request a bounded new mechanism, confirm real development tool use, build/play, modify and verify preserved source. Use a fresh project, never overwrite the original published game.
5. Browser keyboard/touch pass for ten presets; record exact builds and outcomes under artifacts/gameplay-extensibility. Unverified scenarios remain unchecked.

PowerShell commands for opt-in real acceptance (requires the running local services, licensed Unity and configured model):

```powershell
$env:GAMERHUB_REAL_FLOW = '1'
pnpm exec tsx scripts/verify-gameplay-presets.ts
pnpm exec playwright test --config playwright.flow.config.ts tests/real-flow/gameplay-presets.spec.ts
pnpm exec playwright test --config playwright.flow.config.ts tests/real-flow/mechanism-development.spec.ts
pnpm exec playwright test --config playwright.flow.config.ts tests/real-flow/source-restore.spec.ts
```

The mechanism test creates a dedicated project by default. Source restore consumes the successful mechanism evidence, adds a harmless unpublished comment to that project's generated script, then restores the recorded source version and checks live gameplay. It preserves a backup and does not target the original user's game. Failed runs remain in the project history.

If only the source-restore test's monitoring connection is interrupted, set `$env:GAMERHUB_RESUME_SOURCE_RESTORE = '1'` before rerunning that test to resume the recorded run. Clear this variable before requesting a fresh restore.
