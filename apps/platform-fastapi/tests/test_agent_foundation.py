import copy
import json

import pytest

from gamerhub_api.pi.context import ContextAssembler
from gamerhub_api.pi.memory import MemoryService, select_memories
from gamerhub_api.pi.registry import ToolRegistry, ToolSpec, ToolError
from gamerhub_api.pi.repository import AgentStateError


class MemoryRepositoryFixture:
    def __init__(self):
        self.documents = {}
    async def get_memory(self, project_id):
        if project_id not in ('one', 'two'):
            raise AgentStateError('NOT_FOUND', 404)
        return copy.deepcopy(self.documents.get(project_id, {'revision': 0, 'items': []}))
    async def save_memory(self, project_id, revision, items):
        current = await self.get_memory(project_id)
        if current['revision'] != revision:
            raise AgentStateError('MEMORY_CHANGED', 409)
        self.documents[project_id] = {'revision': revision + 1, 'items': copy.deepcopy(items)}
        return copy.deepcopy(self.documents[project_id])
    async def knowledge(self, project_id, run_id=None):
        return {'projectId': project_id, 'memory': await self.get_memory(project_id), 'confirmedSpec': None, 'completedTasks': []}


@pytest.mark.asyncio
async def test_memory_survives_service_restart_and_delete_cannot_resurrect():
    repo = MemoryRepositoryFixture()
    service = MemoryService(repo)
    first = await service.change('one', {'revision': 0, 'operation': 'upsert', 'kind': 'constraint', 'content': '不含血腥画面，失败后可重试'})
    saved_id = first['items'][0]['id']
    created_at = first['items'][0]['createdAt']
    again = MemoryService(repo)
    assert (await again.get('one'))['items'][0]['content'].startswith('不含血腥')
    with pytest.raises(AgentStateError, match='MEMORY_CHANGED'):
        await again.change('one', {'revision': 0, 'operation': 'delete', 'id': saved_id})
    changed = await again.change('one', {'revision': 1, 'operation': 'upsert', 'id': saved_id, 'kind': 'constraint', 'content': '采用轻松的失败反馈'})
    assert changed['items'][0]['revision'] == 2
    assert changed['items'][0]['createdAt'] == created_at
    deleted = await again.change('one', {'revision': 2, 'operation': 'delete', 'id': saved_id})
    assert deleted['items'] == []
    assert select_memories(await repo.get_memory('one'), '失败') == []
    assert repo.documents['one']['items'][0]['content'] == ''
    assert (await again.get('two'))['items'] == []
    with pytest.raises(AgentStateError, match='NOT_FOUND'):
        await again.get('foreign')


def test_long_chinese_design_keeps_current_goal_and_sourced_memory_in_budget():
    messages = [{'role': 'system', 'content': '只讨论，确认前不能制作。'}]
    for i in range(40):
        messages += [{'role': 'user', 'content': f'第{i}轮，讨论美术。' * 40}, {'role': 'assistant', 'content': '候选建议。' * 40}]
    messages += [{'role': 'user', 'content': '继续设计，并遵守保存的偏好。'}]
    memory = {'revision': 7, 'items': [{'id': 'm1', 'kind': 'constraint', 'content': '不含血腥，代号蓝莓星球', 'source': 'user', 'status': 'active', 'revision': 1}]}
    context = ContextAssembler(budget_bytes=14000).design(messages, {'projectId': 'one', 'memory': memory})
    assert '蓝莓星球' in context['prompt'] and '继续设计' in context['prompt']
    assert context['report']['usedBytes'] <= 14000
    assert context['report']['droppedGroups'] > 0
    assert context['report']['memoryRevision'] == 7
    assert context['report']['policyVersion'] == '1.0'
    assert len(context['report']['sourceHash']) == 64


