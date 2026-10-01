# Implementation Plan: 多类型游戏Agent
## Summary
共享游戏能力目录→多类型Brief→已确认Spec→按类型/系统生成任务→已注册Unity运行时→对应PlayMode断言→真实WebGL。保留FastAPI HTTP、TS领域/Worker stdio、AgentKernel、PG/Redis/MinIO。
## Technical Context
Node24/TS、Python3.12/FastAPI、Next、Unity6000.0.80f1、WebGL。无新数据库表，现有JSON文档扩展可选字段。三个运行时模块：Runner、Arena（survivor/top_down_shooter）、Clicker。其余genre是设计可保存但执行未接入。
## Constitution Check
用户明确授权多类型范围，宪法版本1.1仅更新原Runner范围；保持确认、租户、证据、安全边界。不运行模型生成的任意主机代码。已有Runner版本兼容。
## Structure
packages/game-spec/src/game-capabilities.ts、design-document.ts；packages/game-planner；DesignService；real-unity/UnityTaskExecutor；Unity模板新增模块/测试；GuidedStudio、ArtStudio；reports架构与真实验收。
## Validation
模型/草案兼容与能力门禁先测；按Spec任务不再固定；PlayMode最小用例计数防空成功；Unity只读WebGL快照验证实际击杀/经验/升级；旧Runner回归；完整前后端门禁。
