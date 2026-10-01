# Contracts

现有 FastAPI 路由不变。design/messages和prepare在活跃任务期间返回409 PROJECT_RUN_ACTIVE，不修改对话；确认重试保持同一Run。

运行步骤读取既有events SSE，按sequence合并去重，忽略无有效序号或类型的记录，不显示原始工具参数。暂停/继续/停止使用现有POST控制接口并等待实际run.status；成功必须来自服务器。

辅助资源失败不清空已有值、不阻塞run轮询；网络提示在对应读取成功后自动消失。操作错误持续到下次操作或用户关闭。较旧Design revision不得覆盖较新状态。

保留所有现有按钮入口、上传、Spec确认、历史恢复及WebGL sandbox契约。
