import asyncio
import base64
import json
from io import BytesIO

import httpx
import pytest
from PIL import Image

from gamerhub_api import providers
from gamerhub_api.bridge import DomainError


@pytest.fixture(autouse=True)
def isolated_image_config(monkeypatch):
    for name in (
        'GAMERHUB_IMAGE_PROVIDER', 'GAMERHUB_IMAGE_PROVIDER_URL', 'GAMERHUB_IMAGE_PROVIDER_KEY',
        'GAMERHUB_IMAGE_MODEL', 'GAMERHUB_IMAGE_API_KEY', 'OPENAI_API_KEY',
        'GAMERHUB_IMAGE_QUALITY', 'GAMERHUB_IMAGE_TIMEOUT_SECONDS',
    ):
        monkeypatch.delenv(name, raising=False)


def png_base64(alpha=True, empty=False, format='PNG'):
    image = Image.new('RGBA' if format == 'PNG' else 'RGB', (16, 16), (20, 180, 60, 0 if empty else 255))
    if alpha and format == 'PNG':
        image.putpixel((0, 0), (0, 0, 0, 0))
    output = BytesIO()
    image.save(output, format)
    return base64.b64encode(output.getvalue()).decode()


def configure_openai(monkeypatch):
    monkeypatch.setenv('GAMERHUB_IMAGE_PROVIDER', 'openai')
    monkeypatch.setenv('GAMERHUB_IMAGE_MODEL', 'gpt-image-2.5-flare')
    monkeypatch.setenv('GAMERHUB_IMAGE_API_KEY', 'test-image-secret')


def mock_http(monkeypatch, handler):
    actual_client = httpx.AsyncClient
    monkeypatch.setattr(providers.httpx, 'AsyncClient', lambda **kwargs: actual_client(transport=httpx.MockTransport(handler), **kwargs))


def test_default_and_explicit_builtin_are_free_config_only(monkeypatch):
    monkeypatch.setenv('OPENAI_API_KEY', 'unused-secret')
    monkeypatch.setenv('DEEPSEEK_API_KEY', 'language-only-secret')
    assert providers.available_providers()[0]['available'] is True
    assert providers.available_providers()[1]['available'] is False
    assert providers.image_runtime_info()['status'] == 'bypassed'
    assert providers.generation_provenance('builtin') == {'provider': 'builtin'}
    monkeypatch.setenv('GAMERHUB_IMAGE_PROVIDER', 'builtin')
    monkeypatch.setenv('GAMERHUB_IMAGE_PROVIDER_URL', 'https://images.test/generate')
    assert providers.image_runtime_info()['status'] == 'bypassed'


def test_openai_configuration_has_no_network_probe_or_secrets(monkeypatch):
    configure_openai(monkeypatch)
    monkeypatch.setattr(providers.httpx, 'AsyncClient', lambda **kwargs: pytest.fail('health must not probe'))
    info = providers.image_runtime_info()
    assert info == {
        'status': 'ready', 'provider': 'openai', 'model': 'gpt-image-2.5-flare',
        'detail': providers.CONFIG_DETAILS['ART_PROVIDER_READY'], 'reasonCode': 'ART_PROVIDER_READY',
        'optional': True, 'configurationOnly': True, 'builtinAvailable': True,
    }
    public = providers.available_providers()
    assert public[1]['configurationOnly'] is True
    assert public[1]['model'] == 'gpt-image-2.5-flare'
    assert 'test-image-secret' not in json.dumps([info, public, providers.generation_provenance('image-provider')])
    assert 'test-image-secret' not in repr(providers._image_config())


