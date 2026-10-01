# Data Model: AI 原生游戏创作平台 MVP（Unity）

## Conventions

- 所有业务主键使用 UUID；用户可见编号另设短 ID。
- 所有记录包含 `created_at`，可变聚合包含 `updated_at` 和 optimistic `version`。
- 多租户表必须包含 `owner_id` 或可经外键唯一追溯到 `Project.owner_id`；所有查询强制 tenant scope。
- `run_events`、model/tool/skill calls 和 evaluation evidence 为 append-only；状态表是事件投影，不覆盖审计事实。
- 大文件只在对象存储保存，数据库保存 content hash、size、media type 和 object key。
- Unity 专有字段只允许出现在 engine metadata、Unity worker/command/build provenance 中；Game Spec 业务语义保持引擎无关。

## Entity Map

```text
User 1──* Project 1──* GameSpecVersion
                  ├──* TaskGraph 1──* Task *──* TaskDependency
                  ├──* AgentSession 1──* Run 1──* RunEvent
                  │                         ├──* ToolInvocation
                  │                         ├──* ModelCall
                  │                         ├──* SkillInvocation
                  │                         ├──* PlaytestRun 1──* PlaytestEvidence
                  │                         └──* EvaluationReport 1──* EvaluationIssue
                  ├──* Asset *──* AssetUsage
                  ├──* Checkpoint
                  └──* Build 0..1──1 Preview

UnityWorker 1──* EditorLease *──1 Run
EditorLicense 1──* EditorLease
```

## Core Entities

### User

| Field | Type | Rules |
|---|---|---|
| `id` | UUID | Primary key |
| `email` | text | Normalized unique identity |
| `display_name` | text | 1–80 chars |
| `status` | enum | `active`, `suspended`, `deleted` |
| `role` | enum | `creator`, `developer`, `operator`, `admin` |

### Project

| Field | Type | Rules |
|---|---|---|
| `id` | UUID | Primary key |
| `owner_id` | UUID | Required User FK |
| `name` | text | 1–120 chars |
| `slug` | text | Unique per owner |
| `status` | enum | `draft`, `creating`, `playable`, `degraded`, `archived` |
| `engine_type` | enum | MVP only `unity`; domain permits future adapters |
| `engine_version` | text | Exact value, MVP `6000.0.80f1` |
| `current_spec_version_id` | UUID? | Must belong to project |
| `current_checkpoint_id` | UUID? | Must belong to project |
| `current_build_id` | UUID? | Only a `ready/published` build |
| `workspace_repo_key` | text | Opaque storage reference, never exposed to creator UI |
| `quota_profile` | text | References platform quota policy |

**Invariant**: `current_spec_version_id`, `current_checkpoint_id` and `current_build_id` advance in one transaction with the corresponding successful Run transition.

### GameSpecVersion

| Field | Type | Rules |
|---|---|---|
| `id` | UUID | Primary key |
| `project_id` | UUID | Required Project FK |
| `version_number` | integer | Monotonic and unique per project |
| `schema_version` | text | Contract version, starts `1.0.0` |
| `parent_version_id` | UUID? | Same project; null only for first version |
| `source_run_id` | UUID | Run that proposed/accepted it |
| `change_type` | enum | `create`, `modify`, `rollback`, `migration` |
| `summary` | text | Human-readable, no code details |
| `spec_json` | jsonb | Must validate against game-spec schema |
| `semantic_diff` | jsonb | Normalized changed capability paths |
| `content_hash` | text | Unique for identical canonical spec content |
| `status` | enum | `proposed`, `active`, `superseded`, `rejected` |

**Invariant**: A project has exactly one `active` GameSpecVersion. No TaskGraph may execute against `proposed` or `rejected` versions.

### TaskGraph

| Field | Type | Rules |
|---|---|---|
| `id` | UUID | Primary key |
| `project_id` | UUID | Required |
| `game_spec_version_id` | UUID | Required, same project |
| `run_id` | UUID | Required |
| `kind` | enum | `create`, `modify`, `fix`, `rollback`, `validate`, `publish` |
| `planner_version` | text | Reproducibility |
| `status` | enum | `draft`, `validated`, `executing`, `completed`, `failed`, `cancelled` |
| `graph_hash` | text | Canonical DAG hash |

### Task

