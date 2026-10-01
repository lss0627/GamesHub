import asyncio
import base64
import json
import hashlib
import math
import os
from dataclasses import dataclass, field
from io import BytesIO
from urllib.parse import urlsplit

import httpx
from PIL import Image, ImageOps

from .bridge import DomainError, ROOT
from .content import decode_image

ROLES = ('cat', 'forest', 'coin', 'stump')
STYLE_NAMES = {'day': '晨光森林', 'dusk': '暮色花园', 'night': '月色森林'}
ROLE_NAMES = {'cat': '冒险小猫', 'forest': '森林背景', 'coin': '星星金币', 'stump': '森林木桩'}
MAX_RESPONSE_BYTES = 8 * 1024 * 1024
MAX_IMAGE_BYTES = 5 * 1024 * 1024
MAX_REQUEST_BYTES = 32 * 1024
# Models documented to support transparent output, not a promise of account
# access. GPT Image 2 transparency is in preview; every response still needs a
# real alpha channel. Deliberately exclude DALL-E's opaque-only generations.
# https://developers.openai.com/api/reference/resources/images/methods/generate
OPENAI_PNG_MODELS = frozenset({
    'gpt-image-1', 'gpt-image-1-mini', 'gpt-image-1.5', 'gpt-image-1.5-2025-12-16',
    'gpt-image-2', 'gpt-image-2-2026-04-21',
    'gpt-image-2.5-flare', 'gpt-image-2.5-flare-2026-09-08',
    'gpt-image-2.5-sunburst', 'gpt-image-2.5-sunburst-2026-09-08',
})
CONFIG_DETAILS = {
    'ART_PROVIDER_NOT_CONFIGURED': '使用内置素材配色；如需原创图片，请配置独立的图片服务。',
    'ART_PROVIDER_READY': '图片服务配置有效；尚未联网验证，模型权限、额度与实际出图质量需生成时确认。',
    'ART_PROVIDER_UNSUPPORTED': 'GAMERHUB_IMAGE_PROVIDER 仅支持 builtin、gateway 或 openai。',
    'ART_PROVIDER_URL_REQUIRED': '请设置 GAMERHUB_IMAGE_PROVIDER_URL，指向图片网关生成接口。',
    'ART_PROVIDER_URL_INVALID': '图片网关地址须为有效的 HTTP 或 HTTPS URL，且不含用户信息或片段。',
    'ART_PROVIDER_KEY_REQUIRED': '请设置 GAMERHUB_IMAGE_API_KEY 或 OPENAI_API_KEY。',
    'ART_PROVIDER_MODEL_REQUIRED': '请显式设置 GAMERHUB_IMAGE_MODEL 为支持透明 PNG 的 GPT Image 模型。',
    'ART_PROVIDER_MODEL_UNSUPPORTED': '所选模型未登记透明 PNG 能力；请使用支持的 GPT Image 模型或适配图片网关。',
    'ART_PROVIDER_SETTINGS_INVALID': '请检查图片超时（1–180 秒）、质量（low/medium/high）和密钥格式。',
}


@dataclass(frozen=True)
class ImageConfig:
    provider: str
    endpoint: str = field(default='', repr=False)
    key: str = field(default='', repr=False)
    model: str | None = None
    quality: str = 'medium'
    timeout: float = 120
    reason: str = 'ART_PROVIDER_READY'

    @property
    def available(self):
        return self.reason == 'ART_PROVIDER_READY'


def _image_config() -> ImageConfig:
    endpoint = os.getenv('GAMERHUB_IMAGE_PROVIDER_URL', '').strip()
    provider = os.getenv('GAMERHUB_IMAGE_PROVIDER', '').strip().lower()
    # Preserve the original gateway URL-only configuration. A language-model key
    # alone never enables paid image generation.
    provider = provider or ('gateway' if endpoint else 'builtin')
    if provider == 'builtin':
        return ImageConfig('builtin', reason='ART_PROVIDER_NOT_CONFIGURED')
    if provider not in ('gateway', 'openai'):
        return ImageConfig('unsupported', reason='ART_PROVIDER_UNSUPPORTED')
    model = os.getenv('GAMERHUB_IMAGE_MODEL', '').strip() if provider == 'openai' else None
    if provider == 'openai':
        if not model:
            return ImageConfig(provider, reason='ART_PROVIDER_MODEL_REQUIRED')
        if model not in OPENAI_PNG_MODELS:
            # Do not reflect arbitrary configuration values into public metadata.
            return ImageConfig(provider, reason='ART_PROVIDER_MODEL_UNSUPPORTED')
        endpoint = 'https://api.openai.com/v1/images/generations'
        key = os.getenv('GAMERHUB_IMAGE_API_KEY', '').strip() or os.getenv('OPENAI_API_KEY', '').strip()
        if not key:
            return ImageConfig(provider, model=model, reason='ART_PROVIDER_KEY_REQUIRED')
    else:
        key = os.getenv('GAMERHUB_IMAGE_PROVIDER_KEY', '').strip()
        if not endpoint:
            return ImageConfig(provider, reason='ART_PROVIDER_URL_REQUIRED')
        try:
            url = urlsplit(endpoint)
            # The URL is trusted administrator configuration. Preserve HTTP
            # gateways on private networks and Docker service names as well.
            valid_scheme = url.scheme in ('http', 'https')
            if (len(endpoint) > 8192 or not valid_scheme or not url.hostname or url.username or url.password
                    or url.fragment or any(character.isspace() for character in endpoint)):
                raise ValueError('url')
            _ = url.port
        except ValueError:
            return ImageConfig(provider, reason='ART_PROVIDER_URL_INVALID')
    quality = os.getenv('GAMERHUB_IMAGE_QUALITY', 'medium').strip()
    try:
        timeout = float(os.getenv('GAMERHUB_IMAGE_TIMEOUT_SECONDS', '120'))
        if (not math.isfinite(timeout) or not 1 <= timeout <= 180
                or quality not in ('low', 'medium', 'high') or len(key) > 8192
                or any(ord(character) < 33 or ord(character) > 126 for character in key)):
            raise ValueError('settings')
    except ValueError:
        return ImageConfig(provider, model=model, reason='ART_PROVIDER_SETTINGS_INVALID')
    return ImageConfig(provider, endpoint, key, model, quality, timeout)


