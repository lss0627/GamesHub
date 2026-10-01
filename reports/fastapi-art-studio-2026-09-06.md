# FastAPI 与自动素材工作室验收

日期：2026-09-06（Asia/Shanghai）。范围：SpecKit 特性 `002-fastapi-asset-studio`，当前完整的单人 2D Runner 创作流程。

## 实现结果

- 活跃 HTTP 后端切换为 Python FastAPI / Uvicorn，3001 API 与 3010 试玩共用一个应用；默认启动与许可启动入口均已切换。
- 保留 TypeScript 领域事务和 Unity Worker，通过白名单 stdio RPC 运行，不启动 Fastify HTTP 服务。Fastify 旧文件保留作兼容测试；不宣称全部后端已改写为 Python。
- PostgreSQL 新增 `project_art_plans`，包含需求、描述、候选、选择、生成状态和 revision。素材仍经过项目仓库保存至 S3/MinIO。
- 新手可以自动获得完整的角色、背景、金币和木桩候选，无需上传。选择仅更新草案；确认完整 Spec 才开始制作。
- Spec 保存候选 ID、四个资产 ID 与 SHA-256。Unity 从快照导入真实 Resources 文件，编译、执行 PlayMode 测试并构建。当前应用标记取已发布版本；恢复按历史快照重新制作。
- 生成失败/取消/重启保留已有候选。陈旧 revision、跨项目引用和内容哈希不匹配被拒绝。导入的编译/试玩验收失败会调用资源恢复，已发布试玩不受失败制作替换。

## 真实素材流程

项目：`aa3dc7a0-c1e9-4b83-b478-dbf4ce734f7f`。浏览器真实流程通过，耗时约 4.4 分钟；未上传用户文件；实际调用配置的语言模型，使用 PostgreSQL、Redis、MinIO、Unity Editor 与 WebGL。

| 步骤 | Run | 结果 |
|---|---|---|
| 第一组月色素材制作 | 034b8e35-b61d-4d1c-976b-c3adc60ca610 | succeeded |
| 第二组暮色素材制作 | 6ebb2e46-334e-4ec4-b9bb-5035eb618c73 | succeeded |
| 恢复第一组素材版本 | 0b423ef4-ab12-4441-afc2-49b0e2ca23a8 | succeeded |

每次核对数据库当前 Spec 与审阅快照完全一致、Unity 资源清单候选 ID 一致、四张实际资源图片逐张 SHA-256 一致。浏览器候选图片实际解码成功，WebGL 可进入游戏并跳跃；浏览器脚本错误为 0。

- 结构化证据：`artifacts/art-flow/cycle.json`
- 截图：`artifacts/art-flow/{first,second,restored}-{tutorial,playing}.png`
- 候选面板：`artifacts/art-flow/candidates.png`

## 回归门禁

新项目 `33339487-e351-4df5-848c-0796eec5552d` 的原有流程也已通过。首次新建与上传/素材显示/真实制作已验证；修复模型结构问题后从该已建项目续跑，修改、恢复及刷新后试玩全部通过（续跑约 2.4 分钟）。证据为 `artifacts/browser-flow/cycle.json`，其中保留首次创建结果及 resumedAt，不把续跑冒充全新一次执行。

| 新项目步骤 | Run | 结果 |
|---|---|---|
| 新建并制作 | 461a659e-e3bb-4205-a7d7-74cc700f6d13 | succeeded |
| 金币由 10 分改为 20 分 | 7810b09b-3869-45ab-849e-99d94dbd7638 | succeeded |
| 恢复 10 分版本 | 3ecf5ddd-8fa1-4337-9044-da6f3c55e94c | succeeded |

| 门禁 | 结果 |
|---|---|
| Python pytest | 11 passed；2 项第三方测试客户端弃用警告 |
| TypeScript Vitest | 170 passed，3 skipped（原有条件验收） |
| 桌面/手机 Playwright UI | 6 passed |
| TypeScript typecheck | passed |
| Biome lint | passed |
| 最终 Next.js 生产构建 | passed；3000 已重新启动 |
| Python 安装脚本 | pnpm setup:python passed，依赖已锁定 |
| 真实素材浏览器闭环 | 1 passed，三次真实 Unity 制作 |
| 新项目原有浏览器流程 | 创建成功，修复后续跑 passed，修改/恢复/刷新后试玩通过 |

关键测试先观察失败再实施，包括 FastAPI 初始契约、素材绑定、模型无效输出重试、实际资源导入执行路径和 Spec 美术描述。素材安全测试拒绝目标项目中不存在的资产引用、先检查所有者权限；导入验收失败测试确认恢复回调执行且不提交成功。

## 联调修复

真实联调暴露了 PostgreSQL Run 状态枚举与 text 数组比较不匹配、模型偶发无效输出，以及旧素材任务仍导入不存在的 `Assets/Game/Art/Player.png` 并依赖模拟试玩接口。现已修正 enum 比较，增加有上限的模型重试，并将实际资源路径与 Unity PlayMode 验收接入执行器。Spec 的旧默认画风描述也改为依据所选素材输出。

补充的新项目回归在完成首次制作后发现模型返回不完整业务 JSON；修复将完整 brief 校验也纳入最多一次重试，并明确只改一项仍须返回完整方案。测试支持从已验证的创建结果继续修改/恢复，保留原有创建证据，避免重复制作掩盖恢复行为。

## 实际边界

内置候选是既有猫咪/森林素材的晨光、暮色、月色配色，界面如实注明来源。外部图片生成网关已实现并通过成功/失败 HTTP 契约测试，但本轮未配置真实图片供应商，因此未验证外部生图的画质、费用和实际可用性。

本轮不扩大当前游戏模板到任意玩法，不改变商业 Unity 许可范围。默认服务绑定 localhost、使用本地单所有者身份；公开多租户部署、商业许可及生产恶意文件扫描须使用对应生产配置，不能拿本地验收冒充上线验收。旧模拟 probe/evaluator/publisher 端点不再由 FastAPI 提供，真实 Unity 流程使用本地引擎证据。

## SpecKit 收敛

规格、研究、计划、数据模型、契约、任务、验收指南均位于 `specs/002-fastapi-asset-studio/`。首轮收敛追加 T022–T024，分别处理 Spec 说明冲突、素材边界测试和项目级验收记录；完成后复核原有 12 项功能要求、5 项成功标准、12 个验收场景和 5 项项目原则。

最终复核：Converged，24 项任务全部完成；6 项实现决策亦已核对，未发现本特性范围内的剩余工作。复核前后 tasks.md SHA-256 均为 `DD97AB66A0B5AAA7F0DCF7A4643BCDB905007C8A8DF49110802F11FAA22B83DD`，零新增任务。3001 与 3010 均返回 framework=fastapi、status=ready；既有项目素材计划 ready，当前发布素材为月色森林。