| Field | Type | Rules |
|---|---|---|
| `id` | UUID | Primary key |
| `task_graph_id` | UUID | Required |
| `task_key` | text | Stable unique ID within graph |
| `type` | enum | `spec`, `scene`, `component`, `script`, `asset`, `test`, `playtest`, `evaluate`, `fix`, `build`, `publish`, `rollback` |
| `description` | text | User/domain language |
| `status` | enum | `pending`, `running`, `blocked`, `failed`, `completed`, `cancelled` |
| `retry_count` | integer | `0..max_retries` |
| `max_retries` | integer | Default 2; self-fix loop controlled separately |
| `validation_method` | jsonb | Assertion/test/tool reference |
| `related_files` | text[] | Workspace-relative canonical paths |
| `related_scenes` | text[] | Logical scene IDs plus optional adapter metadata |
| `capabilities` | text[] | Allowlisted engine/tool capability names |
| `started_at` / `finished_at` | timestamptz? | Lifecycle timestamps |
| `error_code` / `error_summary` | text? | Structured final/last failure |

### TaskDependency

| Field | Type | Rules |
|---|---|---|
| `task_graph_id` | UUID | Composite PK |
| `task_id` | UUID | Composite PK |
| `depends_on_task_id` | UUID | Composite PK; same graph; not self |
| `kind` | enum | `hard`, `validation`, `artifact` |

**Invariant**: The dependency relation is acyclic. A task can enter `running` only when every hard dependency is `completed`.

## Session and Execution State

### AgentSession

| Field | Type | Rules |
|---|---|---|
| `id` | UUID | Primary key |
| `project_id` | UUID | Required |
| `runtime_type` | enum | `deepseek`, `pi`, future adapter |
| `runtime_session_ref` | text | Opaque vendor ID, encrypted at rest if sensitive |
| `status` | enum | `active`, `idle`, `cancelled`, `closed`, `error` |
| `last_event_sequence` | bigint | Event replay checkpoint |
| `context_snapshot_key` | text? | Object storage reference |
| `model_route_snapshot` | jsonb | Role → provider/model/version |

### Run

| Field | Type | Rules |
|---|---|---|
| `id` | UUID | Primary key |
| `project_id` / `session_id` | UUID | Required and same project |
| `parent_run_id` | UUID? | For resume/retry lineage |
| `request_type` | enum | `create`, `modify`, `validate`, `rollback`, `publish` |
| `user_input` | text | Immutable original request |
| `status` | enum | `queued`, `planning`, `waiting_for_engine`, `executing`, `playtesting`, `evaluating`, `fixing`, `pause_requested`, `paused`, `succeeded`, `partially_succeeded`, `failed`, `cancelled`, `timed_out` |
| `fix_iteration` | integer | `0..max_fix_iterations` |
| `max_fix_iterations` | integer | Default 5 |
| `idempotency_key` | text | Unique per owner/request boundary |
| `lease_owner` | text? | Worker ID |
| `lease_expires_at` | timestamptz? | Renewable lease |
| `started_at` / `finished_at` | timestamptz? | Lifecycle |
| `result_summary` | text? | Creator-facing summary |
| `unresolved_issue_count` | integer | Default 0 |

### RunEvent

| Field | Type | Rules |
|---|---|---|
| `run_id` | UUID | Composite PK |
| `sequence` | bigint | Composite PK, strictly increasing |
| `event_type` | text | Namespaced, versioned |
| `visibility` | enum | `creator`, `developer`, `operator`, `audit` |
| `payload` | jsonb | Validated by event schema |
| `trace_id` / `span_id` | text? | Correlation |
| `occurred_at` | timestamptz | Immutable |

**Session state source of truth**: `AgentSession` identifies durable runtime context; `Run` is the business state machine; `RunEvent` is immutable history. Resume uses the last committed event sequence and task states, never raw chat alone.

## Harness, Model and Tool Observability

### ModelCall

`id`, `run_id`, `task_id?`, `role`, `provider`, `model`, `request_hash`, `response_hash`, `prompt_tokens`, `completion_tokens`, `cached_tokens`, `latency_ms`, `status`, `error_code?`, `started_at`, `finished_at`, `redacted_trace_key?`.

### ToolInvocation

`id`, `run_id`, `task_id`, `tool_name`, `tool_version`, `safety_class`, `input_hash`, `output_hash`, `status`, `retryable`, `started_at`, `finished_at`, `latency_ms`, `error_code?`, `evidence_key?`.

### SkillInvocation

`id`, `run_id`, `task_id`, `skill_name`, `skill_version`, `engine_adapter`, `input_hash`, `result_json`, `status`, `started_at`, `finished_at`.