def available_providers():
    config = _image_config()
    external = {'id': 'image-provider', 'name': 'OpenAI 图片生成' if config.provider == 'openai' else '图片生成服务',
                'available': config.available, 'provider': config.provider,
                'reasonCode': config.reason, 'configurationOnly': True}
    if config.model:
        external['model'] = config.model
    return [{'id': 'builtin', 'name': '内置素材库 · 自动配色', 'available': True, 'provider': 'builtin',
             'reasonCode': 'ART_BUILTIN_READY', 'configurationOnly': False}, external]


def image_runtime_info():
    """Read configuration only; health polling must never generate billable art."""
    config = _image_config()
    result = {'status': 'ready' if config.available else ('bypassed' if config.provider == 'builtin' else 'blocked'),
              'provider': config.provider, 'detail': CONFIG_DETAILS[config.reason], 'reasonCode': config.reason,
              'optional': True, 'configurationOnly': True, 'builtinAvailable': True}
    if config.model:
        result['model'] = config.model
    return result


def generation_provenance(source: str):
    if source == 'builtin':
        return {'provider': 'builtin'}
    if source != 'image-provider':
        raise DomainError('ART_SOURCE_INVALID', 400)
    config = _image_config()
    return {'provider': config.provider, **({'model': config.model} if config.model else {})}


def generation_fingerprint(source: str):
    """Detect output configuration changes while allowing credential rotation.

    Only a digest is persisted. Never persist the endpoint or credential.
    """
    if source == 'builtin':
        settings = {'provider': 'builtin', 'version': 'palette-v1'}
    elif source == 'image-provider':
        config = _image_config()
        settings = {'provider': config.provider, 'endpoint': config.endpoint,
                    'model': config.model, 'quality': config.quality}
    else:
        raise DomainError('ART_SOURCE_INVALID', 400)
    return 'sha256-' + hashlib.sha256(json.dumps(settings, sort_keys=True).encode()).hexdigest()


def builtin_image(role: str, style: str) -> bytes:
    if role not in ROLES or style not in STYLE_NAMES:
        raise DomainError('ART_ROLE_INVALID', 400)
    with Image.open(ROOT / 'apps/studio-web/public/runner-art' / f'{role}.png') as source:
        image = source.convert('RGBA')
        if style != 'day':
            colors = ('#21304d', '#bacce3') if style == 'night' else ('#594360', '#ffd0b0')
            if role == 'coin':
                colors = ('#876232', '#fff3ba') if style == 'night' else ('#985641', '#ffe0ad')
            colored = ImageOps.colorize(ImageOps.grayscale(image), black=colors[0], white=colors[1])
            colored.putalpha(image.getchannel('A'))
            image = colored
        output = BytesIO()
        image.save(output, 'PNG')
        return output.getvalue()


