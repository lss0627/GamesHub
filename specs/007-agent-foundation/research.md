# Research
本地官方0.85.1与https://github.com/earendil-works/pi/blob/main/packages/agent/README.md：transformContext每次送模前运行，不改持久state；轮间接口为prepareNextTurnWithContext。官方已有AgentHarness/session/compaction，不能称Pi没有；当前保留Python单控制器避免重复恢复。
工具消息按完整批次保存。官方字符/4估算低估中文，使用UTF8字节上界预算，包含system/tool/currenttask；不是精确token值。历史压缩不作为长期事实或授权。
工具独立校验用jsonschema4.26.0 Draft202012Validator，来源https://pypi.org/project/jsonschema/，schema程序注册且不含动态远程引用。
PG已有事实源，psycopg/pool已锁定；采用最多4连接的线程池适配异步接口，所有事务RLS/显式owner，不建SQLite副本。少量记忆采用词项检索并保留扩展接口。

真实Windows验收发现AsyncConnectionPool不兼容用于子进程的ProactorEventLoop，改为ConnectionPool+asyncio.to_thread，取消时等待正在使用连接的操作结束再回收。官方依据：[Psycopg并发与Windows限制](https://www.psycopg.org/psycopg3/docs/advanced/async.html)、[连接池](https://www.psycopg.org/psycopg3/docs/advanced/pool.html)。不能全局切换Selector，否则会破坏Pi/Unity子进程。