**Redaction rule**: Raw prompts/tool output are stored only when policy permits; secrets, personal data, license tokens, absolute host paths and signed URLs must be removed before persistence.

## Unity Worker and Licensing

### UnityWorker

| Field | Type | Rules |
|---|---|---|
| `id` | UUID | Primary key |
| `host_ref` | text | Opaque infrastructure ref |
| `status` | enum | `offline`, `starting`, `ready`, `busy`, `draining`, `quarantined` |
| `editor_version` | text | Exact supported version |
| `unity_cli_version` | text | Exact pinned version |
| `pipeline_package_version` | text | Exact pinned version |
| `capabilities` | text[] | `web_build`, `playmode`, `gpu_capture`, etc. |
| `resource_profile` | jsonb | CPU/RAM/disk limits |
| `last_health_at` | timestamptz | Required before lease |

### EditorLicense

| Field | Type | Rules |
|---|---|---|
| `id` | UUID | Primary key |
| `provider_ref` | text | Encrypted/opaque reference; never raw key |
| `tier` | enum | `personal`, `pro`, `enterprise`, `build_server`, `other` |
| `status` | enum | `available`, `leased`, `returning`, `expired`, `quarantined` |
| `concurrency_limit` | integer | From approved entitlement |
| `expires_at` | timestamptz? | Optional entitlement expiry |
| `metadata` | jsonb | Contract/organization references, access restricted |

### EditorLease

| Field | Type | Rules |
|---|---|---|
| `id` | UUID | Primary key |
| `run_id` | UUID | Unique active lease per Run |
| `worker_id` | UUID | Required |
| `license_id` | UUID | Required |
| `status` | enum | `reserved`, `activating`, `active`, `returning`, `released`, `quarantined` |
| `acquired_at` | timestamptz | Required |
| `expires_at` | timestamptz | Hard lease bound |
| `released_at` | timestamptz? | Required when released |
| `activation_audit_ref` | text? | Redacted audit reference |

**Invariant**: Active leases cannot exceed `EditorLicense.concurrency_limit`; a worker has at most one active Editor lease in MVP; failure to return/clean activates quarantine and blocks reassignment.

## Assets and Project Files

### Asset

`id`, `project_id`, `type`, `name`, `source` (`builtin`, `placeholder`, `upload`), `source_uri?`, `license_id?`, `license_text?`, `object_key`, `content_hash`, `media_type`, `size_bytes`, `width?`, `height?`, `metadata`, `security_status`, `import_status`, `created_by_run_id`.

### AssetUsage

`asset_id`, `project_id`, `logical_entity_id`, `unity_asset_guid?`, `relative_path`, `usage_kind`, `introduced_spec_version_id`, `removed_spec_version_id?`.

**Rules**:

- Upload must be scanned and decoded/re-encoded before `security_status=approved`.
- Only approved assets can enter a build.
- Unity GUID/path are adapter metadata; logical entity relationship remains stable across path changes.
- Asset Store packages are excluded from MVP unless separately allowlisted with a documented redistribution/runtime license.

## Playtest and Evaluation

### PlaytestRun

| Field | Type | Rules |
|---|---|---|
| `id` | UUID | Primary key |
| `run_id` / `project_id` / `build_id?` | UUID | Correlated scope |
| `mode` | enum | `editor_playmode`, `web` |
| `seed` | bigint | Required for repeatability |
| `fixed_delta_time_ms` | integer | Positive |
| `status` | enum | `queued`, `running`, `passed`, `failed`, `infra_error`, `cancelled` |
| `action_plan` | jsonb | Validated protocol |
| `started_at` / `finished_at` | timestamptz? | Lifecycle |
| `environment_snapshot` | jsonb | Editor/browser/probe/template versions |

### PlaytestEvidence

`id`, `playtest_run_id`, `assertion_id`, `kind` (`state_sample`, `console`, `test_report`, `frame`, `video`, `browser`, `timing`), `sequence`, `timestamp_ms`, `summary`, `object_key?`, `payload_json?`, `content_hash`.

### EvaluationReport

`id`, `run_id`, `playtest_run_id`, `game_spec_version_id`, `evaluator_version`, `status` (`passed`, `failed`, `inconclusive`), `passed_count`, `failed_count`, `inconclusive_count`, `report_key`, `created_at`.

### EvaluationIssue

