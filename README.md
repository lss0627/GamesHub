# GamerHub

Agent 开发入口已补齐可选生图适配、图片能力状态和统一诊断/验证命令。架构职责、图片配置、工具扩展与完整验收流程见 [Agent 开发与闭环验收](docs/runbooks/agent-development.md)。先运行 `pnpm start:local --no-open`，再运行 `pnpm agent:doctor`；代码门禁使用 `pnpm verify:agent`。外部生图不是内置素材制作闭环的前置条件。

最新 Agent 基础层已加入有来源的项目记忆、修订删除、长对话上下文预算、统一工具校验和 PG 最新检查点。打开工作台“项目记忆”可直接管理偏好。实现、实际架构与真实模型/Unity 验收见 [Agent 基础架构](reports/agent-foundation.md) 和 [SpecKit 007](specs/007-agent-foundation/tasks.md)。

面向非程序员的 Unity 游戏创作平台。前端使用 Next.js，HTTP 后端使用 Python FastAPI。用户与 AI 多轮讨论玩法和画风，系统准备素材候选；用户选择并审阅 Spec 后确认制作，由真实 Unity 6000.0.80f1 导入素材、验证并构建 WebGL 游戏。已接入跑酷、幸存者、俯视射击和点击成长；其他创意可讨论与保存，尚未实现的制作能力会明确显示，不自动替换成跑酷。

当前 Agent 使用官方 Pi Agent Core 0.85.1，由 Python 管理会话、工具、预算和恢复；最小 Node 宿主运行官方框架。已支持读取和修改当前工程的游戏脚本、调用 Unity CLI 编译与测试，并将错误交回模型修复。制作流程仍使用已注册的玩法模块与确认后的 Spec，不承诺自动完成任意商业游戏。接线与验收见 [Pi 架构说明](reports/python-pi-agent.md) 和 [SpecKit 006](specs/006-python-pi-agent/tasks.md)。

PostgreSQL 保存项目、对话、素材计划、任务与版本，Redis 唤醒 Worker，MinIO 保存素材。已有 TypeScript 领域逻辑及 Unity Worker 通过无 HTTP 的 stdio 进程复用，FastAPI 承担 HTTP 和新的素材业务；默认启动已停用 Fastify。具体边界见 [后端说明](apps/platform-fastapi/README.md)。

工作台现已展示真实 Agent 步骤，支持在 Unity 操作安全边界暂停、继续和停止；未发送文字刷新后保留，接口异常独立重连，素材区区分最新候选、草案选择与当前试玩使用。最新规格见 [SpecKit 003](specs/003-agent-workspace-reliability/tasks.md)，完整验证与真实暂停续跑证据见 [Agent 与前端验收](reports/agent-workspace-2026-09-06.md)。

## 小白启动（推荐）

双击项目文件夹里的 **[启动GamerHub.cmd](启动GamerHub.cmd)**。也可以使用英文文件名 [Start-GamerHub.cmd](Start-GamerHub.cmd)。看到“启动完成”后，浏览器会自动打开创作页面。

启动器会检测已有服务、启动Docker、准备Python依赖、检测或安装固定版本Unity和WebGL组件、等待数据库可用，再启动FastAPI和前端。重复双击会复用已运行的服务。日常使用无需打开Unity，也无需手动建立工程、导入图片或导出网页游戏。

首次电脑需具备Node.js 24+、pnpm 11.19.0、Docker Desktop；Python依赖安装使用uv。缺少基础工具时启动器会给出提示。Unity首次安装约需下载5GB，Windows若弹出系统授权请自行确认；Unity账户登录和许可激活需由本人在Unity Hub完成，启动器不会替你接受许可。

这台电脑的模型配置会保留。更换电脑时需要配置自己的模型密钥，详情见[模型配置](docs/runbooks/deepseek-api.md)，不要把密钥发送到项目对话里。外部生图服务是可选的，内置素材可直接使用。

进入页面后：先聊玩法 → 准备并选择素材 → 阅读制作说明 → 确认制作 → 试玩并继续提修改意见。需要暂时离开可以暂停制作；暂停和停止会等待当前Unity操作结束。

命令行等价入口：`pnpm start:local`。自动验收不打开浏览器：`pnpm start:local --no-open`。启动日志保存在`artifacts/dev-tools`，启动失败会保留项目与文件。最新规格见[SpecKit 004](specs/004-beginner-one-click/tasks.md)，实际流程与发现修复见[一键启动验收报告](reports/beginner-one-click-2026-09-06.md)。

## 开发者启动

在 PowerShell 中进入项目目录后运行：

```powershell
pnpm install
pnpm setup:python
pnpm dev:bootstrap
pnpm env:doctor:local
pnpm dev:infra
pnpm infra:doctor
pnpm model:doctor
pnpm dev
```

保持最后一个命令运行，然后打开 <http://127.0.0.1:3000/>。

Python 安装脚本需要 uv。首次运行时，在 `.env.local` 配置语言模型密钥与 Unity 路径；图片生成服务为可选。无生图服务也可以自动准备晨光、暮色、月色的内置素材候选，无需自行上传。迁移规格与任务见 [SpecKit 002](specs/002-fastapi-asset-studio/tasks.md)，验收证据见 [项目报告](reports/fastapi-art-studio-2026-09-06.md)。

`pnpm dev` 会先启动 PostgreSQL、Redis、MinIO、OTel 并执行数据库迁移，然后启动 Studio 与本地 Agent/Unity 服务。PostgreSQL 是唯一事实源；Redis 只做低延迟唤醒，断开后 Worker 仍通过 PostgreSQL `SKIP LOCKED` 轮询恢复，不会把 Redis 当成持久队列。

本地端口：

- Studio：`http://127.0.0.1:3000/`
- Platform API：`http://127.0.0.1:3001/health`
- Local support：`http://127.0.0.1:3010/health`
- Redis：`redis://127.0.0.1:6379`（仅后端使用）
- PostgreSQL：`127.0.0.1:5432`（仅后端使用）

## 常见问题

### 页面显示连接被拒绝

双击项目文件夹中的“启动GamerHub.cmd”，等待启动完成，再点击页面的“重新检查环境”。启动器启动的服务在后台运行，关闭网页不会删除项目。

### Docker 提示 dockerInference / engine.sock 无法访问

这是 Docker Desktop 的启动通信文件故障。此次修复保留了旧临时目录并让 Docker 重建通信文件，详见 [修复记录](reports/docker-repair-2026-09-07.md)。不要为此再次恢复出厂设置；该操作会清空容器数据，包括本地数据库。

### 页面提示 AI 模型额度不足 / HTTP 402

代码、Unity 和 API Key 均可能配置正确，但当前 DeepSeek 账户没有可用余额。运行 `pnpm model:doctor` 可在发起创作前检查模型是否存在和账户余额是否可用；充值后重新运行检查，再点击“重新尝试”。

### 本地验证

```powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm infra:doctor
pnpm unity:install
```

完整开发和发布验证见 [Quickstart](specs/001-ai-game-creation-platform/quickstart.md)；DeepSeek 配置见 [DeepSeek API 配置](docs/runbooks/deepseek-api.md)。
