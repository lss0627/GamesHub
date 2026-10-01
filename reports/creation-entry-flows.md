# 一句话与详细讨论：完整流程验收

日期：2026-09-09。对应规格：[010-creation-entry-flows](../specs/010-creation-entry-flows/spec.md)。

## 两种使用方式

- **一句话制作**：选择“一句话制作”，写下想法，点击“直接制作”。AI为未指定的支持项补齐入门默认值，保存制作说明，直接安排制作。点击示例只填入输入框，不会自动执行。
- **详细讨论**：选择“详细讨论”，逐轮讨论和修改；对话与参数持久保存。点击“方案聊好了，生成制作说明”查看，然后“确认说明，开始制作”。发送消息不会开始制作。

两种入口共用同一套规格确认、任务执行、Unity测试、网页构建和实际浏览器发布检查。已去掉强制至少两轮对话的限制；没有任何想法时仍不能生成空方案。

## 已验证的边界

- 快捷输入只保存一次用户消息并只确认一个运行；重新打开项目不会重复确认。
- AI失败时保留输入，不产生运行。
- 不支持的玩法保留为设计和明确的能力缺口，不会偷偷换成跑酷。
- 详细讨论仍支持修改已整理的说明、拒绝旧版本确认和跨项目访问；正在制作时不能并发改写。
- 快捷模式同样使用现有素材；一句话不会自动获得尚未生成的美术、动画、3D或多人能力。

## 完整验收结果

自动化：TypeScript289通过/3条件跳过；Python46通过/1可选检查跳过；最新生产页面24通过。类型、格式和生产构建通过。

一句话流程已完成实际模型、数据库、Unity和浏览器验收，耗时5.8分钟：

- 输入只有一句：“做一个轻松的猫咪跑酷游戏，名字叫‘云朵散步’。”
- 一次输入后自动整理并启动，保存的用户消息数为1；发布的规格与准备的规格完全一致。
- 真实预览验证开始、移动、跳跃、暂停/继续、碰撞或结束后的重开，页面无未处理错误。
- 项目 `26308e84-5001-4c92-b8d1-e6d0e9f9508e`，运行 `e0fad00e-0410-4368-bc82-aa570df9fc9b`。
- [完整记录](../artifacts/creation-flows/quick.json)、[工作台](../artifacts/creation-flows/quick-workbench.png)、[实际操作](../artifacts/creation-flows/quick-playing.png)。

详细讨论流程也已全部通过，耗时6.4分钟：

- 三轮真实讨论先确定点击成长玩法，再确定数值，最后命名为“星光小铺”并把单次点击从10改为15。
- 参数45秒/目标200/每次点击15/升级初价30/初始自动收益0均保留；刷新后历史仍在，确认前运行数为0。
- 手动确认后，发布的规格与审阅的规格完全相同。实际游戏每次点击增加15；开始、暂停/继续、达到目标通关和重开清零均通过，页面无未处理错误。
- 项目 `a072e8b5-521c-4bbf-847d-5a71dd0a3ed2`，运行 `b051508b-7f94-49b4-a8e4-a3e490795226`。
- [完整记录](../artifacts/creation-flows/discuss.json)、[确认前说明](../artifacts/creation-flows/discuss-reviewed-spec.png)、[工作台](../artifacts/creation-flows/discuss-workbench.png)、[实际操作](../artifacts/creation-flows/discuss-playing.png)。

两条真实流程共12.3分钟，2/2通过；使用实际模型、数据库、Unity与浏览器，未用模拟执行替代。两款成品均通过正式发布前的6项浏览器检查，画面与工作台截图已目视检查。

生产服务已加载本轮修改，后端、页面和依赖健康：[检查记录](../artifacts/creation-flows/health.json)。测试只创建两个独立验收项目，原有项目和已发布游戏保持不变。

可直接打开：[一句话生成的云朵散步](http://127.0.0.1:3000/projects/26308e84-5001-4c92-b8d1-e6d0e9f9508e)、[详细讨论生成的星光小铺](http://127.0.0.1:3000/projects/a072e8b5-521c-4bbf-847d-5a71dd0a3ed2)。

日志和逐步证据保存在 [artifacts/creation-flows](../artifacts/creation-flows)。真实复跑入口为 `tests/real-flow/creation-entry-flows.spec.ts`，需设置 `GAMERHUB_REAL_FLOW=1`；已有运行可通过 `GAMERHUB_ENTRY_RESUME=1` 继续检查，避免重复创建。

自动化命令：`pnpm test`、`pnpm test:fastapi`、`pnpm typecheck`、`pnpm lint`、`pnpm build`；生产UI使用 `GAMERHUB_UI_TEST_URL=http://127.0.0.1:3000 pnpm test:ui`（在PowerShell中先设置同名环境变量）。真实结果另存为 `artifacts/creation-flows/playwright.json`。本轮没有扩展通用3D、多人或美术生成能力；这些限制仍以当前能力说明为准。
