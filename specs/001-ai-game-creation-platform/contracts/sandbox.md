# Licensed Unity Sandbox Contract

## Purpose

定义 `SandboxProvider` 与 `LicensedSandboxScheduler` 的资源、进程、网络、workspace、Unity Editor/license 生命周期，保证项目隔离和合规容量不被绕过。

## Interfaces

```ts
interface LicensedSandboxScheduler {
  reserve(request: SandboxReservationRequest): Promise<SandboxReservation>;
  activate(reservationId: string): Promise<SandboxHandle>;
  renew(handleId: string, ttlSeconds: number): Promise<void>;
  cancel(handleId: string, reason: string): Promise<void>;
  release(handleId: string): Promise<SandboxReleaseResult>;
  reconcile(): Promise<ReconciliationReport>;
}
```

## Reservation Request

Required fields: `run_id`, `project_id`, exact Unity Editor/CLI/Pipeline versions, required capabilities (`web_build`, `playmode`, optional GPU), resource profile, maximum duration, workspace snapshot/checkpoint, package lock hash and idempotency key.

## State Machine

```text
requested → reserved → activating → active → returning → released
      └────→ waiting_for_license
reserved/activating/active/returning → quarantined
any non-terminal state → cancelled | expired
```

## Isolation Profile

- Ubuntu 22.04+ x86_64; exact Unity 6.0 LTS and Web Build Support installed in read-only base.
- Non-root project process where supported; user namespace/rootless runtime; no host Docker socket.
- Read-only root filesystem and Editor installation.
- Mounts:
  - `/workspace/project`: project-specific read/write checkout.
  - `/workspace/assets`: approved project assets, read-only staging.
  - `/workspace/build`: empty project-specific output.
  - `/workspace/tmp`: size-limited tmpfs.
  - `/cache/unity`: version/package-keyed cache; adapter controls writes and cannot expose another project's content.
- Initial limits: 4 vCPU, 8 GiB RAM, 20 GiB project+build disk, 128 PIDs, 20-minute wall clock. Phase 0 measurement may revise profile through versioned policy.
- `no-new-privileges`, drop Linux capabilities, seccomp/AppArmor, process-tree cgroup and explicit ulimits.
- Network `none` by default. Allowed package/object operations use preloaded artifacts or a fixed egress proxy with short-lived scoped credentials.

## Unity Process Rules

- CLI/Pipeline/Editor bridge binds loopback inside the worker namespace only.
- Only one active project Editor per MVP worker lease.
- Editor commands are issued through `UnityEngineAdapter`; model cannot invoke Unity binary or shell directly.
- Batchmode methods are restricted to signed platform bridge assemblies and fixed fully-qualified method names.
- On cancel/timeout, release input actions, stop Play Mode, request Editor exit, then kill the cgroup after grace period.
- `Library/` and process caches are disposable; Git source and committed object evidence are the recovery sources.

## License Rules

- Reservation requires an available `EditorLicense` entitlement and a `UnityWorker` satisfying the version/capability request.
- Active Editor leases must never exceed approved concurrency. Database constraint plus serialized scheduler transaction prevents overcommit.
- License credentials remain in secret manager/license broker; sandbox receives only the minimum ephemeral activation material required by the approved Unity workflow.
- Activation, health, return and failure create redacted audit events. Raw license files/tokens never enter project snapshots, logs or builds.
- Release completes only after Editor process quiescence and license return confirmation. Failure sets both worker and license/lease to `quarantined` for operator reconciliation.
- No design assumption treats free Unity CLI/MCP access as permission for unlimited Unity Editor instances.

## Workspace Fence

- Resolve every candidate path to an absolute canonical path within the worker, then prove it is under `/workspace/project`, `/workspace/build` or the specific allowed target.
- Reject `..`, absolute host paths, alternate drive/device paths, symlink/junction escape and writes through imported package links.
- Agent-generated project changes are limited to `Assets/`, selected `Packages/` manifests and allowlisted `ProjectSettings/` files.
- A pre-change checkpoint is required before destructive Unity commands or package changes.

## Release Result

```ts
type SandboxReleaseResult = {
  status: "released" | "quarantined";
  editorStopped: boolean;
  childProcessesStopped: boolean;
  licenseReturned: boolean;
  workspaceSealed: boolean;
  evidenceFlushed: boolean;
  cleanupErrors: Array<{ code: string; message: string }>;
};
```

## Required Security Tests

1. Cross-project absolute/relative/symlink path reads and writes are denied.
2. Outbound DNS/TCP/UDP is denied except the explicit proxy path.
3. Fork bomb, memory pressure, disk fill and timeout stay within limits and are cleaned.
4. Generated C# cannot read control-plane secrets or host files.
5. Cancel and Editor crash leave no orphan process or active license lease.
6. Concurrent reservations never exceed license entitlement.
7. A quarantined workspace/worker is never reassigned automatically.
8. Preview artifacts contain no project secrets, probe write capability or license material.
