# Research
- Decision：复用bootstrap、Unity固定版安装、Python安装和基础设施脚本，统一双击入口。避免另建安装平台；已有依赖复用，未知端口不清理。
- Decision：独立Agent审视确认GuidedStudio缺少就绪卡、RPC启动依赖Unity、health固定ready、容量页固定99.9%。延迟创建Unity、用文件/模块探测呈现可验证事实、移除虚假实时声明。
- Decision：就绪检查不宣称许可已激活；真正许可与可玩性以Unity构建/试玩为准，页面解释首次验证。
- Decision：Windows启动器后台服务隐藏运行，进度/日志可查，重复启动按服务身份复用并使用启动互斥锁。失败不删除项目或终止未知进程。