def test_execution_context_keeps_whole_parallel_tool_batch():
    history = [{'role': 'user', 'content': '旧内容' * 10000}, {'role': 'assistant', 'content': [{'type': 'text', 'text': '旧回答'}]}]
    recent = [{'role': 'user', 'content': '检查当前问题'},
              {'role': 'assistant', 'content': [{'type': 'toolCall', 'id': 'a', 'name': 'read', 'arguments': {}}, {'type': 'toolCall', 'id': 'b', 'name': 'read', 'arguments': {}}], 'reasoning_content': 'opaque-provider-field'},
              {'role': 'toolResult', 'toolCallId': 'a', 'toolName': 'read', 'content': [{'type': 'text', 'text': '诊断A'}], 'isError': False},
              {'role': 'toolResult', 'toolCallId': 'b', 'toolName': 'read', 'content': [{'type': 'text', 'text': '错误B'}], 'isError': True}]
    result = ContextAssembler(budget_bytes=6000).execution(history + recent, {'memory': {'revision': 0, 'items': []}}, {'task': '修复'}, [], '规则')
    assert result['messages'][-4:] == recent
    assert result['report']['usedBytes'] <= 6000
    with pytest.raises(AgentStateError, match='CONTEXT_TOOL_PAIR_INVALID'):
        ContextAssembler().execution(recent[:-1], {'memory': {'revision': 0, 'items': []}}, {}, [], '')


@pytest.mark.asyncio
async def test_registry_enforces_schema_phase_and_failure_receipt():
    calls = []
    async def execute(args):
        calls.append(args)
        return {'exitCode': 7, 'timedOut': False, 'output': '错误日志' * 2000}
    registry = ToolRegistry()
    registry.register(ToolSpec(name='check', description='检查', parameters={'type': 'object', 'properties': {'count': {'type': 'integer', 'minimum': 1}}, 'required': ['count'], 'additionalProperties': False}, phases=frozenset({'repair'}), safety_class='read_only', timeout_seconds=2, max_output_bytes=1500), execute)
    assert registry.describe()[0]['version'] == '1.0'
    assert registry.describe()[0]['evidenceKind'] == 'structured_result'
    assert ToolError('TOOL_ARGUMENTS_INVALID').retryable
    with pytest.raises(ToolError, match='TOOL_PHASE_DENIED'):
        await registry.invoke('check', {'count': 1}, phase='design')
    with pytest.raises(ToolError, match='TOOL_ARGUMENTS_INVALID'):
        await registry.invoke('check', {'count': True, 'extra': 'x'}, phase='repair')
    assert calls == []
    result = await registry.invoke('check', {'count': 1}, phase='repair')
    assert result['exitCode'] == 7 and result['truncated']
    assert len(json.dumps(result, ensure_ascii=False).encode()) <= 1500
    with pytest.raises(ToolError, match='TOOL_NOT_ALLOWED'):
        await registry.invoke('unknown', {}, phase='repair')


@pytest.mark.asyncio
async def test_registry_timeout_does_not_leave_handler_running():
    import asyncio
    ended = asyncio.Event()
    async def slow(_args):
        try:
            await asyncio.sleep(20)
        finally:
            ended.set()
    registry = ToolRegistry()
    registry.register(ToolSpec('slow', 'slow', {'type': 'object'}, frozenset({'repair'}), 'read_only', timeout_seconds=.02), slow)
    with pytest.raises(ToolError, match='TOOL_TIMEOUT'):
        await registry.invoke('slow', {}, phase='repair')
    assert ended.is_set()


def test_constraints_cannot_be_silently_dropped_to_fit_budget():
    memories = [{'id': str(i), 'revision': 1, 'kind': 'constraint', 'source': 'user', 'status': 'active', 'content': '必须保留的需求' * 100} for i in range(30)]
    with pytest.raises(AgentStateError, match='CONTEXT_BUDGET_EXCEEDED'):
        ContextAssembler(6000).design([{'role': 'user', 'content': '制作'}], {'memory': {'revision': 1, 'items': memories}})


