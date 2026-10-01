# GamerHub 前后端逻辑审查与优化

本轮完成跨模块审查及已确认问题的修复。重点是创作、修改、暂停、取消、恢复和预览的一致性；不是对全部源码逐行无缺陷的保证。保留既有数据和历史文档，没有运行付费模型请求，也没有修改用户生成的 Unity 项目。

## 已修复的问题

| 优先级 | 问题与触发场景 | 修改后的行为 |
| --- | --- | --- |
| P1 | Unity 构建超过 Run 租约后，其他 Worker 可重复接管 | 执行期间定期续租；写入与状态迁移校验租约拥有者和有效期；失去租约的 Worker 停止后续操作 |
| P1 | 取消期间 Worker 仍执行后续任务，失败兜底能覆盖 cancelled | 在模型、Unity 工具和发布边界检查持久状态；取消保持终态，移除强行改为 failed 的兜底 |
| P1 | API 立即声明 paused/resources_released，实际工具仍在执行 | 有 Worker 租约时只记录 pause_requested；当前工具返回后保存恢复点、确认暂停并释放 Run 租约 |
| P1 | 超时 Promise.race 返回时变更工具仍可能运行，重试与旧操作重叠 | 对 engine_mutation 排空原调用后再返回超时或重试；保持 Worker 租约直到调用结束 |
| P1 | 同项目多个修改请求并发写工作区和版本 | 项目行锁下进行幂等检查与活动任务检查；未完成任务或尚未释放的有效租约返回 PROJECT_RUN_ACTIVE/409 |
| P1 | SQL unique violation 后在已 aborted 的事务内继续 SELECT | 在项目行锁下串行受理，避免依赖失败事务重试；10 并发重复请求只创建 1 Run 和 1 session |
| P1 | 同一个 Idempotency-Key 携带不同内容仍返回旧任务 | 相同内容重放；不同 request_type/prompt 返回 IDEMPOTENCY_CONFLICT/409 |
| P1 | HTTP DELETE/PATCH/PUT 被当作 POST，可意外创建或控制任务 | 不支持的方法返回 405；HEAD 走读取路径 |
| P1 | 生产 HTTP 固定进程身份缺少访问校验 | 生产要求服务端 Bearer 凭据，支持注入 authorize；未经校验的请求返回 401 |
| P1 | succeeded 与预览地址分开写入，前端读到成功却无预览 | 终态、结束时间和结果摘要在同一数据库事务写入；内存实现保持一致 |
| P1 | 生产恢复使用 checkpoint/Git 指针，前端却要求 GameSpec 版本和 Run | 生产与本地真实模式统一使用 GameSpec 历史，恢复排队为 rollback Run；HTTP 202、完整 Run 响应、可重放幂等键 |
| P2 | BEGIN/set_config 失败泄漏数据库连接，ROLLBACK 异常掩盖原错误 | 事务初始化进入 try/finally，始终释放连接，保留原始失败 |
| P2 | 可选 Redis 等待或 tracing 失败使持久任务看起来未受理 | Redis 等待失败后退回数据库轮询；可选唤醒 trace 写入失败不改变受理结果 |
| P2 | 前端旧轮询更新新 Run 的游标，断网后允许重复提交 | 切换任务取消旧请求，写状态前检查有效性；网络中断继续查询，保持提交锁 |
| P2 | 素材替换未互斥、项目恢复期间可提前提交、切换项目保留旧状态 | 增加请求互斥和按钮状态，恢复完成后再提交；项目 ID 作为组件 key |
| P2 | 修改失败后丢失可用预览 | 保留最近一次验证通过的预览，失败信息与现有游戏可同时查看 |
| P2 | 上传接口默认 1 MiB 限制与领域 5 MiB 图片限制冲突 | JSON HTTP 限制调整到 8 MiB（容纳 base64），领域仍限制图片 5 MiB；增加类型、base64 和关联 Run 授权校验 |
| P2 | Worker 重启后 GameSpec 版本号从 1 重新计算，保存失败留下缓存版本 | 创建前加载持久版本；写入失败移除未持久化缓存记录 |
| P2 | 评估为缺失证据随机生成 UUID，无证据 passed 也能通过 | 缺失证据保留空引用；无证据的 passed 降为 inconclusive；空断言集不再自动通过 |
| P2 | TaskGraphRunner 可能把阻塞/循环图当作执行完毕 | 检查 task ID 匹配及图中全部任务完成，否则失败 |
| P2 | API 未限制名称和请求尺寸，内部 SQL 错误当作 400 直接返回 | 增加名称/提示词/幂等键边界，未知内部异常返回通用 INTERNAL_ERROR |

## 审查覆盖与证据

| 范围 | 本轮方式 |
| --- | --- |
| Studio 创作页、运行状态、资产操作、版本恢复、Preview | 源码审查、TypeScript/Next 构建、Chromium 状态回归 |
| Platform HTTP 路由、身份边界、错误、输入、SSE/Trace | 源码审查、Fastify inject 契约与安全测试 |
| PostgreSQL、内存与 JSON 状态、Outbox、租约 | 源码审查、事务故障单测、独立真实 PostgreSQL 数据库并发验证 |
| Agent、Worker、创建/修改/恢复任务图、checkpoint | 源码审查、工具取消/暂停/续租/超时与恢复测试 |
| GameSpec、Planner、Evaluator、Playtest | 核心实现审查与全量既有契约/单元/集成测试 |
| 模型 Provider、资产导入/回滚、sandbox/Unity adapter、版本存储 | 关键边界源码审查与既有安全/契约/集成测试 |
| Unity Runner C# | 对模板输入、计分、结束、碰撞脚本作静态阅读；本轮未改动 C#，未运行真实引擎回归 |
| 生产配置与本地启动 | 配置入口、健康/基础设施和既有本地运行集成测试；执行全部 workspace 构建 |

