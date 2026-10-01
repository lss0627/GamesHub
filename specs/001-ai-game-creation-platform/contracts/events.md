# Realtime and Audit Event Contract

## Transport

- Creator clients subscribe through `GET /v1/projects/{projectId}/runs/{runId}/events` using Server-Sent Events.
- `Last-Event-ID` is the committed `RunEvent.sequence`; reconnect replays later creator-visible events.
- Developer/operator events use separately authorized endpoints or telemetry backends and are never mixed into creator SSE by client-side filtering.
- Heartbeat every 15 seconds; event retention and replay cursor are server policy.

## Event Envelope

```json
{
  "schema_version": "1.0.0",
  "event_id": "run-id:sequence",
  "run_id": "uuid",
  "sequence": 42,
  "type": "run.progress",
  "visibility": "creator",
  "occurred_at": "2026-08-30T12:00:00Z",
  "trace_id": "optional",
  "payload": {}
}
```

## Creator Events

| Type | Required Payload |
|---|---|
| `run.accepted` | request type and safe summary |
| `run.status_changed` | previous/current status and plain-language message |
| `run.progress` | completed/total, current gameplay capability, optional ETA range |
| `task.status_changed` | public task label and status; no paths/tool names |
| `playtest.started` | checks count and plain-language scope |
| `playtest.check_result` | check label, status and user-safe explanation |
| `fix.iteration_started` | iteration/max and affected capability |
| `build.ready` | build ID and preview preparation status |
| `preview.published` | preview ID/URL and selected version |
| `run.completed` | final status, summary, unresolved issue count |
| `run.action_required` | limitation or user decision needed |
| `run.paused` | safe-boundary pause completed, recovery cursor and resumable status |

## Developer Events

Includes `spec.created/changed`, `task.graph_validated`, `runtime.*`, `model.*`, `tool.*`, `skill.*`, `engine.*`, `editor_lease.*`, `playtest.evidence`, `evaluation.reported`, `checkpoint.*`, `sandbox.*` and `build.*`.

## Projection Rules

- Creator messages use game terms such as “正在测试跳跃”，not “calling unity.component.set_property”.
- Path, C# source, prompt reasoning, tokens, provider details, license refs and host IDs are removed from creator projection.
- A creator-visible completion event can only derive from a committed terminal Run state.
- `run.paused` can only derive from a committed `paused` Run state after its recovery point is durable and exclusive resources are released.
- `partially_succeeded` always includes unresolved issue count and impact; it cannot use the same wording/icon as `succeeded`.
- Duplicate `event_id` is safe to process; clients update by sequence and ignore older events.

## Event Ordering and Transactions

- State transition and its RunEvent append occur in the same database transaction.
- Event publisher reads an outbox/append log and may deliver at least once.
- Sequence gaps trigger replay before the UI advances terminal state.
- Cross-service telemetry may be eventually consistent, but Project/Run/Task status events are authoritative.