def test_resume_fingerprint_tracks_output_configuration_but_allows_key_rotation(monkeypatch):
    configure_openai(monkeypatch)
    original = providers.generation_fingerprint('image-provider')
    assert original.startswith('sha256-') and len(original) == 71
    monkeypatch.setenv('GAMERHUB_IMAGE_API_KEY', 'rotated-secret')
    assert providers.generation_fingerprint('image-provider') == original
    monkeypatch.setenv('GAMERHUB_IMAGE_QUALITY', 'high')
    assert providers.generation_fingerprint('image-provider') != original
    monkeypatch.delenv('GAMERHUB_IMAGE_QUALITY')
    monkeypatch.setenv('GAMERHUB_IMAGE_MODEL', 'gpt-image-1')
    assert providers.generation_fingerprint('image-provider') != original
    monkeypatch.setenv('GAMERHUB_IMAGE_MODEL', 'gpt-image-2.5-flare')
    monkeypatch.setenv('GAMERHUB_IMAGE_PROVIDER', 'gateway')
    monkeypatch.setenv('GAMERHUB_IMAGE_PROVIDER_URL', 'https://other-images.test/v1')
    assert providers.generation_fingerprint('image-provider') != original
    gateway = providers.generation_fingerprint('image-provider')
    monkeypatch.setenv('GAMERHUB_IMAGE_PROVIDER_URL', 'https://new-images.test/v1')
    assert providers.generation_fingerprint('image-provider') != gateway
    builtin = providers.generation_fingerprint('builtin')
    monkeypatch.setenv('GAMERHUB_IMAGE_PROVIDER', 'builtin')
    assert providers.generation_fingerprint('builtin') == builtin


@pytest.mark.parametrize('settings,reason', [
    ({'GAMERHUB_IMAGE_PROVIDER': 'vendor-secret'}, 'ART_PROVIDER_UNSUPPORTED'),
    ({'GAMERHUB_IMAGE_PROVIDER': 'gateway'}, 'ART_PROVIDER_URL_REQUIRED'),
    ({'GAMERHUB_IMAGE_PROVIDER_URL': 'file:///private-secret'}, 'ART_PROVIDER_URL_INVALID'),
    ({'GAMERHUB_IMAGE_PROVIDER_URL': 'https://username:private-secret@images.test/generate'}, 'ART_PROVIDER_URL_INVALID'),
    ({'GAMERHUB_IMAGE_PROVIDER_URL': 'https://images.test:bad/generate'}, 'ART_PROVIDER_URL_INVALID'),
    ({'GAMERHUB_IMAGE_PROVIDER_URL': 'ftp://images.test/generate'}, 'ART_PROVIDER_URL_INVALID'),
    ({'GAMERHUB_IMAGE_PROVIDER': 'openai'}, 'ART_PROVIDER_MODEL_REQUIRED'),
    ({'GAMERHUB_IMAGE_PROVIDER': 'openai', 'GAMERHUB_IMAGE_MODEL': 'text-only-secret'}, 'ART_PROVIDER_MODEL_UNSUPPORTED'),
    ({'GAMERHUB_IMAGE_PROVIDER': 'openai', 'GAMERHUB_IMAGE_MODEL': 'gpt-image-2'}, 'ART_PROVIDER_KEY_REQUIRED'),
    ({'GAMERHUB_IMAGE_PROVIDER_URL': 'https://images.test', 'GAMERHUB_IMAGE_TIMEOUT_SECONDS': 'nan'}, 'ART_PROVIDER_SETTINGS_INVALID'),
    ({'GAMERHUB_IMAGE_PROVIDER_URL': 'https://images.test', 'GAMERHUB_IMAGE_TIMEOUT_SECONDS': '181'}, 'ART_PROVIDER_SETTINGS_INVALID'),
    ({'GAMERHUB_IMAGE_PROVIDER_URL': 'https://images.test', 'GAMERHUB_IMAGE_QUALITY': 'invalid'}, 'ART_PROVIDER_SETTINGS_INVALID'),
    ({'GAMERHUB_IMAGE_PROVIDER_URL': 'https://images.test', 'GAMERHUB_IMAGE_PROVIDER_KEY': 'secret\nheader'}, 'ART_PROVIDER_SETTINGS_INVALID'),
])
def test_invalid_configuration_is_blocked_and_sanitized(monkeypatch, settings, reason):
    for name, value in settings.items():
        monkeypatch.setenv(name, value)
    info = providers.image_runtime_info()
    assert info['status'] == 'blocked'
    assert info['reasonCode'] == reason
    assert providers.available_providers()[1]['available'] is False
    assert 'secret' not in json.dumps([info, providers.available_providers()])


