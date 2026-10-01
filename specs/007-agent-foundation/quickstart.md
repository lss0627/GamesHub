# Validation
pnpm install、pnpm setup:python、pnpm db:migrate、pnpm start:local --no-open。保留.env.local，不复制秘密。
pnpm test:fastapi / pnpm test / pnpm lint / pnpm typecheck / pnpm test:ui。
真实验证tests/real-flow/agent-foundation.spec.ts：保存独特约束、重启询问模型、纠正删除、确认制作试玩；证据artifacts/agent-foundation。
测试仓库明确fixture，生产不回退。旧项目无记忆时返回空用户记忆并保留已确认Spec。
