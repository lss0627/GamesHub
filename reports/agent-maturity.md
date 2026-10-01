# 游戏开发 Agent 成熟度补齐与验收

日期：2026-09-09。规格：[009-agent-maturity](../specs/009-agent-maturity/spec.md)。本轮基于已有十类 Unity 2D 原型和正式机制开发链路，补齐持续迭代、故障恢复、验收真实性和交付表达。实现、真实验收与生产服务更新均已完成。

后续已补齐“一句话制作”和“详细讨论”两种入口，并分别完成真实端到端验收，见[完整流程验收](creation-entry-flows.md)。本报告保留009阶段的结果。

## 已修复的实际缺口

| 发现的问题 | 当前行为 |
| --- | --- |
| 同类型普通修改也重建场景，改变对象编号并可能丢失自定义内容 | 同类型迭代保留场景；只在首次制作或切换类型时组装；源码恢复直接验证快照 |
| 失败代码留在工程中，影响下一次制作 | 每次修改前记录持久化基线；失败与持有执行权时的取消先归档失败源码，再还原完整工程；恢复幂等且校验归属 |
| 测试报告被删除，stdout 数量可能盖过 XML 中的失败 | 保留原始 NUnit XML、用例明细和内容哈希；XML 为权威结果，缺失或矛盾时失败 |
| 两个任意测试就能代表所有机制要求 | 新机制按每条验收描述生成带指纹的测试前缀；每条要求都要有当前版本的通过用例，缺失、失败、跳过均阻止完成 |
| 浏览器测试只在外部验收脚本中运行 | 正式发布前强制打开实际构建，验证版本、画面、开始、暂停/继续、核心操作和运行错误；失败不发布 |
| 修改小片段也需要重写整个文件 | `workspace_patch` 使用当前哈希、唯一且不重叠的片段匹配，一次全部成功或全部不变；保留备份与结果哈希 |
| 从说明中删掉机制，旧代码仍可能生效 | 明确的 `retire` 操作保留机制身份，要求删除入口与效果并通过负向测试；静默移除条目被拒绝 |
| 页面只凭成功状态显示交付，没有证据或恢复说明 | 同时核对运行、规格与构建/预览身份，显示浏览器及机制验收数量；详情可展开；旧记录、失败和源码恢复分别呈现 |
| 旧 Unity 接口只保存工程就返回成功，甚至返回虚构测试数或会话 | 生产 Runner 统一走真实运行时组装；未实现的场景/对象/预制体/脚本/UI/持久试玩接口不再声明可用；未知属性明确失败；测试调用真实 NUnit |

浏览器检查使用临时回环地址和有边界的文件服务，拒绝路径逃逸、符号链接以及外部网络请求，包括 WebSocket。详细诊断留在本地，创作者事件只包含受限的结果摘要。

## 真实端到端结果

独立验收工程：`e60df8fa-0450-4091-9074-80eca57656d4`。正式使用实际模型、Pi/Python、PostgreSQL、Unity 与浏览器；没有修改原有用户工程或替换旧游戏。

| 场景 | 真实结果 | 记录 |
| --- | --- | --- |
| 新增奖励机制 | B键或按钮增加20，3秒冷却及暂停/重开规则通过；5条需求有对应通过用例 | `de5a015d-03b2-4dc1-9700-12b783d00ff7` |
| 修改为30奖励 | 浏览器实际增加30，重复触发被阻止，普通点击仍加10；5条新版本需求通过 | `931f7008-ae62-4e02-bff0-05af5635f3fc` |
| 移除奖励机制 | B键不再加资源，旧按钮不存在，点击/升级/暂停/重开负向回归通过；3条需求通过 | `7b3ce4d2-d307-484d-9635-11ec9ca3eb21` |
| 暂停后注入真实编译故障 | 到达工具边界才暂停；恢复执行后失败，源码归档并完整还原，旧游戏仍加载 | `a1bca41b-2a0f-47a8-b79c-47d2f1201f11` |
| 最新工作台 | 显示“本次未交付新版本”和源码已恢复，嵌入的上一版本游戏进入ready状态 | [最终截图](../artifacts/agent-maturity/recovered-workbench-final.png) |
| 最新 Runner 工具链 | 独立工程实际组装场景；真实PlayMode 4/4；未知属性写入失败且场景内容不变 | [结果](../artifacts/agent-maturity/runner-tools/result.json) |

三轮机制开发的场景 SHA-256 都为 `348f6b86e5616787dcaa076925da70fa2585ca691fbd99a22149dc1a0e6c1198`。新增阶段后加入的项目自定义 C# 文件在后两轮保持同一哈希。

