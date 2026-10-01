# Research: AI 原生游戏创作平台 MVP（Unity）

**Date verified**: 2026-08-30

## Executive Assessment

在“Unity 2D Runner 垂直切片、模板和 Game Skills 优先、逻辑正确性优先于自由创作”的边界内，产品技术可行。Unity 的 Scene/GameObject/Component/Prefab/C# 模型、Test Framework、Web build 和新的官方 CLI/Pipeline 能降低 Editor 自动化成本；但 Unity CLI 仍为 experimental，Unity Editor 更重，且云端并发实例受许可证与 build-machine 约束。相比原 Godot 方案，Game Spec、Planner、Task Graph、Agent Runtime、Evaluation 和 Self-Fix 基本不变，风险主要转移到 Unity 工具稳定性、项目导入/构建时延和商业许可。

## Decision 1 — Control Plane Language and Shape

**Decision**: 使用 Node.js 24 LTS + TypeScript 5.x 的 pnpm monorepo；Next.js 16.2 LTS 负责 Studio，Fastify API 与独立 Worker 负责控制面。首版采用模块化单体和 PostgreSQL durable queue，不拆微服务。

**Rationale**: DeepSeek Harness、Pi 和控制面 SDK 均以 TypeScript/Node 为自然集成面，前后端可共享 Zod/JSON Schema。独立 Worker 隔离 Unity/Agent 长任务，同时单仓库 packages 减少协议漂移。

**Alternatives considered**:

- Python backend：成熟但需要给 TypeScript Harness/CLI 增加跨进程桥接和重复 schema。
- 全部运行在 Next.js：Unity Editor 和 Agent loop 不适合 HTTP request 生命周期。
- 立即拆微服务：会在 MVP 前增加部署、一致性和追踪成本。

