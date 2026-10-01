import asyncio
import sys
from pathlib import Path

import pytest

from gamerhub_api.pi.client import PiClient, PiError
from gamerhub_api.pi.tools import WorkspaceTools, run_process


@pytest.mark.asyncio
async def test_cli_preserves_args_and_reports_failure(tmp_path):
    result = await run_process([sys.executable, '-c', 'import sys; print(sys.argv[1]); sys.exit(7)', 'a;$(not-a-command)'], tmp_path, timeout=5)
    assert result['exitCode'] == 7
    assert 'a;$(not-a-command)' in result['output']
    assert not result['timedOut']


@pytest.mark.asyncio
async def test_cli_timeout_terminates_process(tmp_path):
    result = await run_process([sys.executable, '-c', 'import time; time.sleep(30)'], tmp_path, timeout=.1)
    assert result['timedOut']
    assert result['exitCode'] != 0


@pytest.mark.asyncio
async def test_workspace_boundaries_and_compare_before_write(tmp_path):
    source = tmp_path / 'Assets/Game/Scripts/Example.cs'
    source.parent.mkdir(parents=True)
    source.write_text('class Example {}', encoding='utf8')
    tools = WorkspaceTools(tmp_path)
    read = await tools.call('workspace_read', {'path': 'Assets/Game/Scripts/Example.cs'})
    assert read['content'] == 'class Example {}'
    with pytest.raises(PiError, match='WORKSPACE_ESCAPE'):
        await tools.call('workspace_read', {'path': '../secret'})
    with pytest.raises(PiError, match='PATH_NOT_ALLOWED'):
        await tools.call('workspace_read', {'path': '.env.local'})
    with pytest.raises(PiError, match='FILE_CHANGED'):
        await tools.call('workspace_write', {'path': 'Assets/Game/Scripts/Example.cs', 'content': 'class Fixed {}', 'expectedHash': 'wrong'})
    await tools.call('workspace_write', {'path': 'Assets/Game/Scripts/Example.cs', 'content': 'class Fixed {}', 'expectedHash': read['hash']})
    assert source.read_text(encoding='utf8') == 'class Fixed {}'
    with pytest.raises(PiError, match='CLI_OPERATION_NOT_ALLOWED'):
        await tools.call('cli_run', {'operation': 'powershell'})


@pytest.mark.asyncio
async def test_creative_config_is_readable_but_cannot_bypass_approved_spec(tmp_path):
    source = tmp_path / 'Assets/Resources/GamerHubCreative.json'
    source.parent.mkdir(parents=True)
    source.write_text('{"version":1}', encoding='utf8')
    tools = WorkspaceTools(tmp_path)
    result = await tools.call('workspace_read', {'path': 'Assets/Resources/GamerHubCreative.json'})
    assert result['content'] == '{"version":1}'
    with pytest.raises(PiError, match='PATH_NOT_ALLOWED'):
        await tools.call('workspace_write', {'path': 'Assets/Resources/GamerHubCreative.json', 'content': '{}', 'expectedHash': result['hash']})


@pytest.mark.asyncio
async def test_pi_process_exit_is_not_success(tmp_path):
    host = tmp_path / 'broken.py'
    host.write_text('print("not-json", flush=True)', encoding='utf8')
    client = PiClient(command=[sys.executable, str(host)])
    with pytest.raises(PiError):
        await client.run({'prompt': 'hello'}, timeout=2)


@pytest.mark.asyncio
async def test_pi_tool_error_returns_to_loop_and_messages_are_checkpointed(tmp_path):
    host = tmp_path / 'protocol.py'
    host.write_text('''import json,sys
json.loads(sys.stdin.readline())
print(json.dumps({'type':'tool_request','id':'t1','name':'fail','args':{}}),flush=True)
r=json.loads(sys.stdin.readline())
assert r['error']=='EXPECTED_FAILURE'
print(json.dumps({'type':'event','id':'e1','event':{'type':'message_end','message':{'role':'toolResult','isError':True}}}),flush=True)
assert json.loads(sys.stdin.readline())['type']=='ack'
print(json.dumps({'type':'completed','messages':[],'text':'recovered'}),flush=True)
''', encoding='utf8')
    events = []
    async def fail(name, args, call_id):
        raise PiError('EXPECTED_FAILURE')
    async def record(event):
        events.append(event)
    result = await PiClient(command=[sys.executable, str(host)]).run({'prompt': 'test'}, tool=fail, on_event=record, timeout=3)
    assert result['text'] == 'recovered'
    assert events[0]['message']['isError']