async def prepare_image(source: str, role: str, style: str, prompt: str, description: str) -> bytes:
    if source == 'builtin':
        return await asyncio.to_thread(builtin_image, role, style)
    if source != 'image-provider':
        raise DomainError('ART_SOURCE_INVALID', 400)
    if role not in ROLES or style not in STYLE_NAMES:
        raise DomainError('ART_ROLE_INVALID', 400)
    if any(not isinstance(text, str) or not 1 <= len(text.strip()) <= 4000 for text in (prompt, description)):
        raise DomainError('ART_PROMPT_INVALID', 400)
    config = _image_config()
    if not config.available:
        raise DomainError('ART_PROVIDER_UNAVAILABLE' if config.provider == 'builtin' else 'ART_PROVIDER_CONFIG_INVALID', 503)
    shared_prompt = f'2D game art. Shared style: {prompt}. Palette: {STYLE_NAMES[style]}. Asset: {description}. No text, no UI.'
    if config.provider == 'gateway':
        body = {'prompt': shared_prompt, 'role': role, 'width': 1600 if role == 'forest' else 256,
                'height': 1000 if role == 'forest' else 256, 'transparent': role != 'forest'}
    else:
        instruction = ('A full landscape background, without characters or UI.' if role == 'forest' else
                       'One isolated complete sprite on a fully transparent background. No scenery, backdrop, checkerboard or drop shadow.')
        body = {'model': config.model, 'prompt': f'{shared_prompt} {instruction}', 'n': 1,
                'size': '1536x1024' if role == 'forest' else '1024x1024', 'quality': config.quality,
                'background': 'opaque' if role == 'forest' else 'transparent', 'output_format': 'png'}
    try:
        request_data = json.dumps(body, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
    except UnicodeError:
        raise DomainError('ART_PROMPT_INVALID', 400) from None
    if len(request_data) > MAX_REQUEST_BYTES:
        raise DomainError('ART_PROMPT_INVALID', 400)
    headers = {'Content-Type': 'application/json', 'Accept': 'application/json', 'Accept-Encoding': 'identity'}
    if config.key:
        headers['Authorization'] = f'Bearer {config.key}'
    try:
        # A wall-clock deadline also bounds a slowly trickling provider. There is
        # no SDK retry policy and no fallback: one request means at most one bill.
        async with asyncio.timeout(config.timeout):
            timeout = httpx.Timeout(config.timeout, connect=min(10, config.timeout))
            async with httpx.AsyncClient(timeout=timeout, follow_redirects=False) as client:
                async with client.stream('POST', config.endpoint, headers=headers, content=request_data) as response:
                    _check_response_status(response.status_code)
                    content_length = response.headers.get('content-length')
                    if content_length and (not content_length.isdecimal() or int(content_length) > MAX_RESPONSE_BYTES):
                        raise DomainError('ART_PROVIDER_INVALID', 502)
                    data = bytearray()
                    async for chunk in response.aiter_bytes(chunk_size=64 * 1024):
                        if len(data) + len(chunk) > MAX_RESPONSE_BYTES:
                            raise DomainError('ART_PROVIDER_INVALID', 502)
                        data.extend(chunk)
            result = json.loads(data)
            if not isinstance(result, dict):
                raise DomainError('ART_PROVIDER_INVALID', 502)
            if config.provider == 'openai':
                images = result.get('data')
                if not isinstance(images, list) or len(images) != 1 or not isinstance(images[0], dict):
                    raise DomainError('ART_PROVIDER_INVALID', 502)
                encoded, mime_type = images[0].get('b64_json'), 'image/png'
            else:
                encoded, mime_type = result.get('bytes_base64'), result.get('mime_type')
            return await asyncio.to_thread(_validate_provider_png, encoded, mime_type, role)
    except DomainError:
        raise
    except (TimeoutError, httpx.TimeoutException):
        raise DomainError('ART_PROVIDER_TIMEOUT', 504) from None
    except httpx.HTTPError:
        raise DomainError('ART_PROVIDER_FAILED', 502) from None
    except (ValueError, TypeError, UnicodeError, RecursionError):
        raise DomainError('ART_PROVIDER_INVALID', 502) from None


def _check_response_status(status):
    if 200 <= status < 300:
        return
    if status in (401, 403):
        raise DomainError('ART_PROVIDER_AUTH_FAILED', 502)
    if status == 429:
        raise DomainError('ART_PROVIDER_RATE_LIMITED', 503)
    if 300 <= status < 500:
        raise DomainError('ART_PROVIDER_REQUEST_REJECTED', 502)
    raise DomainError('ART_PROVIDER_FAILED', 502)


def _validate_provider_png(encoded, mime_type, role):
    if mime_type != 'image/png':
        raise DomainError('ART_PNG_REQUIRED', 502)
    if not isinstance(encoded, str) or not encoded or len(encoded) > ((MAX_IMAGE_BYTES + 2) // 3) * 4:
        raise DomainError('ART_PROVIDER_INVALID', 502)
    try:
        normalized = decode_image(encoded, mime_type)
    except DomainError:
        raise DomainError('ART_PROVIDER_INVALID', 502) from None
    data = base64.b64decode(normalized['bytes_base64'])
    if len(data) > MAX_IMAGE_BYTES:
        raise DomainError('ART_PROVIDER_INVALID', 502)
    if role != 'forest':
        with Image.open(BytesIO(data)) as image:
            minimum, maximum = image.getchannel('A').getextrema()
            if minimum == 255 or maximum == 0:
                raise DomainError('ART_TRANSPARENCY_REQUIRED', 502)
    return data
