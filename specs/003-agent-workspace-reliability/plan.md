# Implementation Plan: Agent 与工作台可靠性

## Summary
保留 FastAPI / stdio domain / Unity Worker，通过服务端准入、Agent状态语义和前端一致性修复完善现有端到端流程。

## Technical Context
TypeScript、Python3.12/FastAPI、React/Next.js、PostgreSQL、真实Unity沿用现有版本。无新外部依赖、无数据库迁移。CodeGraph工具不可调用，使用已知源码和测试。

## Constitution Check
可复用边界保留；成功依赖已提交状态/证据；关键修复先失败回归；项目权限及事务锁保护；控制遵循安全边界并保留旧试玩。用户已授权003优化，002记录不改写。商业许可不变。

## Design
1. DesignService增加事务内活跃任务检查，模型调用前快速拒绝，历史保留而模型上下文有界。
2. AgentKernel/Worker依据独立研究修复可证实的控制/失败恢复缺陷，保持租约和发布原子提交。
3. GuidedStudio独立数据恢复、revision/epoch合并、草稿持久化、连接状态、暂停/继续入口。
4. 基于RunJourney显示实际步骤，修复重试后仍标失败的投影。
5. ArtStudio最近候选优先、旧候选可查，父组件按applied资产映射仓库实际状态。

## Structure
apps/platform-api/src/services/design-service.ts
packages/agent-runtime/src/kernel/kernel.ts
apps/orchestrator-worker/src/worker.ts
apps/studio-web/src/features/creator/{GuidedStudio,ArtStudio}.tsx
apps/studio-web/src/features/runs/{RunJourney,AgentActivity}.tsx
apps/studio-web/src/features/creator/guided-studio.css
tests/unit, tests/ui, tests/real-flow

## Validation
pytest/Vitest/Playwright；新失败回归、真实Agent/Unity流程、移动端无横向溢出。完成后SpecKit收敛并更新报告。研究已选择复用现有契约和工具，不需要用户另作技术决定。
