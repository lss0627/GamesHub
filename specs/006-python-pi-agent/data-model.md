# Data model
PiSession：run/session/action标识、messages、状态、官方版本；消息仅内部存储。ToolLedger：callId、工具名、argsHash、status、output；完成后重放，中断副作用要求重新核对。现有RunEvents承载用户可见进度，已有检查点存储复用。
状态：idle→running→completed/failed/cancelled；tool pending→running→completed/failed。工具结果成功不等于游戏发布成功。请求受现有owner/project/run关联限制。
