# Data model
project_agent_memory(project_id PK FK,revision,document,updated_at)：items含id、kind(preference/constraint/decision)、content、source(user)、status(active/deleted)、revision、createdAt/updatedAt。旧记录缺少createdAt时返回null，不编造日期。删除清空内容保留墓碑，最多200条活动记录和200条空内容墓碑。文档revision CAS，冲突MEMORY_CHANGED。
agent_checkpoints(run_id PK FK,project_id FK,revision,document,content_hash,updated_at)：最新恢复状态/工具账本/provider消息，事务核对owner和run/project；旧audit可迁移读取，后续不重复存完整事件。
KnowledgeBundle(projectId,memory{revision,items},confirmedSpec{id,spec},completedTasks)：当前run来源Spec优先，不跨项目缓存。最近失败由完整工具消息组提供，不重复派生一份易过期的失败摘要。
ContextReport(policyVersion,budgetMethod,budgetBytes,usedBytes,retainedGroups,droppedGroups,sourceHash,archiveHash,memoryIds,memoryRevision)：仅元数据，不含推理。sourceHash指当前来源胶囊，archiveHash指裁剪掉的完整交互组。
ToolSpec(name,version,description,parameters,phases,safetyClass,timeoutSeconds,maxOutputBytes,replay,evidenceKind)；ToolError(code,message,retryable)，裁剪不丢exitCode/isError。
