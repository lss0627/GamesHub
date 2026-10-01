"""Real installed Pi loop with a local deterministic provider protocol fixture."""
import asyncio
import json

import pytest

from gamerhub_api.pi.client import PiClient, PiError


@pytest.mark.asyncio
@pytest.mark.parametrize('developing', [False, True])
async def test_repair_tools_unlock_after_failure_and_success_wins_on_last_turn(monkeypatch, developing):
    requests = []
    async def handle(reader, writer):
        try:
            header = await reader.readuntil(b'\r\n\r\n')
            size = next(int(line.split(b':', 1)[1]) for line in header.split(b'\r\n') if line.lower().startswith(b'content-length:'))
            body = json.loads(await reader.readexactly(size))
            requests.append(body)
            name = 'cli_run' if len(requests) == (1 if developing else 2) else 'execute_action'
            chunk = {'id': 'fixture', 'object': 'chat.completion.chunk', 'created': 1, 'model': 'fixture',
                     'choices': [{'index': 0, 'delta': {'role': 'assistant', 'tool_calls': [{'index': 0, 'id': f'call{len(requests)}', 'type': 'function', 'function': {'name': name, 'arguments': '{}'}}]}, 'finish_reason': None}]}
            finish = {'id': 'fixture', 'choices': [{'index': 0, 'delta': {}, 'finish_reason': 'tool_calls'}]}
            data = ('data: ' + json.dumps(chunk) + '\n\ndata: ' + json.dumps(finish) + '\n\ndata: [DONE]\n\n').encode()
            writer.write(b'HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: close\r\nContent-Length: ' + str(len(data)).encode() + b'\r\n\r\n' + data)
            await writer.drain()
        finally:
            writer.close()
            await writer.wait_closed()
    server = await asyncio.start_server(handle, '127.0.0.1', 0)
    port = server.sockets[0].getsockname()[1]
    monkeypatch.setenv('DEEPSEEK_API_KEY', 'local-protocol-fixture')
    calls = []
    async def tool(name, args, call_id):
        calls.append(name)
        if len(calls) == 1 and not developing:
            raise PiError('UNITY_CHECK_FAILED')
        return {'status': 'completed'}
    definitions = [{'name': name, 'description': name, 'parameters': {'type': 'object', 'properties': {}, 'required': []}} for name in ('execute_action', 'cli_run')]
    projections = []
    async def context(messages):
        projections.append(messages)
        return [{'role': 'user', 'content': f'context-revision-{len(projections)}', 'timestamp': 0}, *messages]
    try:
        result = await PiClient().run({'sessionId': 'host-regression', 'prompt': 'fixture', 'confirmedAction': True,
            'developmentMode': developing,
            'tools': definitions, 'maxTurns': 3, 'managedContext': True, 'model': {'id': 'fixture', 'baseUrl': f'http://127.0.0.1:{port}/v1'}}, tool=tool, context=context, timeout=25)
    finally:
        server.close()
        await server.wait_closed()
    assert result['runtime'] == 'pi-agent-core'
    assert calls == (['cli_run', 'execute_action'] if developing else ['execute_action', 'cli_run', 'execute_action'])
    assert {tool['function']['name'] for tool in requests[0]['tools']} == ({'execute_action', 'cli_run'} if developing else {'execute_action'})
    assert {tool['function']['name'] for tool in requests[1]['tools']} == {'execute_action', 'cli_run'}
    assert len(requests) == (2 if developing else 3)
    assert len(projections) == len(requests)
    assert 'context-revision-1' in json.dumps(requests[0]['messages'])
    assert f'context-revision-{len(requests)}' in json.dumps(requests[-1]['messages'])
    assert 'context-revision-' not in json.dumps(projections[-1])


@pytest.mark.asyncio
async def test_context_failure_aborts_official_pi_before_provider(monkeypatch):
    monkeypatch.setenv('DEEPSEEK_API_KEY', 'local-protocol-fixture')
    async def context(messages):
        raise PiError('CONTEXT_BUDGET_EXCEEDED')
    with pytest.raises(PiError, match='CONTEXT_BUDGET_EXCEEDED'):
        await PiClient().run({'sessionId': 'context-failure', 'prompt': 'fixture', 'managedContext': True,
            'model': {'id': 'fixture', 'baseUrl': 'http://127.0.0.1:1/v1'}}, context=context, timeout=15)
