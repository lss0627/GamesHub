# 页面代理报错修复与真实全流程验收

用户项目：`aa3dc7a0-c1e9-4b83-b478-dbf4ce734f7f`

入口：http://127.0.0.1:3000/projects/aa3dc7a0-c1e9-4b83-b478-dbf4ce734f7f

## 根因与修复

Next 代理日志显示该项目的 `/design/messages` 请求发生 `ECONNRESET`。安装版 Next 的代理默认等待 30 秒，失败时返回纯文本 `Internal Server Error`；后端模型请求允许 120 秒，而 GuidedStudio 不检查内容就调用 `response.json()`，因此用户看到 `Unexpected token 'I'`。

- 将实际 Next 代理超时设为 150 秒，让后端先返回模型结果或结构化错误。
- 前端统一处理纯文本、HTML、空内容、无效成功响应和业务错误；显示中文提示并保留输入。
- 修复已构建并重启到 3000 端口。
- 上一轮真实模型脚本直接请求 3001，遗漏了前端代理；本轮替换过时的真实 UI 用例，所有创作操作都由 Chromium 页面发起，查询也通过 3000。

## 真实浏览器结果

2026-09-06 00:53 至 01:05（北京时间），约 12 分钟；没有 mock 模型或 Unity。

1. 在用户失败的项目中完成两轮 DeepSeek 对话，刷新后对话仍在。
2. 展示四种内置图片，通过页面上传 PNG，并检查实际缩略图已加载。
3. 查看 Spec，点击确认后创建游戏；PostgreSQL 中发布的完整 Spec 与确认内容深度相等。
4. 嵌入和独立 Unity WebGL 均初始化成功，实际点击开始和跳跃，截图记录教程、游戏过程和失败结算。
5. 继续与 AI 对话，将金币从 10 分改为 20 分，再确认、制作和试玩；速度 3、跳跃 8、时长 30 秒、生成间隔 4 秒保持不变。
6. 通过页面恢复首次版本，再次试玩及刷新；数据库当前配置恢复为首次确认的 Spec。

| 任务 | Run | 结果 |
| --- | --- | --- |
| 首次制作 | `bcfad436-8361-444e-a99c-2506c19cebcc` | succeeded |
| 金币改为 20 分 | `1333b4f2-621b-4460-835c-8f3ce5dbe1f3` | succeeded |
| 恢复首次版本 | `b77831fd-4dd4-4f0a-865b-e9f472af55fc` | succeeded |

当前项目处于恢复后的 10 分版本。捕获的浏览器脚本异常为 0。

## 回归与证据

- 160 Vitest 通过，3 项环境门禁测试跳过。
- 4 项工作台 UI 测试通过。
- 2 项真实 Next 代理回归通过：上游等待 35 秒仍成功；纯文本 500 保留输入，重试成功。
- 真实浏览器全流程 1 项通过，包含三次真实 Unity 任务。
- lint、typecheck、前端生产构建通过。

证据：`artifacts/browser-flow/cycle.json`、同目录 Spec/素材/游戏截图；Playwright 报告 `artifacts/real-flow/playwright.json`。

复现慢代理回归：`pnpm exec playwright test --config playwright.proxy.config.ts`。

复现真实全流程（服务已启动，会调用真实模型及 Unity）：PowerShell 设置 `$env:GAMERHUB_REAL_FLOW='1'`，然后运行 `pnpm exec playwright test --config playwright.flow.config.ts`。默认新建项目。

本次验收覆盖当前猫咪跑酷模板；上传图片已保存和展示，但不会自动替换游戏角色。游戏画布内仍是英文按钮，工作台提供中文玩法说明。