@pytest.mark.asyncio
async def test_legacy_gateway_payload_is_unchanged(monkeypatch):
    monkeypatch.setenv('GAMERHUB_IMAGE_PROVIDER_URL', 'http://127.0.0.1:8040/generate')
    monkeypatch.setenv('GAMERHUB_IMAGE_PROVIDER_KEY', 'gateway-secret')
    requests = []

    def handler(request):
        requests.append(request)
        assert request.url == 'http://127.0.0.1:8040/generate'
        assert request.headers['authorization'] == 'Bearer gateway-secret'
        assert json.loads(request.content) == {
            'prompt': '2D game art. Shared style: 月光. Palette: 月色森林. Asset: 完整的小猫. No text, no UI.',
            'role': 'cat', 'width': 256, 'height': 256, 'transparent': True,
        }
        return httpx.Response(200, json={'bytes_base64': png_base64(), 'mime_type': 'image/png'})

    mock_http(monkeypatch, handler)
    assert providers.image_runtime_info()['provider'] == 'gateway'
    assert (await providers.prepare_image('image-provider', 'cat', 'night', '月光', '完整的小猫')).startswith(b'\x89PNG')
    assert len(requests) == 1


@pytest.mark.parametrize('url', ['http://image-gateway:8080/generate', 'http://192.168.1.10:8000/generate', 'https://images.test/generate'])
def test_trusted_gateway_http_and_https_config_stays_compatible(monkeypatch, url):
    monkeypatch.setenv('GAMERHUB_IMAGE_PROVIDER_URL', url)
    assert providers.image_runtime_info()['status'] == 'ready'
    assert providers._image_config().endpoint == url


@pytest.mark.asyncio
@pytest.mark.parametrize('role,size,background', [('cat', '1024x1024', 'transparent'), ('forest', '1536x1024', 'opaque')])
async def test_openai_request_and_base64_png_response(monkeypatch, role, size, background):
    configure_openai(monkeypatch)
    # Gateway configuration must never replace the explicit official endpoint.
    monkeypatch.setenv('GAMERHUB_IMAGE_PROVIDER_URL', 'https://gateway.test/private-secret')
    requests = []

    def handler(request):
        requests.append(request)
        assert request.url == 'https://api.openai.com/v1/images/generations'
        assert request.headers['authorization'] == 'Bearer test-image-secret'
        body = json.loads(request.content)
        assert body['model'] == 'gpt-image-2.5-flare'
        assert body['n'] == 1
        assert body['output_format'] == 'png'
        assert body['size'] == size and body['background'] == background
        assert body['quality'] == 'medium'
        assert 'response_format' not in body
        assert 'No text, no UI.' in body['prompt']
        return httpx.Response(200, json={'data': [{'b64_json': png_base64(alpha=role != 'forest')}], 'usage': {'total_tokens': 123}})

    mock_http(monkeypatch, handler)
    raw = await providers.prepare_image('image-provider', role, 'dusk', '柔和水彩', '完整的素材')
    with Image.open(BytesIO(raw)) as image:
        assert image.format == 'PNG'
    assert len(requests) == 1


def test_openai_dedicated_key_precedes_fallback(monkeypatch):
    configure_openai(monkeypatch)
    monkeypatch.setenv('OPENAI_API_KEY', 'fallback-secret')
    assert providers._image_config().key == 'test-image-secret'
    monkeypatch.delenv('GAMERHUB_IMAGE_API_KEY')
    assert providers._image_config().key == 'fallback-secret'


@pytest.mark.asyncio
@pytest.mark.parametrize('status,code', [
    (301, 'ART_PROVIDER_REQUEST_REJECTED'), (400, 'ART_PROVIDER_REQUEST_REJECTED'),
    (401, 'ART_PROVIDER_AUTH_FAILED'), (403, 'ART_PROVIDER_AUTH_FAILED'),
    (429, 'ART_PROVIDER_RATE_LIMITED'), (503, 'ART_PROVIDER_FAILED'),
])
async def test_status_errors_do_not_leak_or_retry(monkeypatch, status, code):
    configure_openai(monkeypatch)
    requests = []

    def handler(request):
        requests.append(request)
        return httpx.Response(status, text='private upstream test-image-secret traceback', headers={'location': 'https://elsewhere.test'})

    mock_http(monkeypatch, handler)
    with pytest.raises(DomainError, match=f'^{code}$') as error:
        await providers.prepare_image('image-provider', 'cat', 'day', 'cartoon', 'cat')
    assert len(requests) == 1
    assert 'secret' not in repr(error.value)


@pytest.mark.asyncio
@pytest.mark.parametrize('result', [None, [], {}, {'data': []}, {'data': [None]}, {'data': [{'url': 'https://image.test/private-secret'}]},
                                       {'data': [{'b64_json': 'not base64'}]}, {'data': [{'b64_json': 42}]},
                                       {'data': [{'b64_json': 'a'}, {'b64_json': 'b'}]}])
