# Implementation Plan: FastAPI 与自动素材工作室

**Feature**: 002-fastapi-asset-studio | **Date**: 2026-09-06 | **Spec**: [spec.md](spec.md)

## Summary
FastAPI 是唯一活跃 HTTP 后端，明确注册项目、对话、任务、版本、素材、素材计划与试玩路由。Python 服务负责请求验证、鉴权、素材计划与候选生成、图片解码及文件响应；常驻无 HTTP 的 TypeScript 领域/Unity Worker 进程通过白名单 stdio RPC 复用现有事务、幂等与引擎逻辑。不是转发到 Fastify 的代理，保留 TS 领域代码不声称全 Python。

## Technical Context
- Python 3.12，FastAPI / Uvicorn / Pydantic / httpx / Pillow；Next.js/React/TypeScript 前端；Unity 6000.0.80f1。
- PostgreSQL 为权威存储，Redis 唤醒，S3 图片存储；新增 project_art_plans，复用 assets / game_spec_versions。
- pytest、Vitest、Playwright、真实 Unity + PG 验收。关键测试先失败后通过。
- 本机 Windows 开发，API 3001 与兼容既有链接的 preview 3010 均由 Python 承担。
- RPC 并行 request ID 匹配、边界超时 150 秒以上；图片生成后台任务状态持久化；运行器遵守现有项目租约。
- 当前完整交付范围为 2D Runner 四个角色素材；保留其他模板扩展接口。

## Constitution Check
- Reusable boundaries: 保留引擎/模型/领域边界，避免重写已验证事务。
- Evidence: 成功依赖真实构建与版本提交；候选、选择、已应用分离。
- Test-first: 迁移契约、CAS/素材绑定测试先失败后实施。
- Durable and scoped: 项目归属检查 + PG RLS + revision CAS；素材内容不可变。
- Recoverable: 先选后确认，Spec 包含 asset ID 与指纹，构建从快照取素材；恢复版本取历史快照。
- Workflow: 本次用户明确授权迁移，实施任务使用本特性 tasks.md，001 的既有结果保留；见 research.md 的迁移记录。商业许可范围不变。
- Phase 1 recheck: PASS，无未决实现澄清。

## Project Structure
- apps/platform-fastapi/gamerhub_api/{app,bridge,models,art,providers,content,serve}.py
- apps/platform-fastapi/tests/ 及 requirements.txt / README.md
- apps/local-dev/src/{rpc-server,art-store,apply-art}.ts
- apps/platform-api/src/services/design-service.ts （复用并增加素材快照）
- apps/studio-web/src/features/creator/{ArtStudio,GuidedStudio}.tsx
- packages/game-spec/src/art-plan.ts / design-document.ts
- infra/migrations/011_art_plans.sql
- tests/unit/asset-bindings.test.ts，tests/real-flow/art-creation-cycle.spec.ts
- scripts/start-fastapi.ts 与原启动脚本切换。

## Implementation Strategy
US1 先建立 Python HTTP 与无 HTTP 的 Worker 边界，保留旧运行时直到新测试通过再切换。US2 提供原生 Python 美术工作流和内置/HTTP 生成 provider。US3 将选中素材写入 Spec 并在每次构建按其恢复；US4 完成新手界面、启动文档和真实验收。

## Complexity Tracking
混合语言为显式边界：复用现有 Unity/PG 状态机，FastAPI 负责 HTTP 及新的素材业务。全部领域移植 Python 会同时改动大量已验证事务，暂不作为框架迁移的隐含要求。旧 Fastify 仅保留兼容测试入口，默认启动不监听任何 Fastify 端口。
