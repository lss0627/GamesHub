# Implementation Plan: AI 原生游戏创作平台 MVP（Unity）

**Branch**: `001-ai-game-creation-platform` | **Date**: 2026-08-30 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/001-ai-game-creation-platform/spec.md`，以及 2026-08-30 用户补充的 Unity 6 / Unity CLI 引擎替换说明。

## Summary

构建一个面向非程序员的 AI 游戏创作平台：用户以自然语言描述 2D 游戏，平台先持久化引擎无关的 Game Spec，再生成依赖任务图，通过可替换 Agent Runtime 执行受控的高层 Game Skills；Unity Engine Adapter 将这些技能转换为 Unity 6.0 LTS 的 Scene、GameObject、Component、Prefab 与 C# 操作，在隔离且受许可证控制的执行环境中完成编译、运行、Playtest、Evaluation、最多 5 次局部自修复、Unity Web 构建预览和后续自然语言局部修改。

MVP 使用 TypeScript 模块化单体加独立执行 Worker。默认 Harness 候选为 DeepSeek Harness，但只允许通过自有 `AgentRuntime` 适配器接入，并在 Phase 0 与 Pi 跑同一套契约。引擎侧优先复用 Unity CLI + Unity Pipeline；由于 Unity CLI 仍为 experimental，`UnityEngineAdapter` 必须保留 Unity Editor `-batchmode/-executeMethod/-runTests` 兜底。商业上线前必须通过 Unity 组织层级、并发 Editor/Build Server 和云端 SaaS 使用场景的许可证 Gate。

## Technical Context

**Language/Version**: TypeScript 5.x on Node.js 24 LTS；Unity 6.0 LTS `6000.0.80f1` 所支持的 C# scripting profile；SQL migrations for PostgreSQL 18

**Primary Dependencies**: Next.js 16.2 LTS、Fastify、Zod/JSON Schema、PostgreSQL driver/migrations、S3-compatible SDK、DeepSeek Harness adapter、Pi adapter、Unity CLI + Unity Pipeline、Unity Test Framework、Playwright、OpenTelemetry、Pino

**Storage**: PostgreSQL 18 保存业务状态、任务、事件和 worker/editor leases；S3-compatible object storage 保存素材、截图、日志包与不可变 Unity Web builds；每项目 Git 仓库和 Unity workspace 位于受限卷；Unity package/import cache 与项目状态隔离

**Testing**: Vitest 单元/契约测试、Testcontainers 集成测试、Unity EditMode/PlayMode tests、Unity batchmode compile/build smoke、C# runtime probe 场景测试、Playwright Web E2E、固定种子 golden project 和故障注入测试

**Target Platform**: Ubuntu 22.04+ x86_64 licensed Unity workers；现代桌面 Chromium/Firefox/Safari；WebAssembly/WebGL Unity Web builds

**Project Type**: TypeScript monorepo web platform with three deployables (`studio-web`, `platform-api`, `orchestrator-worker`) and a licensed sandboxed Unity execution pool

**Performance Goals**: 进度事件 p95 在 2 秒内可见；固定跑酷场景首次生成至可试玩不超过 15 分钟；局部参数修改至新预览不超过 5 分钟；95% preview loads 在 10 秒内可操作

**Constraints**: 默认 UI 不暴露代码、终端或文件树；每请求最多 5 次自修复；build 内容寻址且不可变；Unity Editor/CLI 版本、packages 和 Web build module 全部锁定；单个执行环境初始上限 4 vCPU、8 GiB RAM、20 GiB workspace、128 PIDs、20 分钟 wall-clock（Phase 0 后校准）；并发不得超过已授权 editor/build-worker capacity；游戏代码和工具输入均视为不可信；暂停只在不可中断的 Unity 操作结束后生效，进入 `paused` 前必须持久化恢复点并释放 editor/license lease

**Scale/Scope**: 首发只保证一个 Unity 2D Runner 垂直切片；受控 beta 目标 100 用户、1,000 持久项目；并发上限由 Phase 0 验证后的许可证池和资源容量共同决定，不把 Godot/Unreal 或通用 3D 纳入 MVP

## Constitution Check

`.specify/memory/constitution.md` 已由项目所有者于 2026-08-30 授权受控实施并完成版本化记录。商业 Unity SaaS 的组织/法务确认仍是生产 Beta 的独立 Gate，不能由工程实现替代。

| Gate | Status | Exit Evidence |
|---|---|---|
| 项目 Constitution 已批准 | PASS（受控实施） | `.specify/memory/constitution.md` 记录 1.0.0、批准日期、修订规则与强制质量 Gate |
| 复用基础设施，不自研引擎/通用 Harness/完整 Editor 自动化平台 | PROVISIONAL PASS | Unity、Unity CLI/Pipeline/Test Framework、DeepSeek/Pi、Git、容器均复用 |
| 模型、Harness、引擎不强耦合 | PROVISIONAL PASS | `ModelProvider`、`AgentRuntime`、`EngineAdapter` 独立契约；MVP 只实现 Unity adapter |
| 普通用户只看聊天、进度与预览 | PROVISIONAL PASS | Web API 不暴露 Unity/C#/文件/工具细节；Developer View 独立授权 |
| 必须 Run → Playtest → Evaluate | PROVISIONAL PASS | 发布状态机禁止绕过 playtest/evaluation gate |
| 修改优先局部执行 | PROVISIONAL PASS | Game Spec semantic diff → impact set → scoped task graph → targeted regression |
| 成功率优先于自由度 | PROVISIONAL PASS | Unity Runner template + 固定 Game Skills + allowlisted commands/components |
| 不可信执行必须隔离 | PROVISIONAL PASS | 控制面与 licensed Unity worker 分离，项目级 workspace fence |
| Unity 许可先于规模化 | CONDITIONAL | `docs/adr/0001-unity-licensing-gate.md` 记录受控实施 GO、1 个 fixture/local worker、复核日期与商业 Beta NO-GO 条件 |

受控实施可以继续；商业 Beta/规模化容量必须在 ADR-0001 的外部 Unity 条款与法务记录完成后开启。

## System Architecture

```text
Browser
  └─ Studio Web (chat / progress / preview / versions)
       └─ Platform API + SSE
            ├─ Project / Spec / Asset / Version services
            ├─ Game Orchestrator + durable Run Queue
            │    └─ Orchestrator Worker
            │         ├─ AgentRuntime ─ DeepSeekAdapter | PiAdapter
            │         ├─ ModelProvider ─ provider adapters / routing
            │         ├─ GamePlanner ─ Game Spec diff → Task Graph
            │         ├─ GameSkillRegistry
            │         └─ Licensed Sandbox Scheduler
            │              └─ Per-run Unity workspace
            │                   ├─ UnityEngineAdapter
            │                   │    ├─ Unity CLI command/mcp
            │                   │    └─ Unity Editor batchmode fallback
            │                   ├─ Unity Pipeline editor package
            │                   ├─ Unity Playtest Probe (C#)
            │                   ├─ Unity Test Framework
            │                   └─ Git workspace / Unity Web build
            ├─ PostgreSQL (state + events + leases + license inventory)
            └─ Object Storage (assets + evidence + immutable builds)

Preview static origin → sandboxed iframe in Studio Web
OpenTelemetry Collector ← API / Worker / Unity event bridge
```

### Primary Execution Flow

1. API 接收用户意图，创建 `Run` 并持久化不可变输入事件。
2. Orchestrator 读取当前 `GameSpecVersion`；新项目生成完整规格，修改项目生成 semantic diff。
3. Planner 输出无环 `TaskGraph`，每个任务附验证方法、engine capability 和影响范围。
4. Worker 获取 Run lease，再由 `LicensedSandboxScheduler` 获取 editor/license lease，创建隔离项目 workspace。
5. AgentRuntime 加载引擎无关的 Skills；`UnityEngineAdapter` 把技能操作映射为 Unity CLI/Pipeline 的结构化 Editor commands。CLI/MCP 不可用时，只能走 allowlisted batchmode commands，不允许任意 `eval`。
6. 重大修改前创建 Git checkpoint；Unity Test/Compiler/batchmode 执行编译与 EditMode/PlayMode checks。
7. Unity Playtest Probe 在 Play Mode 提供输入、实体和场景状态；Playwright 对最终 Web build 做 canvas 输入、浏览器 console、画面和加载验证。
8. Evaluator 对照 Game Spec assertions 生成结构化问题；失败时 Fix Planner 只创建局部修复任务并重跑 targeted tests + smoke regressions，最多 5 次。
9. 通过后生成内容寻址 Unity Web build，发布 Preview 并通过 SSE 推送完成状态。
10. 用户请求暂停时，Worker 等待当前不可中断 Unity 操作结束，写入恢复点，停止 Play Mode、归还 editor/license lease 并将 Run 置为 `paused`；恢复时重新获取 lease 并从持久状态继续。Run 结束或取消时封存证据并清理临时进程和 workspace。

## Module Boundaries

| Module | Responsibility | Must Not Own |
|---|---|---|
| `studio-web` | Chat、进度、Unity Web preview、assets、versions、受控 Developer View | Agent loop、Unity project 写入 |
| `platform-api` | 身份/授权、项目 API、SSE、upload/build URL policy | 长时执行、直接启动 Unity |
| `orchestrator-worker` | Run lease、状态机、重试、自修复预算、执行编排 | Harness/Unity 厂商语义 |
| `domain` | Project、Spec、Task、Run、Build 等领域类型和不变量 | I/O、Unity/模型 SDK |
| `agent-runtime` | session/task/tool/skill/event/state/context 统一端口及 adapters | 游戏业务和 Unity 类型 |
| `model-provider` | messages、stream、tool calls、usage、cancel、capabilities、routing | Project 状态 |
| `game-spec` | 引擎无关 schema、version、semantic diff、validation/migration | Scene/Prefab 生成 |
| `game-planner` | Game Spec → DAG、impact analysis、局部任务和 verification mapping | 直接调用引擎 |
| `game-skills` | `create_platformer_player` 等高层能力、模板编排、结构化结果 | 直接依赖 Unity CLI schema |
| `engine-adapter` | 引擎通用 capability、scene/object/component/build/test/play lifecycle | Unity implementation details |
| `unity-adapter` | Unity CLI/Pipeline/batchmode、Scene/GameObject/Component/Prefab/C# 映射、错误归一化 | 用户权限和发布决策 |
| `unity-playtest-probe` | Play Mode input、state、time、entity/collision/animation observation | 平台凭据和外网 |
| `playtest` | 生成并执行动作时间线、采集结构化和视觉证据 | 修改 C# 或 assets |
| `evaluator` | assertions 对证据判定、issue 分级 | 直接修复项目 |
| `assets` | 素材来源/许可/上传校验/Unity import profile/引用 | 任意 Asset Store 下载 |
| `versioning` | Checkpoint、diff、rollback、恢复验证 | 向普通用户暴露 Git |
| `sandbox` | workspace、进程/资源/网络策略、editor/license lease、清理 | Agent 推理 |
| `observability` | events、traces、metrics、audit correlation、redaction | 取代用户可见 Run 状态机 |

## Core Interfaces

```ts
interface AgentRuntime {
  createSession(input: CreateSessionInput): Promise<AgentSession>;
  runTask(input: RunAgentTaskInput): AsyncIterable<AgentEvent>;
  pauseTask(runId: string, reason: string): Promise<PauseResult>;
  resumeTask(runId: string): AsyncIterable<AgentEvent>;
  cancelTask(runId: string, reason: string): Promise<void>;
  registerTool(tool: RuntimeTool): void;
  registerSkill(skill: RuntimeSkill): void;
  getState(runId: string): Promise<AgentState>;
  getContext(runId: string): Promise<AgentContext>;
}

interface EngineAdapter {
  discoverCapabilities(): Promise<EngineCapabilities>;
  inspectProject(project: ProjectRef): Promise<EngineProjectInfo>;
  execute(command: EngineCommand): Promise<EngineCommandResult>;
  compile(project: ProjectRef): Promise<CompileResult>;
  runTests(request: EngineTestRequest): Promise<EngineTestResult>;
  startPlayMode(request: PlayModeRequest): Promise<PlaySession>;
  stopPlayMode(sessionId: string): Promise<void>;
  buildWeb(request: WebBuildRequest): Promise<BuildArtifact>;
}
```

完整契约见 [`contracts/`](contracts/)。领域层只能引用上述抽象，`UnityEngineAdapter` 才能引用 Scene、GameObject、Component、Prefab、MonoBehaviour 等类型。

## State Machines

### Run

```text
queued → planning → waiting_for_engine → executing → playtesting → evaluating
                                  ↑                         │
                                  └──── fixing ← failed_fixable

evaluating → succeeded | partially_succeeded | failed | cancelled | timed_out
planning | waiting_for_engine | executing | playtesting | evaluating | fixing
    → pause_requested → paused → waiting_for_engine
```

`pause_requested` 不打断正在提交的 Unity 写操作、编译、测试或构建；系统在该操作产生可审计结果后建立恢复点并释放独占资源。`cancelled` 为终态，`paused` 为可恢复非终态。

### Task

```text
pending → running → completed
             ├──→ blocked → pending
             └──→ failed  → pending (retry budget remains)
```

### Editor Lease

```text
available → reserved → activating → active → returning → available
                         └────────→ quarantined
```

### Build / Preview

```text
building → validating → ready → published → superseded
    └──────────────→ failed
```

## Unity Tool Strategy

- 首选 `unity command` 调用 Unity Pipeline 注册的结构化命令；需要 MCP 客户端协议时由 `unity mcp` 提供同一能力。
- `unity list/status/doctor` 用于 capability discovery 和健康检查；所有 command schema 在 worker 启动时快照并与支持矩阵比对。
- `unity build/run/test` 与 Editor `-batchmode -quit -projectPath -logFile -executeMethod/-runTests` 是 headless build/test 兜底。
- `unity eval` 默认禁用，因为任意 Editor 代码执行会绕过工具 allowlist；仅允许平台签名、固定 hash 的维护命令。
- 首批 engine commands：inspect project/scene、create/open/save scene、create/remove GameObject、add/remove component、set serialized property、create/update prefab、create/attach/read/write C# script、compile、read console、enter/exit Play Mode、capture frame、run tests、build Web。
- 每条命令声明 `read_only | project_write | destructive | runtime | build` 安全级别；路径必须 canonicalize 到当前 workspace，destructive 需要 Task capability 和 pre-checkpoint。
- Unity package manifest、Editor version、CLI/Pipeline version 和 template revision 全部进入 build provenance。

## Playtest and Evaluation Design

- Game Spec 中每条可验证需求编译为 `assertion_id`：前置状态、输入时间线、观察窗口、结构化谓词、视觉补充和 severity。
- Unity C# probe 提供 `press/release/move/jump/shoot/click/wait/restart/freeze/advance_time`，以及 scene、GameObject/component、position、health、enemy_count、score、collision 和 animation state。
- 证据优先级：Probe state > Unity Test/Compiler/Console > deterministic action outcome > screenshot/vision。视觉模型不得单独证明伤害、碰撞或数值状态转换。
- Play Mode 使用固定 random seed、fixed timestep 和可控制 time scale；Web 端通过受限 `.jslib`/JavaScript bridge 暴露只读 test state，生产构建关闭该桥。
- Evaluator 只读证据，输出 `EvaluationReport`；Fix Planner 使用 issue、变更历史和 impact set 创建局部任务，避免实现者自行宣告成功。
- Runner baseline：左右移动、跳跃/落地、障碍不可穿越、金币拾取与分数、跌落/碰撞死亡、重开、Unity Web load/input。

## Security, Sandbox and Licensing Design

- API/Worker 控制面与 Unity worker 分离；模型和对象存储长期凭据不进入项目 workspace。
- 每次 Run 使用项目专属工作副本和受限 non-root container/VM；read-only base image，只开放 project/build/tmp/cache mounts。
- 默认禁用外网；Unity Package Manager 依赖必须预锁定并进入镜像或内部只读 registry/cache。必要下载使用固定 egress allowlist。
- 启用 user namespace/rootless runtime、`no-new-privileges`、drop capabilities、seccomp/AppArmor、CPU/RAM/PID/disk/time limits；Unity Editor GUI/IPC 仅绑定本机命名空间。
- Unity CLI/Pipeline localhost server 不向公网暴露；Editor command 通过 adapter allowlist 和 workspace fence。取消/超时必须终止完整 Editor 子进程树；暂停必须在安全边界停止 Play Mode、封存证据并释放 editor/license lease，不允许长期占用许可容量。
- 上传素材先在控制面隔离扫描、解码重写、配额/类型/许可校验，再以只读方式挂载。
- Preview 使用独立 origin、严格 CSP、sandboxed iframe、无平台 cookie、正确 `.wasm/.data/.js` MIME 和 compression headers。
- `EditorLicense` 与 `EditorLease` 单独建模；worker 只拿短期 lease，不把 license secret 写入日志、项目或 build。归还失败的 worker 进入 quarantine。
- Phase 0 必须由 Unity 商务/法律或合格律师书面确认 SaaS 云端 Editor、Build Server、seat、组织收入和用户生成项目的适用方式；本计划中的 Personal/Pro threshold 信息不构成法律意见。

## API and Contract Artifacts

- REST/SSE: [`contracts/openapi.yaml`](contracts/openapi.yaml)
- Runtime/model/engine seams: [`contracts/agent-runtime.md`](contracts/agent-runtime.md), [`contracts/model-provider.md`](contracts/model-provider.md), [`contracts/engine-adapter.md`](contracts/engine-adapter.md)
- Domain schemas: [`contracts/game-spec.schema.json`](contracts/game-spec.schema.json), [`contracts/task-graph.schema.json`](contracts/task-graph.schema.json), [`contracts/evaluation.schema.json`](contracts/evaluation.schema.json)
- Execution: [`contracts/game-skill.md`](contracts/game-skill.md), [`contracts/unity-tool.md`](contracts/unity-tool.md), [`contracts/playtest-protocol.md`](contracts/playtest-protocol.md)
- Realtime/sandbox: [`contracts/events.md`](contracts/events.md), [`contracts/sandbox.md`](contracts/sandbox.md)

FR-019 的暂停语义要求在实施前同步更新 `contracts/agent-runtime.md`、`contracts/openapi.yaml`、`contracts/events.md` 和 Run schema；对应契约变更与失败测试由 Foundational 任务 T013 负责。

## MVP Roadmap

| Phase | Goal | Technical Work | Deliverables | Acceptance Criteria |
|---|---|---|---|---|
| 0 — Harness + Unity Tool PoC | 消除 Harness、CLI、Editor、license 不确定性 | DeepSeek/Pi contract tests；锁定 Unity 6.0 LTS/CLI/Pipeline；验证 command/mcp/batchmode/test/Web build；license/legal review；sandbox escape tests | ADR、adapter spike、license memo、tool support matrix、golden Unity project | 至少一种 Harness 可 create/pause/resume/cancel/stream；Unity 可结构化改 Scene/GameObject/Component、编译、Play、读状态、测试、Web build；固定命令集连续 100 个隔离循环成功率≥95%；CLI 故障能 batchmode fallback；Constitution 与许可证 Gate 均有书面批准 |
| 1 — Prompt → Simple Unity Game | 完成无自修复 Runner 垂直切片 | Studio chat/progress；Unity runner template；player/coin/obstacle/game-over Skills；project create/build；手工 preview | 可生成 Unity Runner、基础 UI、事件流 | 固定 prompt 运行 10 个不复用项目文件、规格或构建产物的全新项目，至少 8 次在 15 分钟内生成可启动且核心规则通过的 preview；主流程不接触 C# 或 Editor |
| 2 — Game Spec + Planner | 建立长期期望状态与 DAG | Engine-neutral Game Spec/version/diff；Planner；Task lifecycle；Project state | 可审计 spec、task graph、状态 UI | 所有写入关联 spec/task；DAG 无环且每任务有验证；中断可恢复 |
| 3 — Automated Playtest | 真正操作并观察 Unity 游戏 | C# probe；action protocol；fixed seed/time；Edit/PlayMode tests；Web smoke/evidence | 可复现 PlaytestRun 和 evidence bundle | Runner 7 类核心检查可重复；相同 build 50 次 false result <2%；infra/game failure 可区分 |
| 4 — Evaluation + Self Fix | 形成有界质量闭环 | assertion compiler；Evaluator；issue taxonomy；Fix Planner；5 次 loop；targeted regression；人工参考集一致率基准 | EvaluationReport、fix history、partial-success UX、冻结的人工作为参考的数据集 | 至少 60 个冻结样本上与双人独立复核、第三人仲裁形成的人工参考结论一致率≥90%；超限必停止并诚实报告；无基准回归 |
| 5 — Unity Web Preview | 稳定发布浏览器试玩 | Unity Web build profile；object storage/CDN；immutable build；headers/cache/iframe isolation；browser matrix | Preview URL、build provenance、发布状态机 | 目标浏览器 95% 在 10 秒内可操作；旧缓存不覆盖新 build |
| 6 — Natural-language Iteration | 局部持续修改和撤销 | intent classification；spec diff；impact analysis；targeted Unity tests；checkpoint/rollback | 已支持跑酷能力的参数与配置修改、Versions UI | “跳得太高”90% 在 5 分钟内刷新且回归通过；新增 Boss 等玩法请求明确拒绝且不损坏当前版本；rollback 60 秒内完成 |
| 7 — Multi-user + Licensed Sandbox | 从单机验证走向受控 beta | Auth/RBAC；licensed worker pool；quotas；lease/reaper；audit/telemetry；backup；license capacity alerts | 多租户 beta、运营 runbook、license dashboard | 在已授权并发内无跨项目访问；取消/超时无孤儿 Editor；失败链可追踪率≥95%；license overcommit 为 0 |

**Complexity estimate**: Unity 版总体复杂度为高。Phase 0–6 约 34–48 engineering-weeks，5–7 人跨职能团队应按 6–8 个自然月规划；Unity CLI experimental 稳定性、首次导入/构建时延和云端 Editor 许可可能显著扩大区间。Phase 7 生产硬化另需约 14–20 engineering-weeks。Phase 0 是正式 go/no-go gate，不是可跳过的准备工作；当前 Constitution 对受控实施已批准，商业/规模化 Unity 许可证 Gate 仍为 NO-GO，直到外部记录完成。

## Project Structure

### Documentation (this feature)

```text
specs/001-ai-game-creation-platform/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── openapi.yaml
│   ├── agent-runtime.md
│   ├── model-provider.md
│   ├── engine-adapter.md
│   ├── game-spec.schema.json
│   ├── task-graph.schema.json
│   ├── game-skill.md
│   ├── unity-tool.md
│   ├── playtest-protocol.md
│   ├── evaluation.schema.json
│   ├── events.md
│   └── sandbox.md
└── tasks.md
```

### Source Code (repository root)

```text
apps/
├── studio-web/src/{app,components,features,lib}/
├── platform-api/src/{routes,services,middleware,streaming}/
└── orchestrator-worker/src/{jobs,workflows,leases}/

packages/
├── contracts/src/
├── domain/src/
├── agent-runtime/src/{ports,adapters}/
├── model-provider/src/{ports,adapters,routing}/
├── game-spec/src/
├── game-planner/src/
├── game-skills/src/{registry,runner}/
├── engine-adapter/src/
├── unity-adapter/src/{cli,pipeline,batchmode,commands}/
├── playtest/src/
├── evaluator/src/
├── assets/src/
├── versioning/src/
├── sandbox/src/{scheduler,licenses,workspaces}/
└── observability/src/

unity/
├── Packages/com.gamerhub.agent-bridge/{Editor,Runtime,Tests}/
├── Packages/com.gamerhub.playtest-probe/{Runtime,Tests}/
└── Templates/Runner/Assets/{Game,Prefabs,Scenes,Scripts,Tests}/

infra/{docker,compose,otel,migrations,unity-workers}/
tests/{contract,integration,e2e,fixtures,security}/
```

**Structure Decision**: 使用 pnpm workspace 的 TypeScript 模块化单体，只有 Web、API、Worker 三个控制面进程；Unity Editor packages 和 game template 独立放在 `unity/`。厂商类型仅存在于 `unity-adapter` 和 Unity packages，保证未来增加 Godot adapter 时不迁移 Game Spec、Planner 或 API。

## Post-Design Constitution Check

| Gate | Post-Design | Evidence |
|---|---|---|
| 复用基础设施 | PASS | 自研限定为游戏领域模块、Unity adapter/probe 和产品控制面 |
| 可替换底座 | PASS | Harness、model、engine vendor types 均被 ports/adapters 隔离 |
| 小白体验 | PASS | 内部 Unity/Agent events 投影为用户可理解的 progress |
| 运行验证闭环 | PASS | Preview 发布依赖 EvaluationReport 和 Web smoke 通过 |
| 局部修改 | PASS | Spec diff、impact analysis、targeted Unity tests 已是主流程 |
| 成功率优先 | PASS | 单 Runner、固定 template、curated packages 和 command allowlist |
| 隔离执行 | PASS | Licensed worker pool、project workspace fence 和 cleanup state machine |
| 许可 Gate | PASS | Roadmap、data model、sandbox contract 和 tasks 均包含 license lease/审查 |

## Complexity Tracking

| Decision | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| 三个 deployables + 内部 packages | Web/API/Unity 长任务生命周期不同，同时需保持可替换领域边界 | 单进程会让 Editor crash 影响 API；微服务会增加 MVP 运维成本 |
| Unity CLI/Pipeline + batchmode 双路径 | 官方 CLI 更适合 Agent，但仍 experimental | 只依赖 CLI 会放大 breaking risk；只用 batchmode 交互上下文和效率不足 |
| Probe + Unity tests + Web Playwright 三层验证 | 逻辑、Editor/Player 和最终浏览器各有不同故障面 | 单一通道无法区分编译、玩法与部署错误 |
| PostgreSQL + object storage + Git workspace | durable state、large artifacts、file checkpoint 数据性质不同 | 只用聊天、文件目录或 Git 均无法满足恢复、查询和发布 |
| Licensed worker pool | Unity 要求每个并发 build machine/editor 使用合适 license | 把 Editor 当作可无限水平扩容的无状态容器有合规风险 |
