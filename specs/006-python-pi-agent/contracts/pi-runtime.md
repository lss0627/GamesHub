# Pi process contract
Python→Node：start {sessionId,model,systemPrompt,messages,prompt,tools,maxTurns,maxTokens}、tool_result {id,result,error}、ack {id}、abort。
Node→Python：ready {runtime,version}、event {id,event}（message_end需要Python持久化后ack）、tool_request {id,name,args}、completed {messages,text,usage}或failed {code}。
严格LF JSONL；消息限长；stdout只协议。无凭证进入JSON，宿主以环境读取指定模型凭证。工具参数JSON Schema由服务端定义。Python与TS领域沿用私有stdio并增加python_request/python_response，callback只在当前请求存续期有效。
CLI工具：cli_run {operation:compile|test, testFilter?}，命令路径和工程根由服务端绑定，参数列表执行；结构化输出exitCode、diagnostics、tests、timedOut。文件读写只允许当前项目游戏脚本及确认Spec，越界、symlink、未知操作拒绝。
