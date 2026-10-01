# Release readiness

Date: 2026-09-04

## Decision

**CONDITIONAL GO** for controlled implementation, fixture validation and fail-closed gate validation. **NO-GO** for hosted/commercial beta until ADR-0001 has an accountable organization’s signed Unity licensing decision with approved capacity and expiry, and the real release evidence is supplied.

## Checks

- Frozen dependency install, lint, typecheck, tests, and workspace builds are implemented as repeatable gates. Final local results: Biome 273 files clean; 40 test files passed with 84 tests passed and 3 skipped; all 19 buildable workspaces passed.
- The production Unity adapter now invokes pinned CLI/batchmode paths, parses compile/test/build results, supports cancellation/cleanup, and fails closed when a real Unity project/editor is unavailable.
- The production asset path now hash-verifies S3 staging, persists import status/provenance/usage, runs allowlisted Unity import followed by compile and Probe playtest, and rolls back failed imports. The API and Studio replacement flow are mounted and idempotent; the live run still requires the external stack.
- Unity Editor 6000.0.80f1 and WebGL Build Support are installed locally; a real batchmode project compile/edit and WebGL IL2CPP/WebAssembly smoke build passed. Browser E2E and licensed integration tests still fail closed when their release inputs are absent; fixture execution is not treated as release evidence.
- PostgreSQL/RLS/outbox, S3-compatible object storage with scanner and decoder boundaries, durable Game Spec/checkpoint metadata, and Git restore adapters are wired for deployment configuration. Local infrastructure is available, but the full licensed production topology and non-fixture service evidence have not been supplied.
- Studio failures now preserve retry interaction and map creator-safe run failure events into actionable messages. The current DeepSeek credential resolves metadata and the configured model, but the official balance probe reports `INSUFFICIENT_BALANCE`; real prompt generation remains externally blocked until the account is funded.
- Sandbox limits, deny-by-default networking, signed-decision capacity/expiry checks, lease cleanup, and quarantine behavior are implemented and covered by controlled security tests.
- The reproducible stack script validates required services and licensing inputs, can launch the API/worker/Studio processes when `GAMERHUB_START_SERVICES=1`, and records managed PIDs/logs; it still does not fabricate unavailable Unity, evaluator, Probe, or preview services.
- Release evidence loaders now reject fixture/offline provenance, require external human-review and arbitration provenance, enforce signed license capacity/expiry, and require a real three-engine browser denominator for acceptance.
- Governance remains controlled authorization; the external signed Unity license decision is outstanding.

## Required before hosted beta

1. Attach the signed Unity decision, including approver, organization, scope, capacity, terms, and expiry.
2. Run the real Unity/Web/Probe/evaluation/self-fix/API/worker/S3/Git and asset import/rollback flow with artifact isolation and durable services.
3. Replace fixture evidence with non-fixture SC-001–SC-010 denominators, raw artifacts, independent human-review/arbitration provenance, and the real Chromium/Firefox/WebKit matrix.