| Field | Type | Rules |
|---|---|---|
| `id` | UUID | Primary key |
| `evaluation_report_id` | UUID | Required |
| `issue_key` | text | Stable within report |
| `assertion_id` | text | Maps to Game Spec verification |
| `severity` | enum | `critical`, `high`, `medium`, `low` |
| `category` | enum | `compile`, `runtime`, `input`, `movement`, `physics`, `combat`, `progression`, `ui`, `build`, `infrastructure` |
| `description` | text | Human-readable |
| `expected` / `actual` | jsonb | Structured comparison |
| `evidence_ids` | UUID[] | At least one unless `infrastructure` |
| `affected_capabilities` | text[] | Used for impact analysis |
| `retryable` | boolean | Determines fix eligibility |
| `resolution_status` | enum | `open`, `fixed`, `accepted`, `unresolved` |
| `resolved_by_run_id` | UUID? | Required when fixed |

## Builds, Preview and Versioning

### Checkpoint

`id`, `project_id`, `game_spec_version_id`, `source_run_id`, `parent_checkpoint_id?`, `commit_ref`, `summary`, `change_manifest`, `status` (`creating`, `valid`, `invalid`, `restored`), `created_at`.

### Build

| Field | Type | Rules |
|---|---|---|
| `id` | UUID | Primary key |
| `project_id` / `checkpoint_id` / `spec_version_id` | UUID | Required and same project |
| `target` | enum | MVP `unity_web` |
| `status` | enum | `building`, `validating`, `ready`, `published`, `failed`, `superseded` |
| `engine_version` | text | Exact Unity Editor version |
| `adapter_version` | text | Exact platform adapter version |
| `template_version` | text | Exact Runner template version |
| `package_lock_hash` | text | Build provenance |
| `artifact_key` | text? | Required for ready/published |
| `content_hash` | text? | Content-addressed ID |
| `size_bytes` | bigint? | Quota/budget |
| `evaluation_report_id` | UUID? | Must be `passed` before publish |
| `build_log_key` | text? | Redacted log bundle |

### Preview

`id`, `project_id`, `build_id`, `status` (`provisioning`, `healthy`, `unhealthy`, `disabled`), `public_slug`, `origin`, `health_checked_at`, `published_at`, `expires_at?`.

**Invariant**: Only a `ready` build with passed EvaluationReport and successful Web smoke can transition to `published`. Preview URL contains build content hash so previous caches cannot shadow the selected build.

## Project State Aggregate

The durable Project State is reconstructed from:

```text
Project
├── current GameSpecVersion + version history
├── current TaskGraph + task/event history
├── Unity source repository + valid Checkpoints
├── Assets + AssetUsage
├── current Build + Preview + prior builds
├── PlaytestRuns + EvaluationReports + Issues
├── AgentSessions + Runs + model/tool/skill events
└── active/recoverable EditorLease metadata (never credentials)
```

Chat history is one input source, not the Project State authority.

## Database Tables and Indexes

Core tables: `users`, `projects`, `game_spec_versions`, `task_graphs`, `tasks`, `task_dependencies`, `agent_sessions`, `runs`, `run_events`, `model_calls`, `tool_invocations`, `skill_invocations`, `unity_workers`, `editor_licenses`, `editor_leases`, `assets`, `asset_usages`, `playtest_runs`, `playtest_evidence`, `evaluation_reports`, `evaluation_issues`, `checkpoints`, `builds`, `previews`.

Required indexes/constraints:

- Unique partial index: one active `game_spec_versions` row per project.
- Unique `(project_id, version_number)` and `(task_graph_id, task_key)`.
- Run queue index on `(status, created_at)` for `queued/waiting_for_engine`.
- Lease recovery index on `(status, lease_expires_at)` for runs/editor leases.
- Event primary key `(run_id, sequence)` and index `(project_id via run, occurred_at)` through partition/view.
- GIN indexes on `tasks.capabilities`, `evaluation_issues.affected_capabilities` and selected JSONB search fields.
- Unique build `content_hash`; unique active preview per project.
- Tenant row-level security or repository-enforced owner predicate on every project-scoped access, with integration tests proving both.

## Retention and Deletion Defaults

- Project source/spec/checkpoints/build metadata: retained until user deletion or policy expiry.
- Raw logs/screenshots/model traces: short-lived configurable retention; summaries and hashes retained for audit.
- License credentials: never stored in project tables or evidence; provider secrets reside in a dedicated secret manager.
- User deletion: mark project frozen, revoke previews, delete object data and repositories asynchronously with an auditable tombstone; shared licensed/open assets are reference-counted rather than blindly deleted.
