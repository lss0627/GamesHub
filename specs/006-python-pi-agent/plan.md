# Implementation Plan: Python托管Pi
## Summary
FastAPI/Python新增Pi会话控制与工具执行；官方pi-agent-core0.85.1/ pi-ai0.85.1通过最小Node JSONL宿主使用。生产DesignService和Worker通过现有stdio的反向请求调用Python，不另加公开HTTP接口。TS领域存储和Unity适配仍复用；删除未使用的Pi/DeepSeek通用HTTP占位包装。
## Technical Context
Python3.12/asyncio/FastAPI，Node24，官方Pi Agent0.85.1，DeepSeek当前配置，Unity6000.0.80f1。前端Next。Python提供argv CLI、路径限定文件工具、消息检查点、预算、退出清理。Agent执行工具→观察结果→继续推理，不用模拟streamFn生产回退。
## Constitution Check
保持模块边界、tenant已确认Run、证据决定成功、测试先行、停止恢复。官方Pi不自带权限层，Python只提供注册工具，无任意主机shell。保留仍在使用的数据/引擎模块以免破坏现有项目。
## Structure
apps/platform-fastapi/gamerhub_api/pi/{client,service,tools}.py；apps/pi-runtime/host.mjs；apps/local-dev/src/python-agent.ts、rpc-server.ts；worker的执行接口改为可注入端口；FastAPI健康信息及前端状态。tests/contract和Python tests。
## Decisions
1 官方Agent Core薄宿主，而非Python仿制或引入完整CLI默认工具。
2 Python拥有会话/工具/限制，TS仅反向RPC暴露已有受控动作/检查点。
3 设计走无副作用Pi会话；制作走带工具的Pi会话。
4 工具失败进入模型修复；成功由结构化返回值及原有证据门禁决定。
5 保留已发布构建及现有PG数据；只删除查明无引用的旧包装，不删除仍使用的领域代码。
6 生命周期有超时、取消、有限步数，持久消息私有，前端不暴露推理/凭证/主机路径。
## Validation
先失败测试Pi真实工具循环、Python路径/CLI/异常/恢复，再生产接线。真实DeepSeek+Unity编译修复、浏览器确认制作试玩、旧项目访问，最后TS/Python/UI门禁和SpecKit收敛。
