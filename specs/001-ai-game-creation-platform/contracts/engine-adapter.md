# Engine Adapter Contract

## Purpose

保持 Game Spec、Planner、Skills、Playtest 和 Evaluation 与 Unity 解耦。MVP only implements `UnityEngineAdapter`.

## Interface

```ts
interface EngineAdapter {
  readonly engineType: string;
  readonly adapterVersion: string;

  discoverCapabilities(): Promise<EngineCapabilities>;
  inspectProject(project: ProjectRef): Promise<EngineProjectInfo>;
  execute(command: EngineCommand, ctx: EngineExecutionContext): Promise<EngineCommandResult>;
  compile(project: ProjectRef, ctx: EngineExecutionContext): Promise<CompileResult>;
  runTests(request: EngineTestRequest, ctx: EngineExecutionContext): Promise<EngineTestResult>;
  startPlayMode(request: PlayModeRequest, ctx: EngineExecutionContext): Promise<PlaySession>;
  stopPlayMode(sessionId: string, ctx: EngineExecutionContext): Promise<void>;
  buildWeb(request: WebBuildRequest, ctx: EngineExecutionContext): Promise<BuildArtifact>;
  cancel(operationId: string): Promise<void>;
}
```

## EngineCommand

```ts
type EngineCommand = {
  commandId: string;
  capability: string;
  safetyClass: "read_only" | "project_write" | "destructive" | "runtime" | "build";
  projectRef: string;
  expectedRevision?: string;
  arguments: Record<string, unknown>;
  timeoutMs: number;
};
```

## Required Capabilities for MVP

- Project: inspect project, package manifest and compile status.
- Scene: list/open/create/save scene.
- Entity: list/create/remove/reparent logical entity.
- Component: list/add/remove/set serialized property.
- Reusable object: create/update/instantiate prefab-equivalent.
- Script: create/read/write/attach engine script and compile.
- Runtime: enter/exit play mode, read errors/logs, capture frame.
- Test: run editor and player tests with machine-readable result.
- Build: create Web build with provenance and logs.

## Safety Rules

- Every command is authorized against the current Task capability list before adapter invocation.
- All paths are workspace-relative and canonicalized. Absolute paths, traversal and symlink escape are rejected.
- Destructive commands require a valid pre-change checkpoint and `expectedRevision`.
- `execute` never accepts raw shell text or arbitrary engine-language eval.
- Cancellation must terminate the adapter operation and its child process tree or return `ENGINE_CANCEL_PENDING`.
- Command result includes operation ID, changed files, warnings, structured errors, output revision, evidence refs and retryability.

## Result Envelope

```ts
type EngineCommandResult = {
  operationId: string;
  status: "succeeded" | "failed" | "cancelled";
  output?: unknown;
  changedFiles: string[];
  warnings: EngineDiagnostic[];
  errors: EngineDiagnostic[];
  evidenceRefs: string[];
  retryable: boolean;
  projectRevision?: string;
};
```

## Error Codes

`ENGINE_UNAVAILABLE`, `ENGINE_VERSION_MISMATCH`, `CAPABILITY_UNSUPPORTED`, `COMMAND_NOT_ALLOWED`, `WORKSPACE_ESCAPE`, `REVISION_CONFLICT`, `COMPILE_FAILED`, `TEST_FAILED`, `PLAYMODE_FAILED`, `BUILD_FAILED`, `ENGINE_TIMEOUT`, `ENGINE_CANCEL_PENDING`, `ENGINE_CRASHED`, `LICENSE_UNAVAILABLE`.

## Unity Mapping Boundary

The Unity adapter may map generic concepts as follows, but mappings never enter Game Spec:

| Generic | Unity |
|---|---|
| Scene | Scene asset (`.unity`) |
| Entity | GameObject |
| Component | Component / MonoBehaviour |
| Reusable object | Prefab |
| Script | C# MonoBehaviour or plain C# type |
| Runtime session | Editor Play Mode / Web Player |

## Contract Tests

- Capability discovery returns a versioned support matrix.
- Read/write/destructive commands enforce paths, revisions and checkpoint policy.
- CLI/Pipeline primary path and batchmode fallback normalize to identical results.
- Compile/test/build cancellation leaves no orphan Editor process.
- Adapter restart can reconcile in-flight operations from process/lease state.
- Unity-specific types do not leak into planner or domain serialization.
