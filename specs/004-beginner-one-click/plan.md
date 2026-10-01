# Implementation Plan: 小白一键启动
## Summary
复用已有安装/启动能力，Windows入口→依赖检查→Docker→Unity/WebGL→配置/迁移→FastAPI/Studio→真实就绪。后台服务隐藏运行，启动互斥和身份探测防重复与未知进程误杀。
## Technical Context
已有TypeScript/Node24、PowerShell、Python3.12/FastAPI、Next、Postgres/Redis/MinIO和Unity6000.0.80f1。不新增服务平台，无数据库迁移。
## Constitution Check
边界复用、关键失败回归先行、项目数据不删除、成功以真实执行为证；不会代替许可激活。无Git；忽略文件保留env/venv/node_modules/artifacts。
## Structure
scripts/start-gamerhub.ts、scripts/start-gamerhub.ps1、Start-GamerHub.cmd；apps/local-dev/src/local-readiness.ts/rpc-server.ts；GuidedStudio与新的CreationReadiness卡片；operator容量页移除固定实时数据。

真实验收发现的恢复路径：real-unity.ts 抽出不依赖编辑器的已发布试玩读取；art-store.ts 对模型无效清单增加最多一次重试、完整输出预算和安全错误映射。数据库启动等待 Compose 健康后迁移；Next 生产构建环境与本地 Worker 环境分离。已有游戏、候选和配置保持保存。
## Validation
启动身份/互斥/组件检测单元回归、UI阻塞/恢复、冷启动及重复启动、新建和素材真实流程、已有控制/数据安全门禁。依研究逐步实施全部故事。
