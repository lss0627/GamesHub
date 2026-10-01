# Research and migration decisions

## FastAPI 运行边界
Decision: 两个 Python ASGI listener，共享常驻 stdio 领域/Worker bridge，HTTP 路由明确注册，不使用 catch-all HTTP 转发。
Rationale: 所有活跃 HTTP 均退出 Fastify，同时保留 PG 状态机和 Unity 行为。研究任务已盘点项目/对话/任务/版本/资产/事件/preview 接口。
Alternatives: FastAPI 反向代理 Fastify 不满足迁移；一次重写全部领域代码会扩大事务回归风险。
Sources: https://fastapi.tiangolo.com/advanced/events/ （lifespan）；https://fastapi.tiangolo.com/advanced/custom-response/ （文件、流响应）。

## 自动素材来源
Decision: 默认 builtin provider 输出成套晨光/暮色/夜色候选；明确标注程序化内置素材。可配置 HTTP image provider 接口返回 base64 PNG，不把本会话图像工具假装成产品运行时 API。
Rationale: 无外部密钥即可完整创作；已配置服务可扩展，不声称所有风格已可生成。
Alternatives: 要求用户逐张寻找素材违背新手目标；网页任意抓图缺少来源和格式控制。

## 素材状态与版本
Decision: ArtPlan 使用独立 PG JSON 文档和 revision。候选生成先持久化 generating；重启恢复失败提示。选择时验证四角色/项目归属，原子更新选择并使草案 Spec 失效。prepare 将素材 asset_id/hash 写入 GameSpec；confirm 再验证选择未变。
Rationale: 模型讨论不能覆盖已选素材，执行不得读取可变的最新选择。恢复构建使用历史 Spec，而非 UI 当前草稿。

## 引擎绑定
Decision: 在 Worker 创建执行器、完成模板同步后，从确认 Spec 取四张图片并按 role 写入固定 Resources/Art 路径；校验真实 SHA256、保存绑定清单、Unity 编译与构建时使用真实内容。仅发布后在页面标记当前应用。
Rationale: 当前模板已有这些加载位置，替换文件能保证实际角色/背景/道具读取，保留碰撞体尺寸。

## 迁移授权记录
2026-09-06 用户要求完整项目 FastAPI 迁移与素材闭环，授权本特性的追加迁移与实施。旧 001 规格和已发布项目保留；本轮按 002/tasks.md 执行。未发现 .specify/extensions.yml，所有阶段 hooks 跳过。
