# Tasks: FastAPI 与自动素材工作室

## Phase 1: Setup
- [x] T001 建立 SpecKit 规格、计划、研究、契约与验收指南于 specs/002-fastapi-asset-studio/。
- [x] T002 建立 Python 依赖锁定及忽略规则于 apps/platform-fastapi/requirements.txt、.gitignore、.dockerignore。

## Phase 2: Foundation
- [x] T003 编写并观察失败的迁移/素材契约测试于 apps/platform-fastapi/tests/test_contracts.py、tests/unit/asset-bindings.test.ts。
- [x] T004 定义素材状态和迁移于 packages/game-spec/src/art-plan.ts、infra/migrations/011_art_plans.sql。

## Phase 3: US1 原有项目迁移
独立验收：既有项目读写、错误、事件、图片和历史试玩契约通过。
- [x] T005 [US1] 实现无 HTTP 的领域/Worker RPC 运行时于 apps/local-dev/src/rpc-server.ts。
- [x] T006 [US1] 实现并发 RPC 生命周期与异常处理于 apps/platform-fastapi/gamerhub_api/bridge.py。
- [x] T007 [US1] 实现显式 FastAPI 路由、模型、鉴权和错误契约于 apps/platform-fastapi/gamerhub_api/app.py、models.py。
- [x] T008 [US1] 实现图片解码和安全试玩响应、双端口 ASGI 启动于 apps/platform-fastapi/gamerhub_api/content.py、serve.py。

## Phase 4: US2 系统准备候选
独立验收：无需上传可获得完整候选，改述生成可恢复，错误和来源诚实。
- [x] T009 [US2] 实现素材计划持久化、CAS与 AI 需求整理于 apps/local-dev/src/art-store.ts。
- [x] T010 [US2] 实现 Python 内置与 HTTP 图片来源于 apps/platform-fastapi/gamerhub_api/providers.py。
- [x] T011 [US2] 实现后台生成、取消、重启恢复及候选选择于 apps/platform-fastapi/gamerhub_api/art.py。

## Phase 5: US3 确认并真实应用
独立验收：确认素材写入 Spec，真实导入绑定；修改和恢复对应素材不串版。
- [x] T012 [US3] 实现选择快照和确认并发检查于 apps/platform-api/src/services/design-service.ts、packages/game-spec/src/design-document.ts。
- [x] T013 [US3] 实现图片哈希校验、角色绑定与构建清单于 apps/local-dev/src/apply-art.ts、real-unity.ts。
- [x] T014 [US3] 验证当前发布素材来源和历史恢复一致于 apps/platform-fastapi/tests/test_art_workflow.py、tests/unit/asset-bindings.test.ts。

## Phase 6: US4 新手工作台
独立验收：桌面/手机可描述画风、看候选、选择、确认，并区分已选与当前使用。
- [x] T015 [US4] 实现自动素材面板于 apps/studio-web/src/features/creator/ArtStudio.tsx。
- [x] T016 [US4] 接入 Spec/制作刷新与新手引导于 apps/studio-web/src/features/creator/GuidedStudio.tsx、guided-studio.css。
- [x] T017 [US4] 补充前端素材完整流程测试于 tests/ui/art-studio.spec.ts。

## Phase 7: Integration and acceptance
- [x] T018 切换默认和许可启动入口并更新环境说明于 scripts/start-fastapi.ts、scripts/start-e2e-stack.ts、package.json、.env.example、apps/platform-fastapi/README.md。
- [x] T019 运行 Python/TS/前端契约门禁并修正于 apps/platform-fastapi/tests/、tests/ui/。
- [x] T020 完成真实模型、无上传候选、Unity两组素材制作与恢复的浏览器验收于 tests/real-flow/art-creation-cycle.spec.ts、artifacts/art-flow/。
- [x] T021 收敛规格/任务/实现差距并更新项目架构和结果于 specs/002-fastapi-asset-studio/、reports/fastapi-art-studio-2026-09-06.md、README.md。

## Dependencies and execution
T001-T004 -> US1 -> US2 -> US3 -> US4 -> integration. 研究阶段已按 SpecKit 调度独立迁移研究；实现按依赖顺序进行。T015 UI 可在 US2 契约确定后独立实现，但完成门禁依赖实际后端。US1 是首个可独立验收增量，本次用户授权范围覆盖全部故事，不能以单个增量完成作为整体交付。

## Phase 8: Convergence
- [x] T022 纠正 packages/game-spec/src/design-document.ts 中默认素材文案与已选素材快照冲突，添加说明回归测试；FR-006 / US3/AC2 (contradicts, HIGH)。
- [x] T023 补充 ArtStore 跨项目素材引用拒绝及资源导入验收失败恢复回归于 tests/unit/art-store-security.test.ts、tests/unit/resource-art-executor.test.ts；SC-004 / FR-007 / US3/AC3 (partial, HIGH)。
- [x] T024 完成项目级验收报告并同步 quickstart 与运行证据于 reports/fastapi-art-studio-2026-09-06.md、specs/002-fastapi-asset-studio/quickstart.md；FR-012 / T021 (partial, MEDIUM)。
