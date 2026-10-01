# Tasks: Python Pi Agent
## Phase 1 Setup
- [x] T001 规格与官方协议研究于specs/006-python-pi-agent，锁定官方Pi版本。
## Phase 2 Foundation
- [x] T002 先写Python进程、工具失败、路径与CLI回归于apps/platform-fastapi/tests/test_pi_runtime.py。
- [x] T003 实现官方Pi JSONL宿主apps/pi-runtime/host.mjs与Python进程客户端gamerhub_api/pi/client.py。
## Phase 3 US1
独立验收：真实工具调用及网页确认流程使用Pi。
- [x] T004 [US1] Python会话/预算/事件/账本于gamerhub_api/pi/service.py。
- [x] T005 [US1] 生产反向RPC与DesignService/Worker接线于apps/local-dev/src/python-agent.ts、rpc-server.ts及gamerhub_api/bridge.py。
## Phase 4 US2
独立验收：真实Unity编译失败后Agent编辑修复通过。
- [x] T006 [US2] 文件/CLI工具于gamerhub_api/pi/tools.py，结构化参数、进程树取消和日志证据。
- [x] T007 [US2] 编译修复真实验收脚本于scripts/verify-pi-runtime.py，保留artifacts/pi-agent证据。
## Phase 5 US3
独立验收：停止恢复与旧项目可用，无假框架回退。
- [x] T008 [US3] 恢复、预算、停止、异常测试及生产接线于Python tests和worker。
- [x] T009 [US3] 删除已替换旧适配器/冗余配置与失效测试，更新packages/agent-runtime、启动健康与前端RuntimeReadiness。
## Phase 6 Acceptance
- [x] T010 全套门禁、真实网页确认制作试玩、旧项目检查，reports/python-pi-agent.md及planning回填、SpecKit收敛。旧数据恢复未通过，独立追踪T013。
## Dependencies and Strategy
T001→T002→T003→T004→T005→T006→T007→T008→T009→T010。先Pi真实循环，再生产接入，再安全删除。独立研究与主实现并行；同一源码顺序修改。US1为首个可验收增量，完整交付仍须US2/US3。

## Phase 7: Convergence
- [x] T011 用真实Pi项目完成暂停→继续→停止并验证已发布版本保留，回填artifacts/cancel-flow per FR-006、US3（partial，MEDIUM）。
- [x] T012 构建当前前端并检查制作说明的纵向可读排版，回填截图与reports/python-pi-agent.md per FR-008（partial，MEDIUM）。
- [ ] T013 若取得恢复出厂前的数据库备份，恢复至隔离验证环境并核对原项目对话/历史；当前无备份，记录外部数据丢失阻碍，不将新项目代替旧数据验收 per SC-003、US3（partial，HIGH）。
