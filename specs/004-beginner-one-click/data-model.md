# State
- Startup: checking → preparing → starting → ready / action-required；互斥锁阻止同时初始化。
- ServiceProbe: offline / ready / blocked / foreign，身份区分本项目FastAPI及Studio。
- UnityReadiness: editorFound、webModuleFound、templateFound，返回公共错误码，不暴露本地路径；许可未推断。
- StudioReadiness: 对话/制作/保存分别显示连接和可用事实，失败可重试。
