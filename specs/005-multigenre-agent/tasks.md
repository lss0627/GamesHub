# Tasks: 多类型游戏Agent
## Phase 1 Setup
- [x] T001 规格/研究/契约于specs/005-multigenre-agent，更新明确用户授权的产品范围。
## Phase 2 Foundation
- [x] T002 先写能力/草案/任务/空验收回归于tests/unit/multigenre.test.ts。
- [x] T003 实现共享能力与多类型Spec于packages/game-spec/src/game-capabilities.ts、design-document.ts及contracts schema。
## Phase 3 US1
独立验收：幸存者讨论保留类型与参数；未知执行类型可保存不降级。
- [x] T004 [US1] 更新DesignService与prompt-interpreter，保留多轮讨论、对应参数和准入缺口。
- [x] T005 [US1] GuidedStudio/ArtStudio依据能力显示类型、操作目标、素材用途。
## Phase 4 US2
独立验收：幸存者/点击独立运行，Runner兼容；按类型验收。
- [x] T006 [US2] 按Spec规划任务与修改于packages/game-planner、worker workflows；更新UnityTaskExecutor类型执行映射。
- [x] T007 [US2] Unity模板增加Arena/Clicker运行时、场景分派、只读快照和PlayMode测试，real-unity按能力选择配置/测试门禁。
- [x] T008 [US2] 真实浏览器多类型流程tests/real-flow/multigenre.spec.ts，涵盖参数/玩法升级/修改；旧Runner回归。
## Phase 5 US3
- [x] T009 [US3] 能力公开接口、未接入类型准入拒绝和对应前端回归。
- [x] T010 [US3] reports/multigenre-agent-architecture.md与Mermaid架构图，说明实际职责、限制和扩展路径。
## Phase 6 Acceptance
- [x] T011 门禁、冷启动、截图/证据、SpecKit收敛与README/planning回填。
## Dependencies / Parallel
T001→T002→T003→T004/T005→T006→T007→T008→T009/T010→T011。研究可独立，实施按依赖推进；US1的UI文案与API单测可独立验证，US2的测试契约与实现分别校验。不会在实现前把能力写成成功。

## Phase 7: Convergence
- [x] T012 [FR-006/US3] 新运行时的开始、升级、胜负按钮改为中文，加入轻量字体与来源声明，实际网页检查文字可读。
- [x] T013 [FR-003/FR-005] 点击成长的超时失败写入Spec；核对已接入数值与规则，未执行的额外配置不得静默丢弃；补相应回归。
- [x] T014 [FR-004/SC-002] 修复点击成长底层按钮抢走开始弹窗点击的问题，浏览器验证开始、购买和胜利；保持恢复幸存者成功。