async def test_malformed_openai_response_is_rejected(monkeypatch, result):
    configure_openai(monkeypatch)
    mock_http(monkeypatch, lambda request: httpx.Response(200, json=result))
    with pytest.raises(DomainError, match='^ART_PROVIDER_INVALID$'):
        await providers.prepare_image('image-provider', 'cat', 'day', 'cartoon', 'cat')


@pytest.mark.asyncio
@pytest.mark.parametrize('body', [b'<html>private-secret</html>', b'\xff\xfe\x00', b'[' * 2000])
async def test_non_json_response_is_sanitized(monkeypatch, body):
    configure_openai(monkeypatch)
    mock_http(monkeypatch, lambda request: httpx.Response(200, content=body))
    with pytest.raises(DomainError, match='^ART_PROVIDER_INVALID$'):
        await providers.prepare_image('image-provider', 'cat', 'day', 'cartoon', 'cat')


@pytest.mark.asyncio
@pytest.mark.parametrize('encoded,mime,code', [
    (png_base64(alpha=False), 'image/png', 'ART_TRANSPARENCY_REQUIRED'),
    (png_base64(empty=True), 'image/png', 'ART_TRANSPARENCY_REQUIRED'),
    (png_base64(format='JPEG'), 'image/jpeg', 'ART_PNG_REQUIRED'),
    (png_base64(format='JPEG'), 'image/png', 'ART_PROVIDER_INVALID'),
])
async def test_gateway_requires_real_png_and_visible_transparent_sprites(monkeypatch, encoded, mime, code):
    monkeypatch.setenv('GAMERHUB_IMAGE_PROVIDER_URL', 'https://images.test')
    mock_http(monkeypatch, lambda request: httpx.Response(200, json={'bytes_base64': encoded, 'mime_type': mime}))
    with pytest.raises(DomainError, match=f'^{code}$'):
        await providers.prepare_image('image-provider', 'cat', 'day', 'cartoon', 'cat')


@pytest.mark.asyncio
@pytest.mark.parametrize('with_length', [True, False])
async def test_response_limit_before_json_parse(monkeypatch, with_length):
    configure_openai(monkeypatch)
    monkeypatch.setattr(providers, 'MAX_RESPONSE_BYTES', 100)

    class ChunkedResponse(httpx.AsyncByteStream):
        async def __aiter__(self):
            yield b'x' * 60
            yield b'y' * 60

    mock_http(monkeypatch, lambda request: httpx.Response(200, stream=ChunkedResponse(), headers={'content-length': '120'} if with_length else {}))
    with pytest.raises(DomainError, match='^ART_PROVIDER_INVALID$'):
        await providers.prepare_image('image-provider', 'cat', 'day', 'cartoon', 'cat')


@pytest.mark.asyncio
async def test_timeout_is_sanitized_and_never_retried(monkeypatch):
    configure_openai(monkeypatch)
    requests = []

    def handler(request):
        requests.append(request)
        raise httpx.ReadTimeout('private upstream test-image-secret', request=request)

    mock_http(monkeypatch, handler)
    with pytest.raises(DomainError, match='^ART_PROVIDER_TIMEOUT$'):
        await providers.prepare_image('image-provider', 'cat', 'day', 'cartoon', 'cat')
    assert len(requests) == 1


@pytest.mark.asyncio
async def test_wall_clock_deadline_bounds_slow_provider(monkeypatch):
    configure_openai(monkeypatch)
    monkeypatch.setenv('GAMERHUB_IMAGE_TIMEOUT_SECONDS', '1')
    started = asyncio.Event()

    async def handler(request):
        started.set()
        await asyncio.Event().wait()

    mock_http(monkeypatch, handler)
    with pytest.raises(DomainError, match='^ART_PROVIDER_TIMEOUT$'):
        await providers.prepare_image('image-provider', 'cat', 'day', 'cartoon', 'cat')
    assert started.is_set()


@pytest.mark.asyncio
async def test_network_error_does_not_leak_credentials(monkeypatch):
    configure_openai(monkeypatch)

    def handler(request):
        raise httpx.ConnectError('private upstream test-image-secret', request=request)

    mock_http(monkeypatch, handler)
    with pytest.raises(DomainError, match='^ART_PROVIDER_FAILED$') as error:
        await providers.prepare_image('image-provider', 'cat', 'day', 'cartoon', 'cat')
    assert error.value.__suppress_context__ is True


