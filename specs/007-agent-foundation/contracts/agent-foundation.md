# Contracts
GET /v1/projects/{projectId}/agent/memory 返回revision/items/derived/limits，无删除内容或推理。
POST 同路径接收revision/id?/operation(upsert|delete)/kind?/content?；400无效、404无归属、409冲突。沿用认证。
GET /v1/projects/{projectId}/agent/tools 返回安全工具元数据，先核对项目，无机器路径。
ModelRequest.context.projectId由业务设置；执行以真实run项目为准。Pi私有context_request请求Python投影；预算失败停止，不回退超长原文。上下文事件只统计与来源ID。
工具错误进入Pi isError；project_context/memory_search不接收任意projectId；schema与执行均由Python校验。
