# Tasks: Agent 与创作工作台可靠性

## Phase 1 Setup
- [x] T001 建立规格、计划和研究于 specs/003-agent-workspace-reliability/。

## Phase 2 Foundation
- [x] T002 编写准入竞态、长对话和步骤恢复失败回归于 tests/unit/design-service.test.ts、tests/unit/run-journey.test.ts。

## Phase 3 US1 持续对话
独立验收：制作时不调用模型/不更新草案，竞态拒绝，长对话保留。
- [x] T003 [US1] 实现事务内准入与有界模型上下文于 apps/platform-api/src/services/design-service.ts。

## Phase 4 US2 执行与控制
独立验收：步骤取最新真实事件，控制后不错误发布或重复工具执行。
- [x] T004 [US2] 根据独立审视补齐 Agent 控制回归及对应修复于 packages/agent-runtime/src/kernel/kernel.ts、apps/orchestrator-worker/src/worker.ts、tests/unit/agent-kernel.test.ts。
- [x] T005 [US2] 修复步骤投影并接入简明活动面板于 apps/studio-web/src/features/runs/RunJourney.tsx、AgentActivity.tsx。
- [x] T006 [US2] 实现暂停/继续及安全边界说明于 apps/studio-web/src/features/creator/GuidedStudio.tsx。

## Phase 5 US3 前端可靠同步
独立验收：辅助请求失败不冻结Run，旧响应不覆盖新状态，草稿刷新保留。
- [x] T007 [US3] 编写工作台异常/跨页回归于 tests/ui/workspace-reliability.spec.ts。
- [x] T008 [US3] 实现分源恢复、revision/epoch保护、草稿和连接提示于 apps/studio-web/src/features/creator/GuidedStudio.tsx。

## Phase 6 US4 素材一致呈现
独立验收：最新候选优先、历史可查、仓库使用状态准确，手机无溢出。
- [x] T009 [US4] 接入素材状态与候选分组于 apps/studio-web/src/features/creator/ArtStudio.tsx、GuidedStudio.tsx、guided-studio.css。
- [x] T010 [US4] 补充素材分组和应用状态回归于 tests/ui/art-studio.spec.ts。

## Phase 7 Acceptance
- [x] T011 完成 Python/TS/UI/构建门禁并真实验证 Agent/Unity 于 tests/real-flow/、artifacts/。
- [x] T012 SpecKit 收敛并记录结果于 reports/agent-workspace-2026-09-06.md、README.md、specs/003-agent-workspace-reliability/。

## Dependencies
T001→T002→T003；T004→T005→T006；T007→T008→T009→T010；全部→T011→T012。T003 与只读 Agent 研究可并行，UI测试与纯投影回归可独立准备。实施按故事增量验证，最终覆盖全部故事，不以单个MVP结束。


