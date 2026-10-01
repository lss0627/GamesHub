import base64
import json

import httpx
import pytest

from gamerhub_api import providers
from gamerhub_api.bridge import DomainError
from gamerhub_api.content import preview_response


@pytest.mark.asyncio
async def test_external_image_contract_and_provider_failure(monkeypatch):
    monkeypatch.setenv('GAMERHUB_IMAGE_PROVIDER_URL', 'https://images.test/generate')
    monkeypatch.setenv('GAMERHUB_IMAGE_PROVIDER_KEY', 'test-only-key')
    seen = []

    def handler(request):
        seen.append(request)
        assert request.headers['authorization'] == 'Bearer test-only-key'
        body = json.loads(request.content)
        assert body['role'] == 'cat' and body['transparent'] is True
        if len(seen) == 2:
            return httpx.Response(503, text='Internal Server Error private detail')
        return httpx.Response(200, json={'mime_type': 'image/png', 'bytes_base64': base64.b64encode(providers.builtin_image('cat', 'night')).decode()})

    client = httpx.AsyncClient
    monkeypatch.setattr(providers.httpx, 'AsyncClient', lambda **kw: client(transport=httpx.MockTransport(handler), **kw))
    assert (await providers.prepare_image('image-provider', 'cat', 'night', '月夜', '小猫')).startswith(b'\x89PNG')
    with pytest.raises(DomainError, match='^ART_PROVIDER_FAILED$'):
        await providers.prepare_image('image-provider', 'cat', 'night', '月夜', '小猫')


def test_preview_path_and_webgl_headers(tmp_path):
    root = tmp_path / 'build'
    root.mkdir()
    (tmp_path / 'private.txt').write_text('private')
    (root / 'game.wasm.gz').write_bytes(b'compressed')
    preview = {'root': str(root), 'traceId': 'test-trace'}
    for path in ('../private.txt', '..\\private.txt', str(tmp_path / 'private.txt')):
        with pytest.raises(DomainError, match='PREVIEW_PATH_INVALID'):
            preview_response(preview, path)
    response = preview_response(preview, 'game.wasm.gz')
    assert response.media_type == 'application/wasm'
    assert response.headers['content-encoding'] == 'gzip'
    assert response.headers['cross-origin-embedder-policy'] == 'require-corp'