故障恢复的运行前和恢复后源码版本都为 `source-44a348fd6956eca3caf94fe29f9f283ac8ca40a931a0ae527f4b9973c0b8af42`；错误源码单独保存在 `source-7841c3538505adee1707d0426368a3445346c7061f8d7c617a49d5e8c7da69a7`。故障文件从工程移除，已发布预览没有改变。

完整证据：[机制三轮生命周期](../artifacts/agent-maturity/mechanism-lifecycle.json)、[真实源码恢复](../artifacts/agent-maturity/source-recovery.json)、[恢复事件](../artifacts/agent-maturity/source-recovery-events.txt)。

十类已有真实 WebGL 构建均通过生产浏览器检查：[结果](../artifacts/agent-maturity/browser/results.json)。故意缺少运行状态的坏构建被 `BROWSER_TELEMETRY_MISSING` 拒绝：[负向结果](../artifacts/agent-maturity/browser/broken-result.json)。各类型目录保留最终报告和截图，早期调试失败截图也保留，最终结论以对应 JSON 为准。

## 回归与服务

| 验证 | 结果 |
| --- | --- |
| `pnpm test` | 288通过、3条件跳过；80个测试文件通过、1个跳过 |
| `pnpm test:fastapi` | 45通过、1可选数据库检查跳过；2项依赖弃用警告 |
| `pnpm test:ui`，连接最新生产页面 | 21通过 |
| `pnpm typecheck` / `pnpm lint` / `pnpm build` | 全部通过 |
| 真实模型机制三轮 | 1个完整场景通过，包含3次正式交付 |
| 真实暂停、编译故障与源码恢复 | 1个完整场景通过 |
| 真实恢复工作台与嵌入预览 | 1个完整场景通过 |

日志位于 [artifacts/agent-maturity](../artifacts/agent-maturity)：`vitest-final.log`、`fastapi-final.log`、`ui-final.log`、`typecheck-final.log`、`lint-final.log`、`build-final.log`。

取消、失去租约、已提交交付、重复恢复、损坏快照、跨项目归属等边界由自动化集成测试覆盖；真实故障场景验证的是暂停/恢复后的编译失败，不将它描述为真实取消验收。

仅在确认全部项目无活动任务且 Unity 空闲后，重启了本项目的后端与生产页面。当前3000、3001、3010可用，PostgreSQL、Redis、对象存储、模型、Pi和Unity配置健康；Unity许可已由本轮真实执行验证。服务状态记录见 `health-final.json`。

## 当前仍有的边界

- 支持十类具体2D运行时及其上的代码机制开发；尚不是任意商业游戏生产系统。结构化可视场景/预制体编辑、动画、音频、通用3D、联机与开放世界仍需独立实现。
- 浏览器门禁覆盖实际画面与基础操作；机制语义主要由对应Unity行为测试验证。测试由Agent生成，仍可能漏掉未写出的需求，不能替代独立人工试玩和趣味性判断。
- 已暂停且没有工作进程的运行被取消，或工作进程失去租约/崩溃时，不抢占其他执行者修改工程；持久日志在下一次获取执行权、开始修改前协调恢复。没有历史基线的旧工程无法推断过去失败操作的归属。
- 片段补丁当前聚焦受控C#开发；旧的未索引机制显示历史测试证据，不能倒推逐条验收已通过。
- 当前仍是单创作者本地产品；长期多人服务运维、分布式Unity容量与恢复时限不在这轮验收范围。

## 复跑入口

常规回归使用上表命令。真实验收需已配置本地模型、数据库、Unity与生产服务，并设置 `GAMERHUB_REAL_FLOW=1`：

- `pnpm exec playwright test --config playwright.flow.config.ts tests/real-flow/agent-maturity.spec.ts`：默认新建专用验收工程；已有未完成流程可设置 `GAMERHUB_MATURITY_RESUME=1`继续原运行。
- `pnpm exec playwright test --config playwright.flow.config.ts tests/real-flow/agent-source-recovery.spec.ts --grep 'actual paused'`：在已完成机制验收的专用工程中执行故障注入和恢复。
- `pnpm exec playwright test --config playwright.flow.config.ts tests/real-flow/agent-source-recovery.spec.ts --grep 'actual workbench'`：只验证当前恢复工作台和旧预览。
- `pnpm exec tsx scripts/verify-agent-runner-tools.ts`：使用独立`unity/Acceptance/AgentMaturityRunner`工程验证真实工具链。
- `pnpm exec tsx scripts/verify-browser-delivery.ts`：复用十类真实构建验证生产浏览器门禁和坏构建拒绝。

验收脚本曾因懒加载iframe尚未进入视口而等待；加入滚动到预览后检查通过。这是验收脚本修正，未把尚未加载的画面算作通过。当前工作区没有Git仓库，因此没有创建提交或PR。
