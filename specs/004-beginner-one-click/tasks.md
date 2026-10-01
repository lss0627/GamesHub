# Tasks: 小白一键启动
## Phase 1 Setup
- [x] T001 建立spec/plan/research与验收契约于specs/004-beginner-one-click/。
## Phase 2 Foundation
- [x] T002 先写组件缺失、服务身份和重复启动保护回归于tests/unit/local-startup.test.ts。
## Phase 3 US1
独立验收：冷启动可用、重复启动复用、未知端口不终止。
- [x] T003 [US1] 实现组件检测与启动互斥工具于apps/local-dev/src/local-readiness.ts、scripts/start-gamerhub.ts。
- [x] T004 [US1] 提供双击入口与依赖/安装/启动集成于Start-GamerHub.cmd、scripts/start-gamerhub.ps1、scripts/start-dev-infra.ts、package.json。
## Phase 4 US2
独立验收：缺少Unity仍可读项目，无法制作时给中文处理步骤。
- [x] T005 [US2] 延迟Unity初始化及制作准入，健康状态反映组件事实于apps/local-dev/src/rpc-server.ts。
- [x] T006 [US2] 就绪卡与故障恢复回归于tests/ui/creation-readiness.spec.ts，接入GuidedStudio.tsx及CreationReadiness.tsx。
- [x] T007 [US2] 移除固定实时指标声明于apps/studio-web/src/app/operator/capacity/page.tsx。
## Phase 5 US3
- [x] T008 [US3] 修复全流程实际发现的问题并运行新建/修改/素材/暂停/试玩/恢复于tests/real-flow/；检查安全停止现有回归。
## Phase 6 Acceptance
- [x] T009 验证冷启动及重复启动、TypeScript/Python/UI/构建于artifacts/，更新README.md及reports/beginner-one-click-2026-09-06.md。
- [x] T010 SpecKit收敛并完成任务和planning记录。
## Dependencies
T001→T002→T003→T004；T003→T005→T006→T007；全部→T008→T009→T010。只读就绪研究与本机恢复独立进行；实施逐故事验证并完成全部范围。