## 验证结果

- 基线：126 tests passed，3 skipped。
- 最终 Vitest、Biome、TypeScript 和构建结果见本报告末尾的最终门禁记录。
- Chromium UI：3/3 通过。覆盖刷新恢复、活动任务互斥、断网重连、pause_requested、完成后修改及失败保留 Preview。使用受控 HTTP 响应，不冒充真实 DeepSeek/Unity 验收。
- 独立 PostgreSQL 18 实测：10 个并发相同请求 -> 1 个受理 Run；无孤立 session；RunEvent/Outbox 不匹配数为 0；旧租约写入被拒；成功响应已含预览；版本恢复返回 queued Run 并支持幂等重放。
- 数据库验证仅在 `gamerhub_logic_audit_*` 临时数据库执行，开发数据库未被修改。

## 使用与行为变化

- `pnpm test:ui` 使用独立 `playwright.ui.config.ts` 和 3100 端口，测试前端状态，不需要模型余额或 Unity。
- `scripts/audit-postgres.ts` 只接受 `GAMERHUB_AUDIT_DATABASE_URL` 中数据库名为 `gamerhub_logic_audit_*` 的新建空数据库；脚本会执行迁移，不应指向已有数据源。
- 同一项目只能有一个未完成 Run，包括已暂停 Run。请恢复或取消它后再创建其他任务；取消中的当前工具须完成清理。
- 暂停与取消在工具边界生效；Unity 长操作期间等待是预期行为，API 不再宣称已经安全暂停。
- 运行受理目前支持 `create/modify/rollback`。未实现独立执行语义的 `validate/publish` 被拒绝，不再误走创建流程；OpenAPI 已同步。
- HTTP 版本恢复必须提供 `Idempotency-Key`，使用版本历史中的 GameSpec ID。
- 生产固定身份 API 新增 `GAMERHUB_API_BEARER_TOKEN`（至少 32 个字符）。这是服务端访问凭据，不能配置为 `NEXT_PUBLIC_*`；本地开发仍按既有本地身份工作。

## 仍需后续工程或外部验证

1. **真实多租户登录未建立。** 当前生产入口仍绑定一个配置的用户，新增 Bearer 是该入口的访问边界，不是完整 SaaS 登录、会话、动态租户身份和权限系统。浏览器生产访问需要可信认证层；不能把共享服务端 token 写到前端。
2. **租约不能单独终止失联机器上的 Unity。** 本轮阻止过期 Worker 的后续数据库写入和工具调用，但数据库网络分区、进程被挂起时，正在执行的远端 Unity 操作仍需工作区/执行器层面的 fencing 和强制终止机制。未进行多机故障注入。
3. **跨系统原子性仍有限。** Preview publisher、GameSpec 激活及 Run 完成属于不同持久化/外部操作；本轮增加边界检查并消除 Run 成功摘要窗口，但尚未改造为统一提交协议。发布途中取消或崩溃需在真实发布服务上继续验证。
4. **旧数据中的并发 Run 未自动迁移。** 新入口限制同项目活动任务；历史上已经受理的多个 Run 或绕过入口直接写数据库的任务，应在多 Worker 上线前检查并收敛。
5. **真实模型/Unity 与商业发布门禁未重跑。** 本轮没有付费生成、Unity 冷构建、跨浏览器真实 WebGL、长时间 soak、人工评审和许可签署证据；既有 3 个环境门禁跳过仍明确保留。
6. **后续性能和架构工作。** 大量历史事件的 Trace/Checkpoint 查询、项目/版本列表分页、CreatorWorkspace 拆分、完整 OpenAPI 类型自动生成仍值得单独实施。当前 `generate-contracts.ts` 只报告路径，尚不是生成器。
7. **Runner 产品范围。** 平台核心仍是固定 Runner 垂直切片，不能因为通用提示框就承诺任意游戏类型；模板玩家脚本在 Game Over 后的输入冻结等玩法细节建议结合真实 PlayMode 验证继续完善。

工作区没有 Git 元数据，因此没有创建 commit；修改已直接保存在文件中。计划和详细进度在 `.planning/project-logic-audit/`，原根目录历史计划未覆盖。

## 最终门禁记录

- `pnpm lint`：308 个文件通过。
- `pnpm typecheck`：通过。
- `pnpm test`：55 个测试文件中 54 passed、1 skipped；143 tests passed、3 skipped，相比基线新增 17 项通过测试。
- `pnpm test:ui`：Chromium 3/3 通过。
- `pnpm build`：全部 20 个可构建 workspace 通过，包含 Next.js 生产构建。
- PostgreSQL 并发、租约、Outbox、终态预览与恢复契约实测通过；两座本轮创建的隔离测试数据库均已删除。
- 本轮启动的 3100 测试服务器已停止；未更改原有基础设施运行状态。

## 第二轮更新

用户要求继续后，已处理上文第 3 项的 PostgreSQL 内部发布原子性，以及第 4 项的历史任务领取互斥，并修复构建身份和迁移事务。完整范围、验证结果及剩余边界见 [第二轮报告](project-logic-audit-round2-2026-09-05.md)。最新自动化结果为 146 passed、3 skipped；原开发库尚未应用新增 009 迁移。
