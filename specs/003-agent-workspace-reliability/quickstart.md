# Validation

现有依赖和启动按根 README，FastAPI3001、Unity3010、Studio3000。

运行 pnpm test:fastapi、pnpm test、pnpm typecheck、pnpm lint。
现有前端已运行时设置 GAMERHUB_UI_TEST_URL=http://127.0.0.1:3000，然后 pnpm test:ui。

验证辅助接口失败不冻结Run、输入刷新恢复、跨标签方案同步、陈旧读取保护、素材状态准确。控制测试检查暂停安全边界、继续复用已完成步骤、取消不发布。真实测试设置 GAMERHUB_REAL_FLOW=1，运行 playwright.flow.config.ts 对应素材流程；以真实事件/Unity资源/发布版本及截图为证据。
