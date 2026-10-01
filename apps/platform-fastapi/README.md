# FastAPI backend

The active HTTP backend is Python FastAPI, started by `pnpm dev:backend` or `pnpm dev`. API routes on 3001 and immutable Unity previews on 3010 share one application and one owned domain process. `/health` reports `framework: fastapi`; `/docs` exposes the explicit OpenAPI contract.

Install Node workspace dependencies and Python 3.12 dependencies from the repository root:

```powershell
pnpm install
pnpm setup:python
pnpm dev:bootstrap
pnpm dev
```

`setup:python` uses uv and the pinned `requirements.txt`. Configure the actual language model and Unity paths in `.env.local`. Never commit that file. `API_PORT` and `LOCAL_SUPPORT_PORT` default to 3001 and 3010. Production mode preserves the existing license decision gate and requires a bearer token; this local single-owner runtime is not a multi-tenant public hosting deployment.

## Runtime responsibilities

Feature007 adds Python-owned project memory and latest checkpoints in PostgreSQL. `/v1/projects/{id}/agent/memory` supports GET and revision-checked POST upsert/delete; `/agent/tools` exposes safe tool metadata. `pi/context.py` projects complete interaction groups under a UTF-8 input budget using the official Pi context hook. `pi/registry.py` independently enforces JSON Schema, phase, timeout, output and replay metadata. The bounded threaded database pool preserves Windows subprocess compatibility. See [architecture and evidence](../../reports/agent-foundation.md).

- FastAPI/Pydantic: explicit HTTP routes, validation, authentication, JSON errors, SSE cursors, image responses and WebGL headers.
- Python ArtService: durable candidate job transitions, cancellation, built-in palette preparation and optional external image requests.
- Python PiService: lifecycle, confirmed-action policy, private message checkpoints, tool ledger, budgets and process cleanup. The pinned official Pi Agent Core 0.85.1 runs in a minimal Node host; Python exposes scoped file and structured Unity CLI tools. DesignService and Worker request Pi sessions over private reverse stdio RPC.
- TypeScript domain process: project-scoped PostgreSQL transactions, revision checks, immutable Spec/version state, S3 asset ingestion, design rules, and the existing Unity Worker. Communication is multiplexed stdio RPC; this process starts no HTTP server. Production injects the Python Pi runtime, without falling back to the legacy test kernel.
- Unity adapter: real Editor batchmode import, compile, PlayMode tests and WebGL build. Four verified PNGs are written to `Assets/Resources/Art`; the runtime loads them by role. Each version carries asset IDs and SHA-256 hashes.

Legacy Fastify files remain for regression tests. Default and licensed startup no longer launch them. Legacy fixture probe/evaluator/publisher endpoints are not served by the new application; real Unity execution uses local engine adapters and evidence files.

## Creator workflow

Discuss gameplay over multiple messages, describe art direction, request two complete candidates, select a set, review the Spec, then explicitly confirm production. Generation/selection creates no Run. Selection invalidates an already prepared Spec. Only the current published Spec determines the “currently used” marker. Version restoration rebuilds from that historical Spec and its immutable image content.

No image service or manual upload is needed for the built-in path. It uses existing artwork and day, dusk or night palettes; it is labelled as built-in recoloring, not new AI-generated art. Registered gameplay modules include Runner, Survivor, top-down shooter and clicker. New mechanics can be discussed, but unregistered production capabilities are shown explicitly instead of silently becoming Runner.

For a separately configured image gateway, set `GAMERHUB_IMAGE_PROVIDER_URL` and optional `GAMERHUB_IMAGE_PROVIDER_KEY`. The backend sends a POST with `prompt`, `role`, `width`, `height`, `transparent`, and optional Bearer authorization. The gateway must return JSON:

```json
{"mime_type":"image/png","bytes_base64":"<base64 PNG bytes>"}
```

Foreground sprites require transparency. Pillow verifies/normalizes image data; bytes pass the existing asset ingestion boundary before a candidate becomes selectable. This is a gateway contract, not a promise of compatibility with a vendor's unmodified API. External-provider HTTP behavior is contract-tested; live vendor quality/cost requires that user's configured service. No silent fallback mislabels built-in art as generated.

Direct OpenAI Images is also supported with `GAMERHUB_IMAGE_PROVIDER=openai`, an explicit supported `GAMERHUB_IMAGE_MODEL`, and a server-only `GAMERHUB_IMAGE_API_KEY` (or `OPENAI_API_KEY`). The default remains built-in; existing gateway URL-only settings still work. `/health` exposes optional `services.images` configuration metadata, never a paid connectivity probe. Two candidates require at most eight image requests; invalid plans fail before requests and failed requests are not automatically retried. New candidates preserve provider/model provenance alongside immutable asset hashes. Setup, extension contracts and `pnpm agent:doctor` / `pnpm verify:agent` / `pnpm test:flow` are documented in the [Agent development runbook](../../docs/runbooks/agent-development.md).

## Failure handling and verification

Plans use PostgreSQL revisions; stale selection returns `ART_CHANGED`. Restart marks interrupted candidate jobs retryable while retaining previous candidates. Failed generation, import or build cannot replace the published preview. Asset import restores its prior resource files when its compile/playtest gate fails. The local signature scanner remains a development smoke check, as reported by its provenance.

```powershell
pnpm test:fastapi
pnpm test
pnpm test:ui
$env:GAMERHUB_REAL_FLOW='1'
pnpm exec playwright test --config playwright.flow.config.ts art-creation-cycle.spec.ts
```

The real-flow test uses actual model replies, PostgreSQL/S3, browser image decoding, explicit confirmation, Unity builds with two different sets, and history restoration. Evidence is in `artifacts/art-flow/`.
