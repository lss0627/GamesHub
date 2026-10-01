import asyncio
import base64
import hmac
import os
from contextlib import asynccontextmanager
from uuid import UUID

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, Response
from starlette.exceptions import HTTPException

from .art import ArtService
from .bridge import DomainBridge, DomainError, value
from .content import decode_image, preview_response, scan_image
from .models import ControlInput, GenerateInput, ImageInput, MessageInput, ProjectInput, RevisionInput, RunInput, SelectInput, UploadInput
from .pi.repository import AgentRepository, AgentStateError
from .pi.memory import MemoryService
from .models import CreativeInput, CreativePromptInput
from .providers import image_runtime_info


def create_app(bridge=None, bearer_token=None, agent_repository=None):
    managed = bridge is None
    bridge = bridge or DomainBridge()
    art = ArtService(bridge)
    repository = agent_repository or getattr(getattr(bridge, 'pi', None), 'repository', None) or AgentRepository()
    memory = MemoryService(repository)
    token = bearer_token or os.getenv('GAMERHUB_API_BEARER_TOKEN')
    if os.getenv('NODE_ENV') == 'production' and (not token or len(token) < 32):
        raise RuntimeError('GAMERHUB_API_BEARER_TOKEN_REQUIRED')

    @asynccontextmanager
    async def lifespan(app):
        if managed:
            await bridge.start()
        try:
            yield
        finally:
            await art.close()
            if managed:
                await bridge.close()

    app = FastAPI(title='GamerHub 创作平台', version='0.2.0', lifespan=lifespan)
    app.state.bridge, app.state.art = bridge, art

    @app.middleware('http')
    async def boundaries(request: Request, call_next):
        path = request.url.path
        if token and (path.startswith('/v1/') or path in ('/docs', '/openapi.json')):
            supplied = request.headers.get('authorization', '')
            if not hmac.compare_digest(supplied.encode(), f'Bearer {token}'.encode()):
                return JSONResponse({'code': 'AUTH_REQUIRED'}, status_code=401)
        if path.startswith('/v1/') and request.method not in ('GET', 'POST', 'HEAD'):
            return JSONResponse({'code': 'METHOD_NOT_ALLOWED'}, status_code=405, headers={'allow': 'GET, POST, HEAD'})
        if request.method == 'POST':
            try:
                if int(request.headers.get('content-length', '0')) > 8 * 1024 * 1024:
                    return JSONResponse({'code': 'SIZE_LIMIT'}, status_code=413)
            except ValueError:
                return JSONResponse({'code': 'BAD_REQUEST'}, status_code=400)
            if len(await request.body()) > 8 * 1024 * 1024:
                return JSONResponse({'code': 'SIZE_LIMIT'}, status_code=413)
        return await call_next(request)

    @app.exception_handler(DomainError)
    async def domain_error(_request, error):
        return JSONResponse({'code': error.code}, status_code=error.status)

    @app.exception_handler(AgentStateError)
    async def agent_state_error(_request, error):
        return JSONResponse({'code': error.code}, status_code=error.status)

    @app.exception_handler(RequestValidationError)
    async def validation_error(_request, _error):
        return JSONResponse({'code': 'BAD_REQUEST'}, status_code=400)

    @app.exception_handler(HTTPException)
    async def http_error(_request, error):
        return JSONResponse({'code': 'NOT_FOUND' if error.status_code == 404 else 'METHOD_NOT_ALLOWED' if error.status_code == 405 else 'BAD_REQUEST'}, status_code=error.status_code)

    @app.exception_handler(Exception)
    async def internal_error(_request, _error):
        return JSONResponse({'code': 'INTERNAL_ERROR'}, status_code=500)

    def key(request):
        result = request.headers.get('idempotency-key', '')
        if not result.strip() or len(result) > 200:
            raise DomainError('IDEMPOTENCY_KEY_REQUIRED', 400)
        return result

    async def dispatch(operation, request=None, body=None, **params):
        if request:
            params['headers'] = {name: request.headers[name] for name in ('idempotency-key', 'traceparent') if name in request.headers}
        if body is not None:
            params['body'] = body.model_dump(mode='json', exclude_none=True) if hasattr(body, 'model_dump') else body
        result = await bridge.call(operation, {name: str(item) if isinstance(item, UUID) else item for name, item in params.items()})
        return JSONResponse(result['body'], status_code=result['status'], headers=result.get('headers'))

    @app.get('/health', tags=['system'])
    async def health():
        result = await value(bridge, 'health')
        pi = getattr(getattr(bridge, 'pi', None), 'runtime_info', None)
        if pi:
            result['services'] = {**result.get('services', {}), 'agent': pi}
        result['services'] = {**result.get('services', {}), 'images': image_runtime_info()}
        return JSONResponse({**result, 'framework': 'fastapi', 'domainTransport': 'stdio', 'assetStudio': 'ready'},
                            status_code=503 if result.get('status') == 'blocked' else 200, headers={'cache-control': 'no-store'})

    @app.get('/v1/game-capabilities', tags=['design'])
    async def capabilities():
        return await dispatch('capabilities.get')

    @app.get('/v1/projects', tags=['projects'])
    async def projects():
        return await dispatch('projects.list')

    @app.post('/v1/projects', tags=['projects'], status_code=201)
    async def create_project(body: ProjectInput):
        return await dispatch('projects.create', body=body)

    @app.get('/v1/projects/{projectId}', tags=['projects'])
    async def project(projectId: UUID):
        return await dispatch('projects.get', projectId=projectId)

    @app.get('/v1/projects/{projectId}/design', tags=['design'])
    async def design(projectId: UUID):
        return await dispatch('design.get', projectId=projectId)

    @app.get('/v1/projects/{projectId}/agent/memory', tags=['agent'])
    async def project_memory(projectId: UUID):
        knowledge = await repository.knowledge(str(projectId))
        return {**memory.visible(knowledge['memory']), 'derived': {'confirmedSpecId': (knowledge.get('confirmedSpec') or {}).get('id')},
                'limits': {'maxItems': 200, 'maxContentCharacters': 1200}}

    @app.post('/v1/projects/{projectId}/agent/memory', tags=['agent'])
    async def change_memory(projectId: UUID, request: Request):
        try:
            body = await request.json()
        except ValueError:
            raise AgentStateError('MEMORY_INPUT_INVALID') from None
        return await memory.change(str(projectId), body)

    @app.get('/v1/projects/{projectId}/agent/tools', tags=['agent'])
    async def project_tools(projectId: UUID):
        await repository.get_memory(str(projectId))
        from .pi.tools import build_registry
        async def unavailable(_name, _args):
            raise AgentStateError('TOOL_NOT_ALLOWED')
        return {'tools': build_registry({'safetyClass': 'confirmed_action'}, unavailable).describe()}

    @app.post('/v1/projects/{projectId}/design/messages', tags=['design'])
    async def message(projectId: UUID, body: MessageInput):
        return await dispatch('design.message', projectId=projectId, body=body)

    @app.get('/v1/projects/{projectId}/creative', tags=['creative'])
    async def creative(projectId: UUID):
        return await dispatch('creative.get', projectId=projectId)

    @app.post('/v1/projects/{projectId}/creative', tags=['creative'])
    async def save_creative(projectId: UUID, body: CreativeInput):
        return await dispatch('creative.save', projectId=projectId, body=body)

    @app.post('/v1/projects/{projectId}/creative/suggest', tags=['creative'])
    async def suggest_creative(projectId: UUID, body: CreativePromptInput):
        return await dispatch('creative.suggest', projectId=projectId, body=body)

    @app.post('/v1/projects/{projectId}/creative/apply', tags=['creative'], status_code=202)
    async def apply_creative(projectId: UUID, body: RevisionInput):
        return await dispatch('creative.apply', projectId=projectId, body=body)

    @app.post('/v1/projects/{projectId}/design/prepare', tags=['design'])
    async def prepare(projectId: UUID, body: RevisionInput):
        return await dispatch('design.prepare', projectId=projectId, body=body)

    @app.post('/v1/projects/{projectId}/design/confirm', tags=['design'])
    async def confirm(projectId: UUID, body: RevisionInput):
        return await dispatch('design.confirm', projectId=projectId, body=body)

    @app.get('/v1/projects/{projectId}/runs', tags=['runs'])
    async def runs(projectId: UUID):
        return await dispatch('runs.list', projectId=projectId)

    @app.post('/v1/projects/{projectId}/runs', tags=['runs'], status_code=202)
    async def create_run(projectId: UUID, body: RunInput, request: Request):
        key(request)
        return await dispatch('runs.create', request, projectId=projectId, body=body)

    @app.get('/v1/projects/{projectId}/runs/{runId}', tags=['runs'])
    async def run(projectId: UUID, runId: UUID):
        return await dispatch('runs.get', projectId=projectId, runId=runId)

    @app.get('/v1/projects/{projectId}/runs/{runId}/trace', tags=['runs'])
    async def trace(projectId: UUID, runId: UUID):
        return await dispatch('runs.trace', projectId=projectId, runId=runId)

    @app.get('/v1/projects/{projectId}/runs/{runId}/events', tags=['runs'])
    async def events(projectId: UUID, runId: UUID, request: Request, after: str = '0'):
        try:
            cursor = max(0, int(request.headers.get('last-event-id', after)))
        except ValueError:
            cursor = 0
        result = await bridge.call('runs.events', {'projectId': str(projectId), 'runId': str(runId), 'after': cursor})
        if result['status'] != 200:
            return JSONResponse(result['body'], status_code=result['status'])
        return Response(': gamerhub-heartbeat\n\n' + result['body'].get('sse', ''), media_type='text/event-stream',
                        headers={**result.get('headers', {}), 'cache-control': 'no-cache'})

    @app.post('/v1/projects/{projectId}/runs/{runId}/pause', tags=['runs'], status_code=202)
    async def pause(projectId: UUID, runId: UUID, request: Request, body: ControlInput | None = None):
        return await dispatch('runs.pause', request, projectId=projectId, runId=runId, body=body or {})

    @app.post('/v1/projects/{projectId}/runs/{runId}/resume', tags=['runs'], status_code=202)
    async def resume(projectId: UUID, runId: UUID, request: Request, body: ControlInput | None = None):
        return await dispatch('runs.resume', request, projectId=projectId, runId=runId, body=body or {})

    @app.post('/v1/projects/{projectId}/runs/{runId}/cancel', tags=['runs'], status_code=202)
    async def cancel(projectId: UUID, runId: UUID, request: Request, body: ControlInput | None = None):
        return await dispatch('runs.cancel', request, projectId=projectId, runId=runId, body=body or {})

    @app.get('/v1/projects/{projectId}/versions', tags=['versions'])
    async def versions(projectId: UUID):
        return await dispatch('versions.list', projectId=projectId)

    @app.post('/v1/projects/{projectId}/versions/{versionId}/restore', tags=['versions'], status_code=202)
    async def restore(projectId: UUID, versionId: UUID, request: Request):
        return await dispatch('versions.restore', projectId=projectId, versionId=versionId, key=key(request))

    @app.get('/v1/projects/{projectId}/assets', tags=['assets'])
    async def assets(projectId: UUID):
        return await dispatch('assets.list', projectId=projectId)

    @app.post('/v1/projects/{projectId}/assets', tags=['assets'], status_code=201)
    async def upload(projectId: UUID, body: UploadInput):
        return await dispatch('assets.upload', projectId=projectId, body=body)

    @app.get('/v1/projects/{projectId}/assets/{assetId}/content', tags=['assets'])
    async def asset_content(projectId: UUID, assetId: UUID):
        result = await value(bridge, 'assets.content', {'projectId': str(projectId), 'assetId': str(assetId)})
        return Response(base64.b64decode(result['bytes_base64']), media_type=result['mime_type'],
                        headers={'x-content-type-options': 'nosniff', 'cache-control': 'private, max-age=300'})

    @app.post('/v1/projects/{projectId}/assets/{assetId}/replace', tags=['assets'], status_code=202)
    async def replace_asset(projectId: UUID, assetId: UUID, request: Request):
        key(request)
        return await dispatch('assets.replace', request, projectId=projectId, assetId=assetId)

    @app.get('/v1/projects/{projectId}/art', tags=['art studio'])
    async def art_plan(projectId: UUID):
        return await art.get(str(projectId))

    @app.post('/v1/projects/{projectId}/art/generate', tags=['art studio'], status_code=202)
    async def generate_art(projectId: UUID, body: GenerateInput):
        return await art.generate(str(projectId), body)

    @app.post('/v1/projects/{projectId}/art/resume', tags=['art studio'], status_code=202)
    async def resume_art(projectId: UUID, body: RevisionInput):
        return await art.resume(str(projectId), body)

    @app.post('/v1/projects/{projectId}/art/select', tags=['art studio'])
    async def select_art(projectId: UUID, body: SelectInput):
        return await art.select(str(projectId), body)

    @app.post('/v1/projects/{projectId}/art/cancel', tags=['art studio'])
    async def cancel_art(projectId: UUID, body: RevisionInput):
        return await art.cancel(str(projectId), body)

    @app.post('/scan', tags=['local support'])
    async def scan(body: ImageInput):
        return await asyncio.to_thread(scan_image, body.bytes_base64)

    @app.post('/decode', tags=['local support'])
    async def decode(body: ImageInput):
        return await asyncio.to_thread(decode_image, body.bytes_base64, body.mime_type)

    @app.get('/real-previews/{projectId}/{buildHash}/{path:path}', tags=['preview'])
    async def preview(projectId: UUID, buildHash: str, path: str):
        result = await value(bridge, 'preview.resolve', {'projectId': str(projectId), 'buildHash': buildHash})
        return preview_response(result, path or 'index.html')

    return app
