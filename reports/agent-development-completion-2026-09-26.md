# Agent 开发闭环补齐记录

本轮延续已有 Python FastAPI + 官方 Pi Agent Core + TypeScript 领域服务 + Unity 架构。目标是让本地游戏创作闭环有明确的模型能力、可用的素材接入和可重复执行的验证入口，不重复建设第二套 Agent。

## 审计与改进

| 问题 | 本轮结果 |
| --- | --- |
| 生图只有自定义网关占位接线 | 新增直接 OpenAI Images 适配；保留旧 HTTP/HTTPS 网关及内置配色 |
| 不能分清缺生图与主链路不可用 | 可选 `services.images` 状态、工作台说明、非付费 `agent:doctor` |
| 模型输出可影响生图请求数量 | Python 在任何图片请求前校验两套四图；未知或不完整计划直接失败 |
| 生图失败缺少可处理反馈 | 鉴权、限流、超时、无效 PNG、缺透明背景等稳定错误；不自动重试付费请求 |
| 资产只记录图片哈希，缺模型来源 | 新候选记录 Provider、模型和生成时间，随确认 Spec 保存 |
| CI 只覆盖旧 TypeScript 层 | 补 Python 主后端、构建、Chromium 与界面回归 |
| 开发验证入口分散 | `verify:agent`、`agent:doctor`、显式启用的 `test:flow` |
| 本机 Docker 无法启动 | 运行已有防护脚本，备份临时 socket 后恢复；保留已有容器、数据库和对象存储 |

## 模型职责

语言模型继续用于需求讨论、规划、工具选择与失败修复。图片模型只在用户选择外部素材来源后使用，负责新的 2D 图片；它不是 Unity 执行、正确性测试和版本恢复的替代品。

不配置图片模型仍可用内置素材完成创作、构建、试玩和修改。外部图片配置检测不会发送付费请求；一轮两组完整素材最多请求八张图片。取消或失败无法撤销已发生的供应商计费。实际图片按 PNG、大小、解码及前景透明度检查，不偷偷改用内置图片。

适配参数核对：[OpenAI Images API 官方规范](https://developers.openai.com/api/reference/resources/images/methods/generate)。本机没有配置外部生图凭证，本轮没有宣称通过真实供应商出图验收。

## 验证

- TypeScript：330 passed，3 项已有外部验收跳过。
- 工作台 Playwright：34 passed，包括新增 8 项图片状态/失败测试以及既有桌面与移动素材流程。
- Python：119 passed，包含真实 PostgreSQL 的检查点、记忆恢复与归属隔离。
- `agent:doctor`：主链路 ready，外部图片 bypassed 且 optional。
- `agent:doctor --require-image`：只因未配置外部图片返回 blocked，符合可选项提升为必需项的预期。
- `pnpm verify:agent` 完整入口通过：lint、typecheck、Python 离线 118 passed / 1 PG skip、TypeScript 330 passed / 3 外部 skip、20 个子项目构建全部通过。真实 PG 测试已单独启用，119 passed。远端 GitHub CI 配置已更新，本轮未运行远端 Actions。
- 真实 DeepSeek v4 flash、内置素材、Unity 制作/换素材/恢复流程：**通过，14.4 分钟**。新项目 `b3ce383f-9287-49d2-8e9e-185d0ef8f415`，创建 `b9a27fb6-c96d-4d77-a728-01adb5a2de33`、修改 `8fd40602-8367-4ac3-a239-dfa9b59c8d4c`、恢复 `c4beac6f-ed2f-4f76-bfaf-b651deb19b16` 全部 succeeded。三次均加载真实 WebGL、验证确认 Spec 和四张 Unity 资源的 SHA-256，浏览器错误为零。

当前证据文件：`artifacts/art-flow/cycle.json`、`artifacts/real-flow/playwright.json`。代码、静态构建、界面模拟测试、真实数据库、真实 Unity 和真实生图分层报告，互不替代。

最终停止本轮启动的应用进程，运行全量门禁后重新一键启动。重启复验通过：Pi/FastAPI ready，3 个任务均保持 succeeded，3 个 WebGL 地址均 HTTP 200 且 provenance 为 real-unity-webgl；恢复候选与原 4 张图片一致，新 provenance 字段保留。证据：[restart-check.json](../artifacts/art-flow/restart-check.json)。开发栈保持运行在 3000 / 3001 / 3010。

![第二套素材的真实游戏截图](../artifacts/art-flow/second-playing.png)

## 后续优先级

1. 配置有权限和预算的图片模型后，验证跨四个素材角色的画风一致性、碰撞轮廓和实际费用；现有提示词无法保证美术质量。
2. 扩展新玩法时，补能力注册、Spec、Unity 运行时、工具和验收；当前完整闭环限于已注册模块。
3. 对外部署前，落实多用户身份、隔离作业进程、生产素材扫描、资源配额和 Unity 托管许可。当前开发架构不等于商业托管服务已验收。
4. 当前目录缺 `.git`；需要纳入用户自己的仓库后才有可靠提交历史与远端 CI。当前也无 CodeGraph 工具与索引。

使用说明：[Agent 开发与闭环验收](../docs/runbooks/agent-development.md)。可编辑图：[Mermaid](../docs/architecture/agent-development.mmd)；查看图：[PNG](../docs/architecture/agent-development.png)。