@pytest.mark.asyncio
async def test_image_dimensions_are_validated_before_ingestion(monkeypatch):
    configure_openai(monkeypatch)
    output = BytesIO()
    Image.new('RGBA', (4097, 1), (1, 2, 3, 0)).save(output, 'PNG')
    encoded = base64.b64encode(output.getvalue()).decode()
    mock_http(monkeypatch, lambda request: httpx.Response(200, json={'data': [{'b64_json': encoded}]}))
    with pytest.raises(DomainError, match='^ART_PROVIDER_INVALID$'):
        await providers.prepare_image('image-provider', 'cat', 'day', 'cartoon', 'cat')


@pytest.mark.asyncio
async def test_image_size_is_bounded_independently_of_response_json(monkeypatch):
    configure_openai(monkeypatch)
    monkeypatch.setattr(providers, 'MAX_IMAGE_BYTES', 8)
    mock_http(monkeypatch, lambda request: httpx.Response(200, json={'data': [{'b64_json': png_base64()}]}))
    with pytest.raises(DomainError, match='^ART_PROVIDER_INVALID$'):
        await providers.prepare_image('image-provider', 'cat', 'day', 'cartoon', 'cat')


@pytest.mark.asyncio
async def test_cancellation_propagates_without_fallback(monkeypatch):
    configure_openai(monkeypatch)

    async def handler(request):
        raise asyncio.CancelledError()

    mock_http(monkeypatch, handler)
    with pytest.raises(asyncio.CancelledError):
        await providers.prepare_image('image-provider', 'cat', 'day', 'cartoon', 'cat')


@pytest.mark.asyncio
@pytest.mark.parametrize('source,role,style,prompt,code', [
    ('unknown', 'cat', 'day', 'prompt', 'ART_SOURCE_INVALID'),
    ('image-provider', 'unknown', 'day', 'prompt', 'ART_ROLE_INVALID'),
    ('image-provider', 'cat', 'unknown', 'prompt', 'ART_ROLE_INVALID'),
    ('image-provider', 'cat', 'day', '', 'ART_PROMPT_INVALID'),
    ('image-provider', 'cat', 'day', 'a' * 4001, 'ART_PROMPT_INVALID'),
])
async def test_invalid_input_fails_before_billing(monkeypatch, source, role, style, prompt, code):
    configure_openai(monkeypatch)
    monkeypatch.setattr(providers.httpx, 'AsyncClient', lambda **kwargs: pytest.fail('invalid input must not call the provider'))
    with pytest.raises(DomainError, match=f'^{code}$'):
        await providers.prepare_image(source, role, style, prompt, 'cat')


@pytest.mark.asyncio
async def test_request_limit_is_utf8_bytes(monkeypatch):
    configure_openai(monkeypatch)
    monkeypatch.setattr(providers, 'MAX_REQUEST_BYTES', 1024)
    monkeypatch.setattr(providers.httpx, 'AsyncClient', lambda **kwargs: pytest.fail('oversize input must not call the provider'))
    with pytest.raises(DomainError, match='^ART_PROMPT_INVALID$'):
        await providers.prepare_image('image-provider', 'cat', 'day', '猫' * 500, 'cat')


@pytest.mark.asyncio
async def test_unconfigured_provider_does_not_fallback(monkeypatch):
    monkeypatch.setattr(providers, 'builtin_image', lambda *args: pytest.fail('external source must never fallback'))
    with pytest.raises(DomainError, match='^ART_PROVIDER_UNAVAILABLE$'):
        await providers.prepare_image('image-provider', 'cat', 'day', 'cartoon', 'cat')


@pytest.mark.asyncio
async def test_invalid_config_fails_before_any_external_request(monkeypatch):
    monkeypatch.setenv('GAMERHUB_IMAGE_PROVIDER', 'openai')
    monkeypatch.setenv('GAMERHUB_IMAGE_MODEL', 'text-only-model')
    monkeypatch.setattr(providers.httpx, 'AsyncClient', lambda **kwargs: pytest.fail('invalid config must not bill'))
    with pytest.raises(DomainError, match='^ART_PROVIDER_CONFIG_INVALID$'):
        await providers.prepare_image('image-provider', 'cat', 'day', 'cartoon', 'cat')
