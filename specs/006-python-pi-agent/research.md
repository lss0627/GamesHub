# Research
Decision: Python托管官方Pi Agent Core0.85.1和pi-ai0.85.1最小Node宿主。Rationale: 官方实现是TS，无官方Python核心；coding-agent RPC多出工具和扩展层，本项目需要Python工具边界。来源https://github.com/earendil-works/pi/tree/main/packages/agent。
Decision: subscriber消息落盘后ack，保存完整私有transcript；sessionId不是持久状态；工具失败throw以产生isError。prompt完成须再检查stopReason。取消清队列、abort、waitForIdle及子进程清理。来源https://github.com/earendil-works/pi/blob/main/packages/agent/src/agent.ts。
Decision: 使用现有DeepSeek配置，Pi官方OpenAI兼容provider；保留thinking元数据，用户界面只显示工具与最终回复。来源https://github.com/earendil-works/pi/blob/main/packages/ai/src/providers/deepseek.ts。
已按SpecKit派出独立协议研究并整合其结论；npm view验证包版本0.85.1。无未解决澄清项。
