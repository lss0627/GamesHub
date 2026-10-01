import base64
from io import BytesIO

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from gamerhub_api.app import create_app

PROJECT = '00000000-0000-4000-8000-000000000001'


class StubBridge:
    def __init__(self):
        self.calls = []

    async def call(self, operation, params=None):
        self.calls.append((operation, params or {}))
        if operation == 'health':
            return {'status': 200, 'body': {'status': 'ready', 'provenance': 'real-unity-local-dev'}}
        if operation == 'projects.create':
            return {'status': 201, 'body': {'id': PROJECT}}
        if operation == 'capabilities.get':
            return {'status': 200, 'body': {'capabilities': [{'genre': 'survivor', 'runtime': 'arena-v1'}]}}
        if operation == 'runs.create':
            return {'status': 202, 'body': {'id': PROJECT, 'status': 'queued'}, 'headers': {'x-gamerhub-trace-id': 'trace'}}
        if operation == 'runs.events':
            return {'status': 200, 'body': {'sse': 'id: 2\nevent: run.accepted\ndata: {}\n\n'}}
        if operation == 'assets.content':
            return {'status': 200, 'body': {'bytes_base64': base64.b64encode(b'PNG bytes').decode(), 'mime_type': 'image/png'}}
        return {'status': 404, 'body': {'code': 'NOT_FOUND'}}


@pytest.fixture
def client():
    bridge = StubBridge()
    with TestClient(create_app(bridge=bridge)) as client:
        yield client, bridge


def test_fastapi_documents_real_routes_and_preserves_status_headers(client):
    http, bridge = client
    assert http.get('/health').json()['framework'] == 'fastapi'
    paths = http.get('/openapi.json').json()['paths']
    assert '/v1/projects/{projectId}/design/confirm' in paths
    assert '/v1/projects/{projectId}/art/generate' in paths
    assert '/v1/projects/{projectId}/art/resume' in paths
    assert http.get('/v1/game-capabilities').json()['capabilities'][0]['runtime'] == 'arena-v1'
    assert http.post('/v1/projects', json={'name': '我的项目'}).status_code == 201
    response = http.post(f'/v1/projects/{PROJECT}/runs', headers={'Idempotency-Key': 'run-1'}, json={'request_type': 'create', 'prompt': '制作跑酷'})
    assert response.status_code == 202
    assert response.headers['x-gamerhub-trace-id'] == 'trace'
    assert bridge.calls[-1][0] == 'runs.create'


def test_resume_route_uses_revision_only_and_existing_auth_boundary(client):
    from unittest.mock import AsyncMock
    http, bridge = client
    handler = AsyncMock(return_value={'revision': 5, 'status': 'generating'})
    http.app.state.art.resume = handler
    response = http.post(f'/v1/projects/{PROJECT}/art/resume', json={'revision': 4})
    assert response.status_code == 202 and response.json()['revision'] == 5
    assert handler.await_args.args[0] == PROJECT
    assert handler.await_args.args[1].revision == 4
    handler.reset_mock()
    for body in ({'revision': -1}, {'revision': True}, {'revision': 4, 'prompt': 'new prompt'}):
        assert http.post(f'/v1/projects/{PROJECT}/art/resume', json=body).status_code == 400
    handler.assert_not_awaited()
    assert not bridge.calls
    with TestClient(create_app(bridge=bridge, bearer_token='a' * 32)) as protected:
        assert protected.post(f'/v1/projects/{PROJECT}/art/resume', json={'revision': 4}).status_code == 401
    assert not bridge.calls


def test_validation_is_safe_json_and_does_not_execute_invalid_requests(client):
    http, bridge = client
    response = http.post(f'/v1/projects/{PROJECT}/design/messages', json={'revision': -1, 'message': ''})
    assert response.status_code == 400
    assert 'code' in response.json() and 'detail' not in response.json()
    assert not bridge.calls
    assert http.post('/v1/projects/not-a-uuid/design/confirm', json={'revision': 0}).status_code == 400
    assert http.delete(f'/v1/projects/{PROJECT}').status_code == 405


