"""Real Pi + configured model. No mock provider or synthesized Agent events."""
import argparse
import asyncio
import json
import os
import sys
from pathlib import Path
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'apps/platform-fastapi'))
from dotenv import load_dotenv
from gamerhub_api.pi.client import PiClient
from gamerhub_api.pi.tools import WorkspaceTools


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--workspace')
    args = parser.parse_args()
    load_dotenv(ROOT / '.env.local')
    events, calls = [], []
    async def record(event):
        events.append({'type': event['type'], **({'toolName': event['toolName']} if 'toolName' in event else {})})
    if args.workspace:
        workspace = WorkspaceTools(args.workspace)
        definitions = workspace.definitions()
        prompt = ('当前Unity工程有一个故意用于验收的编译错误，位于Assets/Game/Scripts/PiRepairProbe.cs。'
                  '先调用cli_run compile观察真实失败，再读取并修复该文件，然后重新compile验证。'
                  '只改这个文件，不更改其他游戏代码。编译通过后停止。')
        async def tool(name, params, call_id):
            call = {'id': call_id, 'name': name, 'args': {key: value for key, value in params.items() if key != 'content'}}
            calls.append(call)
            try:
                result = await workspace.call(name, params)
                call['result'] = result if name == 'cli_run' else {'success': True}
                return result
            except Exception as error:
                call['error'] = str(error)
                raise
    else:
        definitions = [{'name': 'project_measure', 'description': '返回项目已测试的角色速度。必须调用才能知道结果。', 'parameters': {'type': 'object', 'properties': {}, 'required': [], 'additionalProperties': False}}]
        prompt = '调用project_measure，然后用中文告诉我工具返回的速度，不要猜测。'
        async def tool(name, params, call_id):
            assert name == 'project_measure'
            calls.append({'id': call_id, 'name': name})
            return {'speed': 7.25, 'unit': 'units/second'}
    result = await PiClient().run({'sessionId': str(uuid4()), 'prompt': prompt,
        'systemPrompt': '你是Unity游戏工程助手。使用工具完成任务；失败后读取诊断并修复，不能把失败说成成功。',
        'tools': definitions, 'model': {'id': os.getenv('MODEL_PROVIDER_MODEL_ID'), 'baseUrl': os.getenv('MODEL_PROVIDER_ENDPOINT')},
        'maxTurns': 12}, tool=tool, on_event=record, timeout=900 if args.workspace else 180)
    assert calls and result['runtime'] == 'pi-agent-core'
    if args.workspace:
        checks = [call for call in calls if call['name'] == 'cli_run']
        assert any('error' in call for call in checks)
        assert checks[-1].get('result', {}).get('exitCode') == 0
        assert any(call['name'] == 'workspace_write' and 'result' in call for call in calls)
    else:
        assert '7.25' in result['text']
    out = ROOT / 'artifacts/pi-agent'
    out.mkdir(parents=True, exist_ok=True)
    evidence = {'status': 'passed', 'runtime': result['runtime'], 'version': result['version'], 'calls': calls, 'events': events, 'reply': result['text']}
    (out / ('repair.json' if args.workspace else 'smoke.json')).write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding='utf8')
    print(json.dumps({'status': 'passed', 'runtime': result['runtime'], 'version': result['version'], 'tools': len(calls)}))


if __name__ == '__main__':
    asyncio.run(main())
