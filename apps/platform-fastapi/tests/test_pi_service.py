import copy
import asyncio
from uuid import uuid4

import pytest

from gamerhub_api.pi.client import PiError
from gamerhub_api.pi.service import PiService as ProductionPiService


class RepositoryFixture:
    def __init__(self, callback):
        self.callback = callback
    async def load_checkpoint(self, project_id, run_id):
        return await self.callback('fixture', 'load', {}), 0
    async def save_checkpoint(self, project_id, run_id, revision, document):
        await self.callback('fixture', 'save', copy.deepcopy(document))
        return revision + 1
    async def knowledge(self, project_id, run_id=None):
        return {'memory': {'revision': 0, 'items': []}}
    async def get_memory(self, project_id):
        return {'revision': 0, 'items': []}


def PiService(callback, client):
    return ProductionPiService(callback, client, repository=RepositoryFixture(callback))


class TestLoop:
    async def run(self, request, *, tool, on_event, **kwargs):
        await on_event({'type': 'message_end', 'message': {'role': 'user', 'content': 'confirmed'}})
        await tool('execute_action', {}, 'call-1')
        return {'version': 'test-fixture'}


def fixture():
    database = {'checkpoint': None, 'invocations': 0, 'events': []}
    async def callback(request_id, name, body):
        if name == 'load':
            return copy.deepcopy(database['checkpoint'])
        if name == 'save':
            database['checkpoint'] = copy.deepcopy(body)
        if name == 'context':
            return {'projectId': '00000000-0000-4000-8000-000000000001'}
        if name == 'event':
            database['events'].append(body)
        if name == 'invoke':
            database['invocations'] += 1
            return {'output': {'status': 'completed', 'evidence': ['real-tool-receipt']}, 'assessment': {'succeeded': True}}
    params = {'requestId': str(uuid4()), 'runId': str(uuid4()), 'sessionId': str(uuid4()),
              'policy': {'allowedToolNames': ['test.action'], 'allowedSafetyClasses': ['read_only'],
                         'budget': {'maxSteps': 5, 'maxToolCalls': 5, 'maxRetriesPerAction': 1, 'deadlineMs': 60000}},
              'action': {'id': 'test', 'idempotencyKey': 'key1', 'toolName': 'test.action', 'safetyClass': 'read_only', 'idempotent': False}}
    return database, callback, params


@pytest.mark.asyncio
async def test_completed_action_replays_across_service_restart():
    database, callback, params = fixture()
    result = await PiService(callback, TestLoop()).execute(params)
    assert not result['replayed']
    replay = await PiService(callback, TestLoop()).execute(params)
    assert replay['replayed'] and database['invocations'] == 1
    assert replay['output']['evidence'] == ['real-tool-receipt']


@pytest.mark.asyncio
async def test_interrupted_mutation_requires_reconciliation():
    database, callback, params = fixture()
    database['checkpoint'] = {'actions': {'key1': {'status': 'running'}}, 'usage': {}}
    with pytest.raises(PiError, match='RECOVERY_REQUIRES_RECONCILIATION'):
        await PiService(callback, TestLoop()).execute(params)
    assert database['invocations'] == 0


@pytest.mark.asyncio
async def test_tool_policy_and_budget_cannot_be_bypassed():
    database, callback, params = fixture()
    params['policy']['allowedToolNames'] = []
    with pytest.raises(PiError, match='TOOL_NOT_ALLOWED'):
        await PiService(callback, TestLoop()).execute(params)
    params['policy']['allowedToolNames'] = ['test.action']
    params['policy']['budget']['maxToolCalls'] = 0
    with pytest.raises(PiError, match='AGENT_BUDGET_EXHAUSTED'):
        await PiService(callback, TestLoop()).execute(params)
    assert database['invocations'] == 0


@pytest.mark.asyncio
async def test_model_text_without_tool_is_not_success():
    class NoTool:
        async def run(self, *args, **kwargs):
            return {'version': 'fixture', 'text': 'done'}
    database, callback, params = fixture()
    with pytest.raises(PiError, match='PI_TASK_NOT_COMPLETED'):
        await PiService(callback, NoTool()).execute(params)
    assert database['invocations'] == 0


@pytest.mark.asyncio
async def test_stop_control_cancels_model_and_waits_for_cleanup():
    cleaned = asyncio.Event()
    class WaitingLoop:
        async def run(self, *args, **kwargs):
            try:
                await asyncio.Future()
            finally:
                cleaned.set()
    async def control(name, body=None):
        assert name == 'assertRunnable'
        raise PiError('RUN_CONTROL_REQUESTED')
    service = PiService(control, WaitingLoop())
    with pytest.raises(PiError, match='RUN_CONTROL_REQUESTED'):
        await asyncio.wait_for(service._guarded_run({}, control), timeout=3)
    assert cleaned.is_set()


@pytest.mark.asyncio
async def test_existing_unity_action_settles_before_pause_releases_worker():
    database, base_callback, params = fixture()
    started = asyncio.Event()
    completed = asyncio.Event()
    async def callback(request_id, name, body):
        if name == 'assertRunnable' and started.is_set():
            raise PiError('RUN_CONTROL_REQUESTED')
        if name == 'invoke':
            started.set()
            await asyncio.sleep(1.2)
            completed.set()
        return await base_callback(request_id, name, body)
    result = await PiService(callback, TestLoop()).execute(params)
    assert completed.is_set() and result['output']['status'] == 'completed'
    assert database['checkpoint']['actions']['key1']['status'] == 'completed'
