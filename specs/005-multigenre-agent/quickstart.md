# Quickstart validation
双击启动项目。新创作讨论幸存者→确认参数→准备素材→确认Spec→制作→试玩移动/击杀/经验/升级/胜负/重玩→修改后重做。点击成长独立构建，旧Runner回归。讨论未实现类型可以保留设计/查看说明，确认不会队列化或降级。
运行pnpm test、test:fastapi、test:ui、typecheck、lint；显式GAMERHUB_REAL_FLOW=1、GAMERHUB_FLOW_PROJECT_ID指定已授权测试的项目，执行playwright.flow.config.ts下的multigenre.spec.ts及legacy-runtime-restore.spec.ts。证据看artifacts/multigenre。只有已保存的幸存者与修改玩法验证均通过，才使用GAMERHUB_FLOW_RESUME_MODIFIED=1续测；完整重新验收时不设置此变量。
