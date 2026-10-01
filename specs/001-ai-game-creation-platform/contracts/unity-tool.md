# Unity Tool Contract

## Architecture

```text
Game Skill
  → GameToolGateway (authorization, schema, path/revision fence)
    → UnityEngineAdapter
      → Unity CLI command/mcp + Unity Pipeline
      → Unity Editor batchmode fallback for compile/test/build
```

The model never receives raw `unity eval`, unrestricted shell, license operations, host paths or direct Pipeline transport details.

## Common Request

Every tool request contains:

```json
{
  "schema_version": "1.0.0",
  "operation_id": "uuid",
  "run_id": "uuid",
  "task_id": "uuid",
  "project_ref": "opaque",
  "expected_revision": "git-or-adapter-revision",
  "timeout_ms": 30000,
  "arguments": {}
}
```

Every response uses the `EngineCommandResult` envelope from `engine-adapter.md`.

## MVP Tools

| Tool | Safety | Required Output |
|---|---|---|
| `unity.health` | read_only | CLI/Editor/Pipeline/license status and versions |
| `unity.capabilities` | read_only | Registered command names, schemas and adapter support |
| `unity.project.inspect` | read_only | Unity version, packages, scenes, compile status, template provenance |
| `unity.scene.list` | read_only | Logical ID, workspace-relative asset path, enabled/build status |
| `unity.scene.inspect` | read_only | Hierarchy, components and serialized values |
| `unity.scene.create` | project_write | New scene logical ID/path and revision |
| `unity.scene.open` | runtime | Active scene result |
| `unity.scene.save` | project_write | Saved path/hash/revision |
| `unity.game_object.create` | project_write | Logical entity ID and adapter object reference |
| `unity.game_object.remove` | destructive | Removed object and affected refs |
| `unity.game_object.reparent` | project_write | New hierarchy and revision |
| `unity.component.list` | read_only | Component types and safe serialized fields |
| `unity.component.add` | project_write | Component reference and defaults |
| `unity.component.remove` | destructive | Removed component and dependencies |
| `unity.component.set_property` | project_write | Previous/current normalized value |
| `unity.prefab.create` | project_write | Prefab path/GUID and source object |
| `unity.prefab.instantiate` | project_write | Instance logical ID and scene path |
| `unity.script.read` | read_only | Workspace-relative path, hash, bounded source |
| `unity.script.write` | project_write | Changed path/hash plus compile-required marker |
| `unity.script.attach` | project_write | Object/component link |
| `unity.compile` | runtime | Compiler diagnostics and assembly status |
| `unity.console.read` | read_only | Redacted bounded logs with severity and timestamps |
| `unity.test.run` | runtime | EditMode/PlayMode NUnit result and evidence key |
| `unity.play.start` | runtime | Play session ID, probe connection status |
| `unity.play.stop` | runtime | Stop reason and process cleanup status |
| `unity.frame.capture` | runtime | Image evidence reference and frame metadata |
| `unity.web.build` | build | Artifact manifest, provenance, content hash and log ref |

## Unity CLI Policy

- `unity command`/`unity mcp` can invoke only Pipeline commands registered in the adapter support manifest.
- CLI `list/status/doctor` is read-only and used for discovery/health.
- `unity build/run/test` runs only with platform-generated arguments.
- Editor batchmode `-executeMethod` accepts only fully-qualified static methods shipped in signed `com.gamerhub.agent-bridge`; user/generated method names are rejected.
- `unity eval` and raw arbitrary shell are disabled in production.
- License activation/return is owned by `LicensedSandboxScheduler`, never exposed as a model tool.

## Path and Object Rules

- Paths must be relative to project root and under `Assets/`, `Packages/manifest.json`, `Packages/packages-lock.json` or allowlisted `ProjectSettings/` locations.
- Writes to `Library/`, editor installation, user profile or parent directories are rejected.
- Object references returned by the adapter are opaque and scoped to project revision; stale refs return `REVISION_CONFLICT`.
- Serialized property changes are schema/type checked against the live component and reject unsupported managed references.
- Asset import completion and compilation must settle before a dependent task runs.

## Retry Rules

- Read-only transient transport failure: retry up to 2 with jitter.
- Project write with unknown commit status: inspect operation/project revision before retry; never blindly duplicate.
- Compiler/test failure caused by project content: non-transient, return evidence to Evaluator/Fix Planner.
- Editor/CLI crash: quarantine worker, reconcile Git/workspace, then retry on a fresh worker if Run budget permits.
