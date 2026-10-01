# Quickstart validation

1. pnpm dev:infra && pnpm db:migrate (run separately in PowerShell).
2. pnpm setup:python (requires uv; creates Python 3.12 venv and installs pinned dependencies)
3. pnpm dev:backend; frontend pnpm --filter @gamerhub/studio-web dev.
4. GET 3001/health framework fastapi; 3001/docs shows endpoints. Verify existing project and 3010 preview.
5. pnpm test:fastapi
6. pnpm exec vitest run --maxWorkers 4; pnpm typecheck; pnpm lint; pnpm test:ui.
7. Browser: discuss at least two turns, open art panel, describe a style, prepare automatic candidates, select, review Spec and confirm. Confirm actual WebGL uses selected images. Change selection, build again, restore old version and verify old art.
8. Real test: in PowerShell set `$env:GAMERHUB_REAL_FLOW='1'` then `pnpm exec playwright test --config playwright.flow.config.ts art-creation-cycle.spec.ts`. Optional `$env:GAMERHUB_FLOW_PROJECT_ID` reuses an existing project. Check `artifacts/art-flow/cycle.json`, screenshots and GameSpec/asset/build hashes.

The original new-project/gameplay-change/restore test is `full-creation-cycle.spec.ts` with the same config. Remove GAMERHUB_FLOW_PROJECT_ID to test a fresh project. These tests create durable projects and actually call the model and Unity.

When a production frontend is already running, set `$env:GAMERHUB_UI_TEST_URL='http://127.0.0.1:3000'` before `pnpm test:ui` to avoid starting another Next instance against the same build directory.

No image provider is required for builtin path. For external source configure only local environment and verify availability; do not paste secrets into evidence.
