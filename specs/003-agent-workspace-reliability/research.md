# Research

## 前端同步
Decision：保留现有 REST/SSE 契约，独立轮询各资源，操作 epoch 阻止旧读取覆盖，Design 按 revision 合并。理由：不增加第二个事实源，不因辅助服务失败冻结任务。替代方案：新增聚合 API 会扩大迁移边界，当前不必。

## 执行呈现
Decision：复用 RunJourney 的任务目录和投影，修复最新事件优先语义；工作台使用简明步骤列表并提供暂停/恢复。理由：已有真实 Agent 事件可用，无需制造进度。原有控制使用任务安全边界，界面明确说明等待。

## 对话准入
Decision：模型调用前检查活跃任务，提交草案事务锁项目并重新检查。确认保留其独立幂等事务，不在外层持有项目锁调用另一事务。历史完整保存，模型仅发送最近24条消息和当前brief。替代：截断数据库历史会丢失用户数据，不采用。

## 独立研究
SpecKit plan 调度 Agent 检查 Kernel/Worker/Unity。发现已完成试玩的动作虽然能重放，但新建执行器丢失 evidenceByRun/playtestRunIds；实施持久结果中的 durablePlaytestRunId 和 restoreResult 恢复入口。未完成的 Unity 变更无法证明幂等，恢复时返回 RECOVERY_REQUIRES_RECONCILIATION，避免盲目重做。引擎错误保留规范错误码/公开文案；取消等待当前操作结束并释放租约后写入取消检查点。没有引入新的调度系统。

确认 DesignService 与 ArtStore 均按 design → project → art 的锁顺序进行更新；确认入队使用既有独立幂等事务，避免外层项目锁与入队事务自锁。
