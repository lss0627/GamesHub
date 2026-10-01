import pytest
from gamerhub_api.pi.client import PiError
from gamerhub_api.pi.tools import WorkspaceTools, build_registry
from test_pi_service import PiService, fixture

def action():
    return {'toolName': 'unity.task.execute', 'safetyClass': 'engine_mutation', 'input': {'task': {
        'id': 'develop-dash', 'type': 'script', 'capabilities': ['gameplay.develop'],
        'related_files': ['Assets/Game/Scripts/Generated/dash.cs', 'Assets/Tests/PlayMode/Generated/dashTests.cs'],
        'validation_method': {'reference': 'GamerHub.Generated.dashTests'}}}}

@pytest.mark.asyncio
async def test_only_declared_development_unlocks_normal_code_tools():
    async def handler(name, args): return {'status': 'read'}
    registry = build_registry(action(), handler)
    assert (await registry.invoke('workspace_list', {}, phase='develop'))['status'] == 'read'
    ordinary = build_registry({'safetyClass': 'engine_mutation', 'toolName': 'unity.task.execute'}, handler)
    with pytest.raises(PiError, match='TOOL_PHASE_DENIED'):
        await ordinary.invoke('workspace_write', {'path': 'Assets/Game/Scripts/a.cs', 'content': '', 'expectedHash': ''}, phase='execute')

@pytest.mark.asyncio
async def test_development_can_author_declared_tests_but_not_replace_curated_tests(tmp_path):
    path = 'Assets/Tests/PlayMode/Generated/dashTests.cs'
    tools = WorkspaceTools(tmp_path, test_paths=[path])
    await tools.call('workspace_write', {'path': path, 'content': 'class dashTests {}', 'expectedHash': ''})
    assert path in (await tools.call('workspace_list', {}))['files']
    for forbidden in ['Assets/Tests/PlayMode/RunnerPlayModeTests.cs', 'Assets/Tests/PlayMode/Generated/otherTests.cs']:
        with pytest.raises(PiError, match='PATH_NOT_ALLOWED'):
            await tools.call('workspace_write', {'path': forbidden, 'content': 'bad', 'expectedHash': ''})

@pytest.mark.asyncio
async def test_service_enters_develop_before_any_failed_action(tmp_path, monkeypatch):
    database, callback, params = fixture()
    params['action'].update(action())
    params['policy'].update(allowedToolNames=['unity.task.execute'], allowedSafetyClasses=['engine_mutation'])
    monkeypatch.setenv('GAMERHUB_LOCAL_UNITY_WORKSPACE_ROOT', str(tmp_path))
    class Loop:
        async def run(self, request, *, tool, **kwargs):
            assert request['developmentMode'] is True
            await tool('workspace_list', {}, 'list-first')
            await tool('execute_action', {}, 'verify')
            return {'version': 'fixture'}
    result = await PiService(callback, Loop()).execute(params)
    assert result['attempts'] == 1
    assert database['invocations'] == 1

def test_long_development_turn_compacts_complete_tool_batches_and_keeps_receipts():
    from gamerhub_api.pi.context import ContextAssembler
    history = [{'role': 'user', 'content': '开发冲刺，保留冷却规则'}]
    for i in range(12):
        history += [
            {'role': 'assistant', 'content': [{'type': 'toolCall', 'id': str(i), 'name': 'workspace_read', 'arguments': {}}]},
            {'role': 'toolResult', 'toolCallId': str(i), 'toolName': 'workspace_read', 'content': [{'type': 'text', 'text': '{"path":"Assets/Game/Scripts/Generated/dash.cs","hash":"h' + str(i) + '","content":"' + '代码' * 1500 + '"}'}]},
        ]
    result = ContextAssembler(14000).execution(history, {'memory': {'revision': 0, 'items': []}}, {'task': '开发冲刺，保留冷却规则'}, [], '')
    assert result['report']['usedBytes'] <= 14000
    assert result['report']['droppedGroups'] > 0
    assert result['messages'][-2:] == history[-2:]
    assert '开发冲刺' in result['messages'][0]['content']
    assert 'dash.cs' in result['messages'][0]['content']

@pytest.mark.asyncio
async def test_atomic_fragment_patch_preserves_bytes_and_returns_receipt(tmp_path):
    import hashlib
    name = 'Assets/Game/Scripts/Generated/dash.cs'
    path = tmp_path / name
    path.parent.mkdir(parents=True)
    original = b'\xef\xbb\xbfclass Dash {\r\n  int speed = 2;\r\n  int cooldown = 3;\r\n}\r\n'
    path.write_bytes(original)
    tools = WorkspaceTools(tmp_path)
    result = await tools.call('workspace_patch', {'path': name, 'expectedHash': hashlib.sha256(original).hexdigest(), 'edits': [
        {'oldText': 'speed = 2', 'newText': 'speed = 5'}, {'oldText': 'cooldown = 3', 'newText': 'cooldown = 4'}]})
    assert path.read_bytes() == original.replace(b'speed = 2', b'speed = 5').replace(b'cooldown = 3', b'cooldown = 4')
    assert result['editsApplied'] == 2
    assert result['previousHash'] == hashlib.sha256(original).hexdigest()
    assert result['hash'] == hashlib.sha256(path.read_bytes()).hexdigest()

@pytest.mark.asyncio
@pytest.mark.parametrize('edits,expected_error', [
    ([{'oldText': 'int a', 'newText': 'int b'}, {'oldText': 'missing', 'newText': 'x'}], 'PATCH_TARGET_MISSING'),
    ([{'oldText': '2', 'newText': '3'}], 'PATCH_TARGET_AMBIGUOUS'),
    ([{'oldText': 'int a = 2', 'newText': 'x'}, {'oldText': 'a = 2', 'newText': 'y'}], 'PATCH_EDITS_OVERLAP'),
])
async def test_patch_validation_is_all_or_none(tmp_path, edits, expected_error):
    import hashlib
    name = 'Assets/Game/Scripts/dash.cs'
    path = tmp_path / name
    path.parent.mkdir(parents=True)
    raw = b'int a = 2; int b = 2;'
    path.write_bytes(raw)
    tools = WorkspaceTools(tmp_path)
    with pytest.raises(PiError, match=expected_error):
        await tools.call('workspace_patch', {'path': name, 'expectedHash': hashlib.sha256(raw).hexdigest(), 'edits': edits})
    assert path.read_bytes() == raw

@pytest.mark.asyncio
async def test_patch_refuses_stale_hash_and_forbidden_path(tmp_path):
    tools = WorkspaceTools(tmp_path)
    args = {'path': 'Assets/Game/Scripts/dash.cs', 'expectedHash': 'stale', 'edits': [{'oldText': 'old', 'newText': 'new'}]}
    with pytest.raises(PiError, match='FILE_CHANGED'):
        await tools.call('workspace_patch', args)
    for name in ['../outside.cs', 'Assets/Tests/PlayMode/RunnerPlayModeTests.cs']:
        with pytest.raises(PiError, match='WORKSPACE_ESCAPE|PATH_NOT_ALLOWED'):
            await tools.call('workspace_patch', {**args, 'path': name})
