# Tasks: Agent foundation
## Phase 1 Setup
- [x] T001 完成specs/007-agent-foundation规格、研究、模型和契约。
## Phase 2 Foundation
- [x] T002 编写失败测试apps/platform-fastapi/tests/test_agent_foundation.py，覆盖记忆、上下文与工具边界。
- [x] T003 创建infra/migrations/012_agent_foundation.sql和Python pi/repository.py，隔离存储与CAS/检查点。
## Phase 3 US1
独立验收：记忆重启、修订删除、跨项目隔离。
- [x] T004 [US1] 实现pi/memory.py项目记忆与检索。
- [x] T005 [US1] 在gamerhub_api/app.py提供记忆和工具API，绑定项目。
- [x] T006 [US1] 实现studio-web/ProjectMemory组件与GuidedStudio集成，用户编辑删除。
## Phase 4 US2
独立验收：工具校验、越权、大结果失败、停止重复。
- [x] T007 [US2] 实现pi/registry.py统一工具契约与JSON Schema、阶段、预算校验。
- [x] T008 [US2] 接入pi/tools.py检索、上下文工具和现有编译工具，安全输出引用。
- [x] T009 [US2] 重构pi/service.py生产工具分发和最新检查点，保留旧检查点读取。
## Phase 5 US3
独立验收：40轮中文对话/完整工具组/记忆修订失效与真实模型。
- [x] T010 [US3] 实现pi/context.py有界上下文、完整组和安全统计。
- [x] T011 [US3] 在host.mjs/client.py接入官方上下文钩子及失败终止。
- [x] T012 [US3] 修改ModelRequest/DesignService/python-agent.ts传项目上下文和全历史，接入实际设计与执行。
## Phase 6 Acceptance
- [x] T013 完成Python/TS/UI及新增API、SQL授权和布局回归。
- [x] T014 真实PG重启、模型记忆与已支持游戏制作试玩，tests/real-flow/agent-foundation.spec.ts和artifacts/agent-foundation。
- [x] T015 更新reports/agent-foundation.md、README和planning；SpecKit收敛，不宣称未实现的新玩法完整。
## Dependencies and Strategy
T001→T002→T003→T004→T005；T007→T008→T009；T010→T011→T012；全部汇入T013→T014→T015。先记忆独立可用，再工具与上下文接线，再真实验收。研究代理与主审视并行已结束；实现串行避免共享服务干扰。

## Phase 7: Convergence
- [x] T016 补齐并同步data-model.md与记忆创建时间、上下文版本/来源hash、工具版本/证据类型及错误元数据，增加契约回归；对应FR-001/FR-004/FR-005与plan数据模型 (partial, MEDIUM)。
