# Validation
双击Start-GamerHub.cmd，或pnpm start:local --no-open。冷启动检查页面及3001/3010健康；重复运行检查PID不增加。缺少基础工具或Unity登录需求必须明确反馈。

pnpm test、pnpm test:fastapi、pnpm typecheck、pnpm lint、pnpm test:ui；设置GAMERHUB_REAL_FLOW=1，使用playwright.flow.config.ts运行新建与素材两条真实流程，素材流程设置GAMERHUB_FLOW_PAUSE_ONCE=1。
