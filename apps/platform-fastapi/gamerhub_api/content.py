import base64
import hashlib
import mimetypes
from io import BytesIO
from pathlib import Path

from fastapi.responses import FileResponse
from PIL import Image, UnidentifiedImageError

from .bridge import DomainError


def decode_image(encoded: str, mime_type: str | None):
    try:
        raw = base64.b64decode(encoded, validate=True)
        if len(raw) > 5 * 1024 * 1024:
            raise ValueError('size')
        with Image.open(BytesIO(raw)) as image:
            width, height = image.size
            if width > 4096 or height > 4096 or width * height > 16_000_000:
                raise ValueError('dimensions')
            actual = Image.MIME.get(image.format)
            if actual != mime_type or actual not in ('image/png', 'image/jpeg', 'image/webp'):
                raise ValueError('mime')
            image.verify()
        with Image.open(BytesIO(raw)) as image:
            # Decode fully and re-encode; do not trust headers or preserve metadata.
            result = BytesIO()
            output_format = {'image/png': 'PNG', 'image/jpeg': 'JPEG', 'image/webp': 'WEBP'}[mime_type]
            image.convert('RGB' if output_format == 'JPEG' else 'RGBA').save(result, output_format)
        return {'bytes_base64': base64.b64encode(result.getvalue()).decode(), 'mime_type': mime_type,
                'width': width, 'height': height, 'provenance': 'pillow-decoded-reencoded'}
    except (ValueError, OSError, UnidentifiedImageError, Image.DecompressionBombError) as error:
        raise DomainError('LOCAL_IMAGE_INVALID', 400) from error


def scan_image(encoded):
    try:
        raw = base64.b64decode(encoded, validate=True)
    except ValueError as error:
        raise DomainError('LOCAL_SCAN_INPUT_INVALID', 400) from error
    if not raw or len(raw) > 5 * 1024 * 1024:
        raise DomainError('LOCAL_SCAN_INPUT_INVALID', 400)
    clean = not (raw.startswith((b'MZ', b'\x7fELF')) or b'EICAR-STANDARD-ANTIVIRUS-TEST-FILE' in raw)
    return {'clean': clean, 'report_reference': 'fixture://signature-smoke/' + hashlib.sha256(raw).hexdigest(),
            'limitations': 'signature-smoke-only-not-a-production-malware-scan'}


def preview_response(preview, requested: str):
    root = Path(preview['root']).resolve()
    path = (root / requested).resolve()
    if not path.is_relative_to(root) or '\\' in requested or '\x00' in requested:
        raise DomainError('PREVIEW_PATH_INVALID', 400)
    if not path.is_file():
        raise DomainError('PREVIEW_FILE_NOT_FOUND', 404)
    suffix = path.suffix.lower()
    uncompressed = path.with_suffix('') if suffix in ('.br', '.gz') else path
    media = {'.wasm': 'application/wasm', '.js': 'application/javascript', '.data': 'application/octet-stream'}.get(uncompressed.suffix)
    media = media or mimetypes.guess_type(str(uncompressed))[0] or 'application/octet-stream'
    headers = {'access-control-allow-origin': '*', 'cross-origin-resource-policy': 'cross-origin',
               'cross-origin-opener-policy': 'same-origin', 'cross-origin-embedder-policy': 'require-corp',
               'x-gamerhub-provenance': 'real-unity-webgl', 'x-gamerhub-trace-id': preview['traceId'],
               'cache-control': 'no-cache' if path.name == 'index.html' else 'public, max-age=31536000, immutable'}
    if suffix in ('.gz', '.br'):
        headers['content-encoding'] = 'gzip' if suffix == '.gz' else 'br'
    return FileResponse(path, media_type=media, headers=headers)
