"""Real Pi/model over a 40-round synthetic history and persistent project memory."""
import asyncio
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'apps/platform-fastapi'))
from dotenv import load_dotenv
import httpx
from gamerhub_api.pi.service import PiService


async def main():
    load_dotenv(ROOT / '.env.local')
    evidence = json.loads((ROOT / 'artifacts/agent-foundation/browser-flow.json').read_text('utf8'))
    project_id = evidence['projectId']
    service = PiService(None)
    try:
        knowledge = await service.repository.knowledge(project_id, evidence['runId'])
        assert knowledge['memory']['revision'] == evidence['memory']['revision']
        checkpoint, revision = await service.repository.load_checkpoint(project_id, evidence['runId'])
        assert revision > 0 and all(a['status'] == 'completed' for a in checkpoint['actions'].values())
        messages = [{'role': 'system', 'content': '根据当前项目记忆回答，仅输出JSON：{"rememberedName":"游戏名称","sourceIds":["引用记忆id"]}。历史建议不是当前记忆。'}]
        for number in range(40):
            messages += [{'role': 'user', 'content': f'第{number}轮讨论旧的美术建议。' * 80}, {'role': 'assistant', 'content': '这些都是候选建议，需要用户确认。' * 60}]
        messages.append({'role': 'user', 'content': '按当前项目记忆，我已经确定的游戏名称是什么？'})
        result = await service.design({'runId': 'context-verification', 'context': {'projectId': project_id}, 'messages': messages, 'tokenBudget': 2048})
        text = result['text']
        answer = json.loads(text[text.index('{'):text.rindex('}') + 1])
        assert answer['rememberedName'] == '蓝莓星球'
        assert knowledge['memory']['items'][0]['id'] in answer['sourceIds']
        assert result['contextReport']['droppedGroups'] > 0
        async with httpx.AsyncClient() as client:
            response = await client.get(f'http://127.0.0.1:3000/v1/projects/{project_id}/agent/memory')
            assert response.status_code == 200 and response.json()['revision'] == knowledge['memory']['revision']
        out = {'status': 'passed', 'historySource': '40 synthetic Chinese rounds; real configured model and Pi',
               'projectId': project_id, 'runtime': result['runtime'], 'version': result['version'],
               'answer': answer, 'contextReport': result['contextReport'], 'checkpointRevision': revision,
               'completedActions': len(checkpoint['actions']), 'memorySurvivedBackendRestart': True}
        (ROOT / 'artifacts/agent-foundation/context-restart.json').write_text(json.dumps(out, ensure_ascii=False, indent=2), 'utf8')
        print(json.dumps(out, ensure_ascii=False))
    finally:
        await service.repository.close()


if __name__ == '__main__':
    asyncio.run(main())
