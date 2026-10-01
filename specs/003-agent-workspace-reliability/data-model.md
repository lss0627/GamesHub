# State model

- DesignDocument：结构不变，revision 单调增加，messages完整保存；模型上下文有界。
- Workspace：分别保存 Run/Design/Versions/Assets，连接失败保留各自最后成功值；操作 epoch 是当前页面内的过期响应屏障。
- Draft：localStorage按项目保存未发送文字，发送成功后清空；不会自动发送。
- RunJourney：按事件sequence排序，以每个动作最新结果为准；暂停/停止请求独立于动作成功。
- ArtPlan：既有候选顺序用于最近一轮分组；applied仍来自发布Spec，仓库使用该资产ID集合。