@pytest.mark.asyncio
async def test_memory_api_auth_revision_and_isolation():
    import httpx
    from gamerhub_api.app import create_app
    one, two = '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002'
    class ApiRepository(MemoryRepositoryFixture):
        async def get_memory(self, project_id):
            if project_id != one:
                raise AgentStateError('NOT_FOUND', 404)
            return copy.deepcopy(self.documents.get(project_id, {'revision': 0, 'items': []}))
    app = create_app(bridge=object(), bearer_token='test-only-token', agent_repository=ApiRepository())
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
        url = f'/v1/projects/{one}/agent/memory'
        assert (await client.get(url)).status_code == 401
        client.headers['authorization'] = 'Bearer test-only-token'
        assert (await client.get(f'/v1/projects/{two}/agent/memory')).status_code == 404
        body = {'revision': 0, 'operation': 'upsert', 'kind': 'decision', 'content': '失败可以重试'}
        response = await client.post(url, json=body)
        assert response.status_code == 200
        assert (await client.post(url, json=body)).status_code == 409
        assert (await client.post(url, json={**body, 'revision': 1, 'source': 'system'})).status_code == 400
        document = response.json()
        deleted = await client.post(url, json={'revision': 1, 'operation': 'delete', 'id': document['items'][0]['id']})
        assert deleted.json()['items'] == []
        assert '失败可以重试' not in (await client.get(url)).text
        assert (await client.get(f'/v1/projects/{one}/agent/tools')).json()['tools'][0]['name'] == 'execute_action'


@pytest.mark.asyncio
async def test_production_design_uses_memory_and_refuses_stale_result():
    from gamerhub_api.pi.service import PiService
    repo = MemoryRepositoryFixture()
    await MemoryService(repo).change('one', {'revision': 0, 'operation': 'upsert', 'kind': 'constraint', 'content': '蓝莓星球'})
    class Client:
        mutate = False
        async def run(self, request, **_kwargs):
            assert '蓝莓星球' in request['prompt']
            if self.mutate:
                repo.documents['one']['revision'] += 1
            return {'text': '{}', 'runtime': 'test-fixture', 'version': 'test-fixture'}
    client = Client()
    service = PiService(None, client, repository=repo)
    params = {'runId': 'design', 'context': {'projectId': 'one'}, 'messages': [{'role': 'user', 'content': '继续'}]}
    result = await service.design(params)
    assert result['contextReport']['memoryIds']
    client.mutate = True
    with pytest.raises(AgentStateError, match='CONTEXT_CHANGED'):
        await service.design(params)


@pytest.mark.asyncio
async def test_cancel_while_borrowing_database_connection_releases_it():
    import asyncio
    import threading
    from gamerhub_api.pi.repository import threaded_context
    started, release, exited = threading.Event(), threading.Event(), threading.Event()
    class Manager:
        def __enter__(self):
            started.set()
            release.wait(3)
            return self
        def __exit__(self, *args):
            exited.set()
    async def borrow():
        async with threaded_context(Manager()):
            pytest.fail('Cancelled borrower must not start a transaction')
    task = asyncio.create_task(borrow())
    await asyncio.to_thread(started.wait, 2)
    task.cancel()
    release.set()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert exited.is_set()

def test_oversized_completed_code_batch_archives_whole_messages_and_keeps_receipts():
    from gamerhub_api.pi.context import encoded
    original = [
        {'role': 'user', 'content': 'implement approved mechanic'},
        {'role': 'assistant', 'content': [{'type': 'thinking', 'thinking': 'opaque' * 14000}, {'type': 'toolCall', 'id': 'read', 'name': 'workspace_read', 'arguments': {'path': 'Assets/Game/Scripts/Game.cs'}}]},
        {'role': 'toolResult', 'toolCallId': 'read', 'toolName': 'workspace_read', 'content': [{'type': 'text', 'text': json.dumps({'path': 'Assets/Game/Scripts/Game.cs', 'hash': 'abc', 'offset': 0, 'nextOffset': None, 'content': 'public class Game {}' * 500})}], 'isError': False},
    ]
    before = copy.deepcopy(original)
    projected = ContextAssembler(14000).execution(original, {'projectId':'one','memory':{'revision':0,'items':[]},'confirmedSpec':{'name':'confirmed'}}, {'description':'add reward with cooldown'}, [], 'rules')
    assert original == before
    assert projected['report']['usedBytes'] <= 14000
    assert projected['report']['droppedGroups'] >= 1
    assert projected['report']['retainedGroups'] == 0
    capsule = json.loads(projected['messages'][0]['content'])
    assert capsule['confirmedTask']['description'] == 'add reward with cooldown'
    assert capsule['recentToolReceipts'][-1]['hash'] == 'abc'
    assert capsule['recentCodeObservation']['content'].startswith('public class Game')
    assert capsule['recentCodeObservation']['nextOffset'] > 0
    assert len(encoded(projected['messages'])) < 14000
