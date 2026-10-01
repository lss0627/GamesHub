# Implementation Plan: Agent上下文、记忆与工具
Date: 2026-09-08 | Spec: spec.md
## Summary
沿用Python/FastAPI与官方Pi0.85.1薄宿主，增加生产使用的上下文、PG项目记忆和统一工具注册。复用已安装psycopg/pool，不建立第二个事实库；TS领域/Unity业务继续复用。
## Technical Context
Python3.12、Pydantic2、psycopg3.3.5/pool3.3.1、jsonschema4.26.0；Node24/Pi0.85.1、Next。pytest/Vitest/Playwright。当前本地多项目部署；200条记忆/项目，单条1200字符；预算按保守UTF8字节上界，包括系统、工具和当前输入，预留输出空间。
## Constitution Check
保持边界；证据决定成功；先失败测试；所有PG事务设置RLS并显式owner/project/run核对；只注册工具、写前备份、安全停止。删除记忆不删原始对话，但禁止旧摘要自动复活事实。无外部记忆服务。
## Project Structure
Python pi/context.py、memory.py、repository.py、registry.py及service/client/tools；Node host用官方transformContext；ModelRequest增加可选项目context；DesignService不先截24条。FastAPI记忆API、前端ProjectMemory、infra/migrations/012_agent_foundation.sql、测试和reports/agent-foundation.md。
## Decisions
1 Python单控制器；Pi已有AgentHarness，此轮不引入第二套会话/恢复控制器。
2 PG记忆/最新检查点表；旧audit检查点可迁移读取，之后只写引用事件。
3 用户记忆显式记录、可改可删，CAS修订和空内容墓碑；确认Spec/验证结果动态派生；模型猜测不升级为事实。
4 当前项目过滤+来源有效性+优先级/中英文词项检索；接口可替换，暂不引入向量服务。
5 当前要求、确认Spec、记忆、完成步骤、完整交互组分别组装；历史hash索引不伪称语义摘要。必需内容过大明确失败。每轮读取记忆修订，旧运行记忆变化则停止该动作以免带回旧内容。
6 registry负责JSON Schema、阶段、影响、timeout、输出上限和结果；workspace_search代码检索、project_context/memory_search只读工具绑定项目。新玩法仍按真实注册能力。
7 Windows保留支持子进程的事件循环；PG通过最多4连接的同步池与后台线程提供异步接口。正在运行的数据库操作完成后才释放连接，取消事务回滚。工具日志按logId分页回读；200条活动记忆，最多另保留200个空内容删除标记。
## Validation
40轮中文预算、完整工具组、删除失效、CAS/跨owner；工具参数/越权/大输出/取消；真实PG重启和模型记忆、现有Unity制作试玩、前端编辑删除。官方API研究代理已完成；主实现串行。
