# Agent 与前端完整链路验收

2026-09-06，SpecKit 003。继续使用 Next.js + Python FastAPI，TypeScript 领域与 Unity Worker 通过 stdio 运行。

## 已完成

- 对话：发送前及提交事务内检查活跃制作任务，阻止跨标签页与模型返回时的竞态覆盖。移除80条消息的硬上限，完整保留历史，模型使用最近24条消息及当前方案。
- Agent：重放已完成任务时恢复试玩证据与持久试玩 ID；不能证明安全的未完成 Unity 变更不会盲目重复执行。失败保留规范错误码与公开文案，不暴露原始异常信息。取消在当前操作结束、租约释放后记录取消检查点。
- 控制：工作台展示真实 Agent 步骤和完成项数；提供暂停、继续、停止按钮，明确说明等待当前 Unity 操作结束。停止后不继续显示“正在处理”。
- 同步：Run、版本、素材、对话分别轮询和恢复；慢或失败的辅助请求不冻结其他来源。操作 epoch 与对话 revision 防止旧响应覆盖新结果。连接提示与操作错误分开；输入按项目保存，刷新可恢复，成功发送才清空。
- 素材：最近两组优先，历史候选和素材仓库按需展开；草案选择与当前试玩使用分别标记，仓库依据已发布 Spec 的资产 ID 显示实际使用情况。

## 自动化验证

| 检查 | 结果 |
| --- | --- |
| TypeScript 单元、契约、集成、安全等 | 182通过、3跳过 |
| FastAPI pytest | 11通过 |
| 桌面及手机 Playwright UI | 12通过 |
| TypeScript 全仓检查 | 通过 |
| Biome 全仓检查 | 通过 |
| Next.js 生产构建 | 通过 |
| 真实模型 + FastAPI + Unity 素材全流程 | 通过，约5.2分钟 |

跳过的是既有单独启用验收/真实测试，不计作成功。另行实际执行了真实 Unity 流程。pytest 存在上游测试客户端的2条弃用提示，不影响这次验证。

新增回归验证了制作准入、长对话、失败后重试投影、8项 Agent 恢复与错误保护，以及辅助读取失败、草稿刷新、跨标签方案同步、旧响应、暂停续跑、停止状态、素材显示和手机布局。关键失败回归先复现，再修复。

## 真实流程证据

项目：`aa3dc7a0-c1e9-4b83-b478-dbf4ce734f7f`。

多轮讨论 → AI整理素材清单 → 自动准备两组素材 → 选择 → 审阅Spec → 确认 → Unity导入/检查 → 暂停 → 继续 → 发布试玩 → 更换素材 → 再次试玩 → 恢复旧版。

| 环节 | Run | 结果 |
| --- | --- | --- |
| 第一组素材，包含暂停/继续 | 81afb3cc-343b-40cb-a35b-ca81b37e05da | succeeded |
| 第二组素材 | af53a650-39ab-42a9-8968-e395e56bf086 | succeeded |
| 恢复第一组素材 | d6d2beb7-0797-4ed1-b6ae-2d9c6cb08fb7 | succeeded |

第一条运行在试玩任务后暂停，继续时复用已完成动作；事件断言确认试玩只执行一次。每条运行核对 PostgreSQL 当前 Spec、Unity 素材绑定清单、四张实际 PNG 的 SHA-256、发布版本与浏览器试玩。三个游戏都实际打开并操作开始/跳跃，浏览器错误为空。

- [完整流程与运行结果](../artifacts/art-flow/cycle.json)
- [首轮 Agent 事件](../artifacts/art-flow/first-events.txt)
- [暂停状态截图](../artifacts/art-flow/agent-paused.png)
- [最终桌面素材界面](../artifacts/art-flow/workspace-final-desktop.png)
- [最终手机素材界面](../artifacts/art-flow/workspace-final-mobile.png)
- [最终 Agent 面板](../artifacts/art-flow/agent-final-desktop.png)

最终界面构建后再次完成12项UI回归，并对真实项目进行桌面/手机只读检查：候选正常加载、历史折叠、手机无横向溢出、Agent读取真实步骤、页面无异常。

## 复现

```powershell
pnpm test
pnpm test:fastapi
pnpm typecheck
pnpm lint
$env:GAMERHUB_UI_TEST_URL='http://127.0.0.1:3000'
pnpm test:ui
$env:GAMERHUB_REAL_FLOW='1'
$env:GAMERHUB_FLOW_PROJECT_ID='aa3dc7a0-c1e9-4b83-b478-dbf4ce734f7f'
$env:GAMERHUB_FLOW_PAUSE_ONCE='1'
pnpm exec playwright test --config playwright.flow.config.ts tests/real-flow/art-creation-cycle.spec.ts
```

先按README启动基础设施、FastAPI/Unity和前端。真实测试会在指定项目追加讨论、素材与版本，最后恢复该轮第一组素材。

## 实际边界

SpecKit 收敛：8项FR、4项SC、4个用户故事、5项计划决策及5条项目原则检查完成，没有遗留发现；12项任务完成，收敛未追加任务。

当前完整可执行类型仍为单人2D猫咪跑酷。本轮使用内置素材的自动配色候选；外部生图接口已有实现，但本次没有配置并调用真实图片供应商。暂停/停止在任务安全边界生效。进程崩溃留下无法确认是否完成的 Unity 变更时会明确失败并要求重新核对，不宣称可对任意引擎操作无损续跑。