def test_creation_mode_reaches_design_and_unknown_modes_are_rejected(client):
    http, bridge = client
    http.post(f'/v1/projects/{PROJECT}/design/messages', json={'revision': 0, 'message': '制作跑酷', 'creationMode': 'quick'})
    assert bridge.calls[-1][0] == 'design.message'
    assert bridge.calls[-1][1]['body']['creationMode'] == 'quick'
    bridge.calls.clear()
    assert http.post(f'/v1/projects/{PROJECT}/design/messages', json={'revision': 0, 'message': '制作跑酷', 'creationMode': 'automatic-admin'}).status_code == 400
    assert not bridge.calls


def test_creative_routes_preserve_revision_and_reject_invalid_envelopes(client):
    http, bridge = client
    paths = http.get('/openapi.json').json()['paths']
    assert '/v1/projects/{projectId}/creative/apply' in paths
    body = {'revision': 2, 'document': {'version': 1, 'nodes': [], 'clips': [], 'sounds': [], 'masterVolume': .5}}
    http.post(f'/v1/projects/{PROJECT}/creative', json=body)
    assert bridge.calls[-1] == ('creative.save', {'projectId': PROJECT, 'body': body})
    http.post(f'/v1/projects/{PROJECT}/creative/suggest', json={'revision': 2, 'prompt': '加入漂浮招牌'})
    assert bridge.calls[-1][0] == 'creative.suggest'
    bridge.calls.clear()
    assert http.post(f'/v1/projects/{PROJECT}/creative', json={**body, 'revision': True}).status_code == 400
    assert http.post(f'/v1/projects/{PROJECT}/creative/apply', json={'revision': -1}).status_code == 400
    assert not bridge.calls


def test_sse_cursor_and_binary_are_not_json_wrapped(client):
    http, bridge = client
    result = http.get(f'/v1/projects/{PROJECT}/runs/{PROJECT}/events?after=1', headers={'Last-Event-ID': '7'})
    assert result.headers['content-type'].startswith('text/event-stream')
    assert result.text.startswith(': gamerhub-heartbeat')
    assert bridge.calls[-1][1]['after'] == 7
    result = http.get(f'/v1/projects/{PROJECT}/assets/{PROJECT}/content')
    assert result.content == b'PNG bytes'
    assert result.headers['content-type'] == 'image/png'
    assert result.headers['x-content-type-options'] == 'nosniff'


def test_decoder_rejects_fake_image_and_reports_real_dimensions(client):
    http, _ = client
    assert http.post('/decode', json={'bytes_base64': base64.b64encode(b'bad').decode(), 'mime_type': 'image/png'}).status_code == 400
    image = Image.new('RGBA', (16, 24), (255, 0, 0, 255))
    output = BytesIO()
    image.save(output, 'PNG')
    response = http.post('/decode', json={'bytes_base64': base64.b64encode(output.getvalue()).decode(), 'mime_type': 'image/png'})
    assert response.status_code == 200
    assert response.json()['width'] == 16
    assert response.json()['height'] == 24


def test_bearer_auth_before_domain_access():
    with TestClient(create_app(bridge=StubBridge(), bearer_token='a' * 32)) as http:
        assert http.get('/health').status_code == 200
        assert http.get('/v1/projects').status_code == 401
        assert http.get('/v1/projects', headers={'Authorization': 'Bearer ' + 'a' * 32}).status_code == 404


def test_optional_image_health_is_configuration_only_and_does_not_block_core(client, monkeypatch):
    http, _ = client
    monkeypatch.setenv('GAMERHUB_IMAGE_PROVIDER', 'openai')
    monkeypatch.delenv('GAMERHUB_IMAGE_MODEL', raising=False)
    monkeypatch.setenv('GAMERHUB_IMAGE_API_KEY', 'private-image-key')
    response = http.get('/health')
    assert response.status_code == 200
    assert response.json()['status'] == 'ready'
    image = response.json()['services']['images']
    assert image['status'] == 'blocked'
    assert image['configurationOnly'] is True
    assert image['optional'] is True and image['builtinAvailable'] is True
    assert image['reasonCode'] == 'ART_PROVIDER_MODEL_REQUIRED'
    assert 'private-image-key' not in response.text
    monkeypatch.setenv('GAMERHUB_IMAGE_MODEL', 'gpt-image-1')
    assert http.get('/health').json()['services']['images']['status'] == 'ready'
