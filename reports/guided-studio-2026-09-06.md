# 面向新手的创作流程与画面改造

用户指出旧版只有单句生成，缺少持续讨论、Spec 审阅、素材展示和玩法引导。本轮首页与项目页已切换为 GuidedStudio，并完成真实模型、数据库、Unity 和浏览器联调。

体验入口：http://127.0.0.1:3000/projects/d317ed66-6912-4fb6-b769-16b87d18a8dc

## 流程

1. AI 按历史对话逐步讨论玩法、难度和美术方向，提供可点击的回答建议。
2. PostgreSQL 保存对话与方案。聊天不会提交制作任务，刷新及重启可以恢复。
3. 讨论后生成按章节展示、可下载的制作说明（Spec）。
4. 仅在用户确认后创建任务，执行已审阅的完整 Spec，避免模型二次解释。重复确认不产生重复任务，新讨论使旧 Spec 失效，旧页面及变更后的基础版本不能误提交。
5. 试玩界面提供中文操作指南，完成后引导继续讨论下一版。历史版本与诊断信息折叠展示。

## 素材与真实游戏

- 项目原创橘猫、森林、金币、木桩 PNG 同时用于素材库和 Unity。源 SVG 和生成脚本已保留。
- 上传图片现在可以保存、显示缩略图；明确区分已上传和尚未用于游戏。
- 修复本地扫描/解码地址重复拼接路径，以及独立上传将占位字符串写入 PostgreSQL UUID 外键两个实际阻断问题。
- 内容接口检查项目归属，仅返回审批通过的素材，并设置正确内容类型与 nosniff。
- Unity 加入开始说明、准备好才计时、得分与碰撞反馈、成功/失败、重玩和触屏跳跃按钮；结束后停止场景与角色输入。
- WebGL 页面适配容器，HUD 不再被裁切；扩大得分区域，避免数值换行。

## 验证

- 真实创建 Run `cfdefcd8-5630-487c-99e0-6233a7770f1f` 成功：连续 DeepSeek 对话 → Spec → 确认 → Unity → WebGL。
- 真实修改 Run `44fe566e-511e-4f27-8083-81f9d7f62fbe` 成功：继续聊天将金币从 10 改为 20 分，其他约定参数保持一致，再次确认制作。
- PostgreSQL 查询确认发布的完整 Spec 与确认时审阅内容深度相等；讨论/整理期间没有任务，重复确认只有一个任务。
- Chromium 检查聊天恢复、素材图片、嵌入和独立 WebGL，捕获实际教程、跳跃与失败界面，页面错误为 0。
- 真实上传 PNG 成功，内容接口 HTTP 200、image/png、16805 字节；实际工作台可见上传缩略图。
- 153 项 Vitest 通过，3 项已有环境门禁跳过；4 项新流程 UI 测试通过；lint、typecheck、Studio production build 通过。
- Unity 打包与全量测试竞争资源时出现 3 个 5 秒超时；引擎完成后以 4 个测试 worker 重跑全部通过，未放宽断言和超时。

证据保存在 `artifacts/guided-flow/`，包含 creation.json、modification.json、verification.json、upload-check.json 和工作台/素材/实际游戏截图。

## 复现入口

```powershell
pnpm exec tsx scripts/verify-guided-flow.ts
pnpm exec tsx scripts/verify-guided-modification.ts
pnpm exec tsx scripts/inspect-guided-preview.ts
pnpm exec vitest run --maxWorkers 4
pnpm test:ui
```

前两个脚本会调用真实模型和 Unity，针对本轮专用验收项目；已经完成的项目不要反复执行创建脚本。截图检查脚本可重复运行。上一轮 full-creation-cycle.spec.ts 使用旧版单句生成选择器，本轮新流程使用上述脚本和 guided-workspace.spec.ts 验证。

## 范围

当前可执行能力仍是单人 Unity 2D Runner 模板，不是任意游戏类型生成。上传素材预览已完成，任意图片自动替换角色的引导式流程尚未接入。游戏内按钮使用英文，工作台提供中文玩法说明。本地素材扫描与解码仍是原有开发用协议实现，不等同于生产安全流水线。未扩展商业发布、多租户登录和跨浏览器完整矩阵。
