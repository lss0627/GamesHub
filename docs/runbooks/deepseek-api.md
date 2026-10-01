# DeepSeek API 配置

GamerHub 的 DeepSeek 接入只在服务端运行。Studio 浏览器不会接触 API Key，模型输出也只能修改经过本地 schema 校验的 Runner 白名单参数，不能直接执行文件、命令或 Unity 操作。

## 本地配置

1. 打开仓库根目录的 `.env.local`。
2. 找到以下空占位，只在等号右侧粘贴完整 Key：

   ```dotenv
   DEEPSEEK_API_KEY=
   ```

3. 保持其余模型配置不变：

   ```dotenv
   MODEL_PROVIDER_ID=deepseek
   MODEL_PROVIDER_ENDPOINT=https://api.deepseek.com
   MODEL_PROVIDER_MODEL_ID=deepseek-v4-pro
   MODEL_CONTEXT_WINDOW=1000000
   MODEL_MAX_OUTPUT_TOKENS=16384
   MODEL_REQUEST_TIMEOUT_MS=120000
   MODEL_API_KEY_REF=secret://env/DEEPSEEK_API_KEY
   ```

4. 验证配置与账户连通性：

   ```powershell
   pnpm model:doctor
   ```

5. 重启开发服务：

   ```powershell
   pnpm dev
   ```

不要把 Key 写入 `.env.example`、前端变量、源码、聊天消息、日志或截图，也不要使用 `NEXT_PUBLIC_` 前缀。`.env.local` 已被 `.gitignore` 排除。

## 运行语义

- 本地开发：选择 DeepSeek 但 Key 为空时，Worker 明确降级为 `fixture` 并报告 `awaitingSecret: true`；这让 UI/API 联调仍可运行，但不构成真实模型或发布证据。
- 生产环境：禁止 fixture 降级。Provider、HTTPS endpoint、模型、secret reference 或 Key 任一缺失，Worker 都会 fail-closed。
- `pnpm model:doctor` 会检查模型列表、确认当前模型存在，并调用 DeepSeek 官方 `/user/balance` 接口验证账户是否有可用余额；它不会发起计费生成，也只输出 Provider、模型、endpoint、可用性和隐藏后的凭证状态，绝不打印 Key。余额不足时命令会以非零状态 fail-closed。

## 官方资料

- [DeepSeek API 文档](https://api-docs.deepseek.com/)
- [模型与定价](https://api-docs.deepseek.com/quick_start/pricing/)
- [List Models API](https://api-docs.deepseek.com/api/list-models/)
- [错误码](https://api-docs.deepseek.com/quick_start/error_codes/)
