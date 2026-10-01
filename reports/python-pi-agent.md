# Python 托管官方 Pi Agent

生产接线：Next.js → FastAPI → Python PiService → 官方 Pi Agent Core 0.85.1 → Python 工具 → Unity/已有领域动作。官方核心是 Node 包，`apps/pi-runtime/host.mjs` 只负责协议和官方框架调用；不是 Python 仿制框架，也不是把普通模型 API 命名为 Pi。

多轮讨论通过无副作用 Pi 会话整理方案。用户确认当前 Spec 后，Worker 执行任务；每个任务由 Pi 调用 `execute_action`，结果来自实际领域/Unity 工具。失败可继续读取工程、修改脚本、编译和测试。最终发布仍必须经过已有编译、测试、试玩和证据门禁，模型说“完成”不会成为成功依据。

Python 负责会话消息、每次工具调用前后的持久账本、预算、进程管理与文件边界。消息进入私有 audit 检查点，前端只展示工具与阶段摘要。已完成动作按幂等键重放保存结果；中断且结果未知的非幂等动作明确要求恢复，不盲目重复。停止在已有 Unity 动作结束的安全边界生效；Python 自己启动的 CLI 超时或取消会清理对应进程树。

CLI 是结构化工具：`cli_run(operation="compile"|"test")`。编辑器路径和工程目录由服务器决定，使用参数数组启动进程，不接受任意 shell 命令。`workspace_list/read/write` 限定当前工程游戏脚本，写入要求原文件 hash，并保留备份。它是本地开发工具边界，不应被当作隔离运行任意不可信 C# 的操作系统沙箱。

删除了无人使用的旧 Pi/DeepSeek/HTTP 占位适配器、对应编译产物及 DEFAULT_RUNTIME 配置。保留实际使用的 TypeScript 领域事务、Planner、Unity 适配和测试接口；没有把整个后端谎称为纯 Python 重写。Fastify 仅保留旧回归入口，生产 HTTP 服务是 FastAPI。

## 验证记录

- 官方版本和真实 DeepSeek 工具调用：`artifacts/pi-agent/smoke.json`。
- 真实 Unity CS0029 错误 → 读取 C# → 修改 → 编译成功，4 次工具调用：`artifacts/pi-agent/repair.json`。
- Python 24项通过（含真实官方宿主+本地协议fixture的失败后工具解锁、最后一轮成功不误报预算）；TypeScript 200项通过、3项按原条件跳过；UI 16项通过；lint、typecheck、生产Next构建通过。
- 真实完整浏览器流程通过，用时9.5分钟（主要为Unity首次WebGL编译）：项目`fb0a4c2b-c116-432b-8b96-337b21e00414`，运行`253849ec-8407-4a95-9f81-3fbf09a14acb`。两轮真实模型对话、确认前零Run、确认后官方Pi工具事件、Unity发布，再通过真实鼠标输入收集、购买强化、通关。证据`artifacts/pi-agent/browser-flow.json`、`game-won.png`。
- 暂停→继续→停止真实网页验收通过：`artifacts/cancel-flow/result.json`；前后active version均为`797dc312-91ff-4c56-97f9-66635c252a25`，旧试玩地址保留。此处的“旧版本”是本次新数据库中生成的版本，不是恢复出厂前的数据。
- 修复制作用Spec正文被通用flex选择器挤成窄列的问题。已重新构建并检查纵向排列、无横向溢出，证据`artifacts/pi-agent/layout.json`、`spec-layout-fixed.png`。

实际验收中发现并修复：workspace依赖遗漏、内部RPC退出后的启动竞态、正常任务先查文件导致工具空转、任务成功恰逢轮数上限被误判失败、模型结构化输出失败重试缺少纠错反馈、设计超时未传递取消信号。确认动作先只呈现execute_action，真实失败后才开放修复工具，成功后由官方循环的停止钩子结束。

SpecKit收敛检查覆盖8项FR、4项SC、3个用户故事、6个设计决策与5项宪章原则。新增T011/T012已验证完成；T013因重置前数据库备份缺失而未通过。不能宣称全部历史迁移验收已收敛。

Docker 恢复出厂设置是迁移期间的外部数据变化，见 [Docker 修复记录](docker-repair-2026-09-07.md)。原数据库已被清空，无法用新项目验收冒充旧对话和历史已恢复；本地工程与已生成的文件仍保留。
