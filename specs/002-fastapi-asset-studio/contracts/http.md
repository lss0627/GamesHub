# HTTP and provider contracts

Preserve explicit /v1 routes for projects, designs, runs (including events/trace/control), versions and assets. JSON errors {code}; create project/asset 201; admitted runs/restore 202; invalid 400; stale/active conflict 409. Preserve idempotency, trace headers and Last-Event-ID. Assets remain JSON base64 upload + binary content GET. /health reports framework=fastapi and existing provenance. /openapi.json documents explicit API routes.

GET /v1/projects/{projectId}/art -> ArtPlan plus providers and applied assets derived from current published spec.
POST .../art/generate {revision,prompt,source:'builtin'|'image-provider'} -> 202 ArtPlan generating. Background creation persists complete immutable candidates or failed with a safe code.
POST .../art/select {revision,candidateId} -> updated ArtPlan; invalidates prepared DesignDocument. Does not create run.
POST .../art/cancel {revision} -> failed/cancelled generation state, prior selected candidate retained.
Existing design prepare/confirm validate and snapshot selected candidate.

Configured image provider: environment GAMERHUB_IMAGE_PROVIDER_URL, optional GAMERHUB_IMAGE_PROVIDER_KEY. POST configured endpoint with {prompt,role,width,height,transparent}; optional Bearer header. Response {bytes_base64,mime_type:'image/png'}. No remote image URLs are fetched. Four roles create a coherent set with shared style prompt, validated and normalized PNG before ingest. External errors never silently change requested source to builtin.

Preview continues /real-previews/{projectId}/{buildHash}/{path}; resolve trusted root, reject escape/symlink escape, set MIME/encoding/COOP/COEP/CORP/CORS; preserve immutable builds.
RPC is local stdio only with request id and named allowlisted operations; no eval, arbitrary SQL, executable or HTTP listener.
