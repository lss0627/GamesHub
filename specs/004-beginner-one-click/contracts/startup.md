# Contracts
双击Start-GamerHub.cmd或启动GamerHub.cmd；pnpm start:local等价，--no-open用于自动验收。已有基础工具时自动完成依赖、Docker、Unity组件、配置、存储和应用启动。

GET /health增加creationReady与services.unity的组件检测/许可验证说明。缺失Unity仍能启动领域服务并读项目、对话；制作准入返回503 UNITY_NOT_READY。未知端口占用不会触发终止进程。

Studio使用既有/api/gamerhub/health代理；故障提供中文提示与重新检查。普通首页不展示原始运维参数。