**Sources**: [Node.js releases](https://nodejs.org/en/about/previous-releases), [Next.js release blog](https://nextjs.org/blog)

## Decision 2 — Unity Version

**Decision**: MVP 锁定 Unity 6.0 LTS `6000.0.80f1`、对应 Web Build Support module、固定 package lock 和固定 Runner template revision。升级只在独立 compatibility branch 通过完整 contract/golden suite 后进行。

**Rationale**: 6.0 LTS 更适合长期平台稳定性，`6000.0.80f1` 是 2026-07-22 发布的维护版本；Unity CLI/Pipeline 驱动 Editor 要求 Unity 6.0 LTS 或更高。较新的 6000.5 stream 提供更多功能但不是 MVP 稳定性优先选择。

**Alternatives considered**:

- 使用 `latest` alias：不可重复，CLI/Editor/package 行为可能在无审查下变化。
- 使用 6000.5 Tech Stream：功能更新快，但兼容性和回归成本更高。
- 继续使用 Godot：许可证和资源占用更简单，但用户已明确选择 Unity，且长期生态目标更偏向 Unity。

**Sources**: [Unity 6000.0.80f1 release](https://unity.com/releases/editor/whats-new/6000.0.80f1), [Unity download archive](https://unity.com/releases/editor/archive)

## Decision 3 — Unity CLI/Pipeline with Batchmode Fallback

**Decision**: `UnityEngineAdapter` 优先通过 Unity CLI 的 `command/list/status/mcp` 和 Unity Pipeline package 驱动已连接 Editor；通过 `build/run/test` 处理 CI-friendly jobs。所有稳定检查还必须有 Unity Editor `-batchmode -projectPath -quit -logFile -executeMethod/-runTests` 兜底。`unity eval` 默认禁用。

**Rationale**: Unity 官方已用 CLI 中的 `unity mcp` 替换旧 in-Editor MCP server；CLI 还能直接转发 Editor commands，并原生提供 build/run/test。官方同时明确 CLI 仍为 experimental，因此需要 adapter、version pinning、schema snapshot 和 fallback。任意 eval 会绕过 allowlist，不适合多租户 Agent。

**Alternatives considered**:

- 自研完整 Unity MCP：重复官方 CLI/Pipeline 的基础设施。
- 只依赖 Unity CLI：experimental breaking risk 不可控。
- 只用 batchmode：适合 build/test，但频繁启动 Editor、上下文发现和交互式修改效率较低。
- 第三方 Unity MCP：只作为 Phase 0 应急对照，不作为默认生产依赖。

**Sources**: [Unity CLI replaces in-Editor MCP](https://docs.unity.com/en-us/unity-cli/replace-mcp-server-unity-cli), [Unity CLI usage](https://docs.unity.com/en-us/unity-cli/use-unity-cli), [Unity CLI reference](https://docs.unity.com/en-us/unity-cli/unity-cli-reference), [Unity command-line builds](https://docs.unity3d.com/6000.0/Documentation/Manual/build-command-line.html)

## Decision 4 — Harness: DeepSeek Default with Mandatory Pi Exit Path

**Decision**: 实现 `DeepSeekHarnessAdapter` 和最小 `PiRuntimeAdapter`，跑同一 `AgentRuntime` contract tests。DeepSeek 只有在 session durability、resume/cancel、event ordering、tool policy、crash recovery 和 pinned upgrade rehearsal 全部通过后才是默认；否则使用 Pi。

**Rationale**: DeepSeek Harness 的 plugin architecture、event-sourced session、agent loop、LLM seam 和 tool registry 更接近本平台需要，但官方仍标记 developer preview，npm 仍是 RC。Pi 提供 multi-provider LLM、tool calling 和 state management，集成面更薄；官方明确其不提供 filesystem/process/network/credential permission system，因此同样必须放入外部 sandbox。

**Alternatives considered**:

- 只选 DeepSeek：功能匹配高但 RC breaking risk 过大。
- 只选 Pi：更薄，但平台需更早自研 durable event/session orchestration。
- 自研 Agent loop：不符合复用基础设施原则。

**Sources**: [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness), [DeepSeek core](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/core.md), [DeepSeek npm](https://www.npmjs.com/package/@deepseek-ai/dsh), [Pi](https://github.com/earendil-works/pi), [Pi agent core](https://www.npmjs.com/package/@earendil-works/pi-agent-core)

## Decision 5 — Engine-Neutral Domain, Unity-Specific Adapter

**Decision**: Game Spec、Task Graph、Game Skills、Playtest assertions 和 Evaluation issues 不出现 Unity 类型。通用 `EngineAdapter` 定义 scene/entity/component/resource/script/test/play/build capabilities；`UnityEngineAdapter` 单独映射 Scene、GameObject、Component、Prefab 和 MonoBehaviour。

**Rationale**: 这保留未来增加 Godot adapter 的能力，也避免 Planner 直接生成 Unity command。Unity 特有信息可以作为 `engine_metadata` 扩展，但不能成为上层业务不变量。

**Alternatives considered**:

- Game Spec 直接存 `.unity`/Prefab path：短期快，但局部 diff、跨引擎复用和版本迁移困难。
- 为 Unity 重写 Game Skills：重复玩法语义；应由 skill implementation 选择 engine capability。

## Decision 6 — Playtest Runtime

**Decision**: 使用三层验证：Unity EditMode/PlayMode tests 验证组件与场景；自研 C# Playtest Probe 提供确定性输入、GameObject/Component/物理/动画/时间状态；Playwright 驱动最终 Unity Web build 并采集浏览器行为。固定 random seed、fixed timestep、action timeline 和 sampling interval。

**Rationale**: Unity Test Framework 可从命令行运行 EditMode/PlayMode tests 并产出 NUnit report；Probe 能稳定证明拾取、碰撞、血量和状态转换；Playwright 负责最终 canvas/WebAssembly/部署行为。任何单一通道都无法覆盖三类故障。

**Alternatives considered**:

- 只看 compiler/console/exit code：不能证明游戏可操作。
- 只用截图和 Vision：时序和状态判断不稳定。
- 只用 Unity tests：不能证明最终 Web build 加载、输入和托管配置正确。

**Sources**: [Unity Test Framework command line](https://docs.unity3d.com/Packages/com.unity.test-framework@2.0/manual/reference-command-line.html), [Playwright evaluate](https://playwright.dev/docs/evaluating)

## Decision 7 — Evaluation and Bounded Self-Fix

**Decision**: 从 Game Spec 编译 assertions；Evaluator 只读证据并输出 `critical/high/medium/low` issues，Fix Planner 独立生成局部任务。每个 issue 包含 expected/actual、evidence refs、affected capability 和 retryability。每个用户请求最多 5 次修复，并重跑 targeted tests 与 smoke regression。

**Rationale**: 实现者与判定者职责分离能降低 Agent 自证成功和无限循环。Assertion-to-evidence trace 让失败可复现、可审计，局部回归降低 Unity 重导入和重构建成本。

**Alternatives considered**:

- 同一 prompt 同时编码、修复并宣告完成：证据链和停止条件不足。
- 首版判断“好不好玩”：主观且需要玩家数据；MVP 只判断逻辑正确性。

## Decision 8 — Durable Project State

**Decision**: PostgreSQL 18 保存领域实体、append-only `run_events`、Task/Run 状态和 editor leases；S3-compatible storage 保存大证据与不可变 builds；每项目 Git 仓库负责 Unity Assets/Packages/ProjectSettings 文件 checkpoint。Unity `Library/` 不纳入 Git，只作为可清理缓存。

**Rationale**: 关系状态、事件、大文件和源项目版本有不同查询与恢复特性。排除 `Library/` 可避免巨大且机器相关的缓存污染版本历史。

**Alternatives considered**:

- 只保存聊天：无法恢复 Task Graph、Editor lease 和工具执行状态。
- 只用 Git：不适合租约、权限、SSE 和多租户查询。
- 首版引入 Temporal/Kafka/Redis：能力强但运维面过大；先封装 `RunQueue` 端口。

**Sources**: [PostgreSQL documentation](https://www.postgresql.org/docs/)

## Decision 9 — Sandbox and Unity Worker Pool

**Decision**: 使用 Ubuntu 22.04+ licensed worker pool；每 Run 创建项目专属 workspace/container or micro-VM，Editor installation 和 package cache 只读复用，project/build/tmp 独立。non-root、no-new-privileges、drop capabilities、seccomp/AppArmor、CPU/RAM/PID/disk/time quota、network deny-by-default。Unity CLI/Pipeline 只绑定 worker localhost。

**Rationale**: Unity Editor 资源较重，完全冷启动和重复 import 会破坏 15 分钟目标；只读 base/cache 与隔离 workspace 平衡性能和租户隔离。容器默认没有资源限制，因此必须显式设定。Harness tool policy 不能替代 OS-level isolation。

**Alternatives considered**:

- 每个 Run 重新下载 Editor/packages：慢且需要外网。
- 多项目共享同一 Editor process：跨项目污染、崩溃和权限风险高。
- Agent tool allowlist 代替 sandbox：无法防止工具或生成代码漏洞。

**Sources**: [Unity CLI platform compatibility](https://docs.unity.com/en-us/unity-cli/use-unity-cli), [Docker resource constraints](https://docs.docker.com/engine/containers/resource_constraints/), [Docker rootless](https://docs.docker.com/engine/security/rootless/), [Docker seccomp](https://docs.docker.com/engine/security/seccomp/)

## Decision 10 — Unity Licensing Is a Go/No-Go Gate

**Decision**: MVP PoC 可以在符合资格的 Unity tier 下开发，但任何多用户云端 beta 之前必须获得针对“平台代表用户并发运行 Unity Editor/build workers”的书面许可解释，建立 license inventory/lease/quarantine 流程，并按授权容量限流。不得假设 Unity CLI 免费等于 Unity Editor 实例免费。

**Rationale**: Unity 官方说明 Personal 最近 12 个月 total finances threshold 为 20 万美元；Pro 为 200,001–24,999,999 美元，2,500 万美元及以上为 Enterprise。官方还说明同时运行多个 build machines 需要独立许可或 Build Server 能力。Unity CLI/MCP 自身免费且不消耗 Unity AI credits，但这与 Editor tier/seat 义务是两件事。

**Alternatives considered**:

- 把每个用户 sandbox 当作免费无状态实例：存在明显合规与停服风险。
- 直到上线再处理许可：架构和定价可能需要重做。
- 将 Unity 许可密钥放进项目容器：泄漏风险不可接受，应由 worker license broker 管理。

**Sources**: [Unity license compliance](https://unity.com/pages/license-compliance), [Unity CLI licensing scope](https://docs.unity.com/en-us/unity-cli/replace-mcp-server-unity-cli), [Unity AI/MCP pricing FAQ](https://unity.com/features/ai)

> 本节是工程风险分析，不构成法律意见。

## Decision 11 — Unity Web Preview

**Decision**: 使用固定 Unity Web build profile，MVP 禁用 C# multithreading，生成内容寻址 build 并发布到独立静态 origin；配置正确 MIME、gzip/Brotli headers、HTTPS、CSP、sandboxed iframe 和 build-hash cache busting。测试 bridge 仅存在于 development/validation build，发布版本关闭写能力。

**Rationale**: Unity Web 是 AOT/WebAssembly 平台，C# multithreading 不受支持；native threads 需要 SharedArrayBuffer 与 cross-origin isolation。Runner 无需该复杂度。Unity 文档明确服务器需要匹配 compression format 和 response headers。

**Alternatives considered**:

- 启用 Web threads：对 Runner 收益有限，但增加浏览器和 header 约束。
- 从 API 动态代理 build：缓存、隔离、带宽和 cookie 边界差。
- 复用可写 probe 到生产：扩大攻击面，违反最小能力原则。

**Sources**: [Unity Web technical limitations](https://docs.unity3d.com/6000.0/Documentation/Manual/webgl-technical-overview.html), [Unity Web deployment](https://docs.unity3d.com/6000.0/Documentation/Manual/webgl-deploying.html), [Unity Web build settings](https://docs.unity3d.com/6000.0/Documentation/Manual/web-build-settings.html)

## Reuse vs. Build Boundary

| Reuse | Build In-House |
|---|---|
| Unity 6.0 LTS、C#、Web builder、Test Framework | Engine-neutral Game Spec/schema/version/diff |
| Unity CLI、Unity Pipeline、Editor batchmode | `EngineAdapter`、Unity command policy/error normalization |
| DeepSeek Harness / Pi | `AgentRuntime`、`ModelProvider` adapters/contracts |
| Docker/rootless/runtime security primitives | Game Planner、Task Graph、impact analysis |
| Git、PostgreSQL、S3-compatible storage | Runner Game Skills、curated Unity template/packages |
| Playwright、OpenTelemetry | C# Playtest Probe、assertion compiler、Evaluator、Fix Planner |
| 内置许可明确素材 | Product UI/API、progress projection、version UX、license scheduler |

## Risk Register and Phase 0 Gates

| Risk | Likelihood / Impact | Mitigation | Go/No-Go Evidence |
|---|---|---|---|
| Unity CLI experimental breaking changes | High / High | Own adapter, pin CLI/Pipeline, schema snapshots, batchmode fallback | 100 command cycles ≥95% success; fallback covers compile/test/build |
| Unity licensing blocks SaaS concurrency | Medium / Critical | Written review, licensed pool, no overcommit | Approved tier/build-server model and cost envelope before Phase 7 |
| Harness breaking changes | High / High | Dual adapters, pinned versions, contract suite | Resume/cancel/event/tool/error suite + upgrade rehearsal |
| First import/build exceeds user target | High / High | Prebaked template/cache, fixed packages, warm licensed workers | p95 fixed Runner initial preview ≤15 min under measured capacity |
| Playtest flakiness | High / High | Fixed seed/timestep, probe-first evidence | Same golden build 50 repeats, false result <2% |
| Agent broad/destructive edits | Medium / High | Skills/template-first, command allowlist, checkpoint/diff budget | Escape/destructive tests denied; rollback succeeds |
| Self-fix regression | High / High | Impact set + targeted/smoke regressions | Injected defects fixed without baseline regression ≥90% |
| Unity Web incompatibility | Medium / High | Fixed build profile, browser matrix, immutable builds | Chrome/Firefox/Safari load+input pass ≥95% |
| Cross-tenant leak | Low / Critical | OS isolation, no secrets, project workspace fence | Zero cross-project read/write/egress in adversarial suite |

## Complexity Conclusion

- **Feasibility**: 可行，但仅限受控 Runner MVP；不应承诺第一版支持任意 2D/3D 游戏。
- **Largest risks**: Unity CLI maturity、Editor lifecycle/import/build latency、deterministic playtest、self-fix regressions、cloud licensing。
- **Recommended team**: 2 platform/agent engineers、1 Unity/editor tooling engineer、1 gameplay/C# engineer、1 frontend/full-stack engineer、1 infra/security engineer，加共享产品设计和 QA/evaluation。
- **Planning range**: Phase 0–6 约 6–8 个月；Phase 7 生产硬化另加 2–3 个月。Phase 0 未通过许可或自动化稳定性 Gate 时，应停止扩展产品范围。
