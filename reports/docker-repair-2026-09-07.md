# Docker Desktop 修复记录

2026-09-07，本机 Docker Desktop 在启动 Inference manager 时，无法移除 `dockerInference` 通信文件。绕过该处后，同类错误出现在 `docker-secrets-engine/engine.sock`。两个文件为残留的零字节 reparse point；单独改名失败，改名其临时父目录后可重新创建通信文件。

已执行 `scripts/repair-docker-sockets.ps1`：核对 Docker 进程安装路径与临时目录边界，停止相关进程，把临时目录改名备份，创建新目录并重新启动 Docker。没有删除虚拟磁盘、注销 WSL 或再次执行恢复出厂设置。

保留的备份目录：

- `C:/Users/cxc/AppData/Local/Docker/run-stale-20260907-220405`
- `C:/Users/cxc/AppData/Local/Docker/run-stale-20260907-220604`
- `C:/Users/cxc/AppData/Local/docker-secrets-engine-stale-20260907-220604`

验证：Docker Engine 返回 29.6.1；PostgreSQL、Redis、MinIO、OTel 四个容器正常启动；全部数据库迁移完成；FastAPI 与 Next.js 启动成功。额外修复了 Pi 接线缺少 workspace 依赖，以及内部进程退出后 HTTP 服务仍启动的竞态，并新增回归测试。

数据情况：用户已确认在本次修复前手动执行恢复出厂设置。修复后首次检查容器与数据卷列表均为空，需要重新下载镜像和创建数据库。工程源码、`unity/LocalProjects` 与历史本地构建仍在；未找到用户原项目的完整数据库备份，因此没有宣称恢复原有对话和数据库历史。

相关现象在 [Docker 问题跟踪 #527](https://github.com/docker/desktop-feedback/issues/527) 中也有报告。本次结论以本机日志、文件检查与引擎启动结果为依据。
