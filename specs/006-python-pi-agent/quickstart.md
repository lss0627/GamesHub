# Validation
安装根pnpm依赖与apps/platform-fastapi/requirements.txt，使用现有.env.local（不得复制到证据）。pnpm start:local --no-open启动。
Python测试：.venv/Scripts/python -m pytest apps/platform-fastapi/tests（设置PYTHONPATH=apps/platform-fastapi）。
运行Pi真实检查脚本，验证官方版本、模型工具调用、编译失败→修复→成功证据。创作台已有项目多轮讨论并确认制作，查看工具进度，试玩并停止/恢复，已发布版本仍可访问。
不得把fixture、HTTP包装或仅模型API成功作为Pi已接通证据。
